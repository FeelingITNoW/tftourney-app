-- Adds a configurable per-lobby-thread cooldown after a Discord screenshot is
-- accepted, so a duplicate/late screenshot for the same lobby is rejected
-- (with a reply telling the sender how long to wait) instead of silently
-- overwriting the next pending game. Also fixes latent bugs in the Discord
-- RPCs shipped by 20260808010000_add_discord_tournament_integration.sql:
-- unqualified references to PL/pgSQL RETURNS TABLE output columns that
-- collide with same-named table columns raise "column reference is
-- ambiguous" at call time (claim_discord_score_submission and
-- submit_lobby_results always failed; check_in_discord_player always
-- failed), and `returning id into v_submission` left every other output
-- field NULL in enqueue_discord_score_submission.

alter table public.tournament_discord_configs
  add column if not exists score_cooldown_seconds integer not null default 60
    check (score_cooldown_seconds >= 0 and score_cooldown_seconds <= 3600);

alter table public.discord_lobby_threads
  add column if not exists last_accepted_at timestamptz;

-- Recreate the status check constraint to allow the new rejection status.
do $$
declare status_constraint record;
begin
  for status_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.discord_score_submissions'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.discord_score_submissions drop constraint %I',
      status_constraint.conname
    );
  end loop;
end $$;

alter table public.discord_score_submissions
  add constraint discord_score_submissions_status_check
  check (status in (
    'queued', 'processing', 'needs_review', 'accepted', 'rejected',
    'rejected_overflow', 'rejected_spam', 'rejected_cooldown', 'failed'
  ));

-- Single source of truth for "how many seconds until this lobby thread's
-- cooldown clears", shared by enqueue-time and claim-time checks.
create or replace function public.discord_score_cooldown_remaining_seconds(
  p_last_accepted_at timestamptz,
  p_cooldown_seconds integer
)
returns integer
language sql
stable
as $$
  select case
    when p_last_accepted_at is null or coalesce(p_cooldown_seconds, 0) <= 0 then 0
    else greatest(0, ceil(extract(epoch from (
      p_last_accepted_at + make_interval(secs => p_cooldown_seconds) - now()
    )))::integer)
  end;
$$;

-- enqueue_discord_score_submission: adds a retry_after_seconds output column
-- (return type change, so the function must be dropped first), a cooldown
-- rejection branch evaluated before the overflow/spam checks, and fixes the
-- ambiguous-column bug by qualifying every table reference and by using
-- `returning *` instead of `returning id` so status/queue_position are no
-- longer left NULL on rejection branches.
drop function if exists public.enqueue_discord_score_submission(
  text, text, text, text, timestamptz, text, text, integer
);

create function public.enqueue_discord_score_submission(
  p_tournament_id text,
  p_thread_id text,
  p_discord_message_id text,
  p_discord_user_id text,
  p_received_at timestamptz,
  p_storage_path text,
  p_mime_type text,
  p_byte_size integer
)
returns table(
  submission_id text,
  submission_status text,
  queue_position integer,
  round_id text,
  lobby_number integer,
  accepted_image_count integer,
  retry_after_seconds integer
)
language plpgsql
as $$
declare
  v_existing public.discord_score_submissions%rowtype;
  v_thread public.discord_lobby_threads%rowtype;
  v_tournament public.tournaments%rowtype;
  v_cooldown_seconds integer;
  v_retry_after integer;
  v_pending integer;
  v_position integer;
  v_submission public.discord_score_submissions%rowtype;
begin
  perform set_config('lock_timeout', '2s', true);
  select submissions.* into v_existing
  from public.discord_score_submissions submissions
  where submissions.discord_message_id = p_discord_message_id;
  if found then
    return query select v_existing.id::text, v_existing.status, v_existing.queue_position,
      v_existing.round_id::text, null::integer, 0, null::integer;
    return;
  end if;

  select threads.* into v_thread
  from public.discord_lobby_threads threads
  where threads.thread_id = p_thread_id
  for update;
  if not found then raise exception 'Discord lobby thread is not registered.'; end if;

  -- Recheck after the thread lock to make duplicate Discord delivery retries
  -- return the original queue row instead of racing the unique constraint.
  select submissions.* into v_existing
  from public.discord_score_submissions submissions
  where submissions.discord_message_id = p_discord_message_id;
  if found then
    return query select v_existing.id::text, v_existing.status, v_existing.queue_position,
      v_existing.round_id::text, null::integer, 0, null::integer;
    return;
  end if;

  select tournaments.* into v_tournament
  from public.tournaments tournaments
  where tournaments.id = (select rounds.tournament_id from public.rounds rounds where rounds.id = v_thread.round_id)
    and tournaments.id::text = p_tournament_id
  for update;
  if not found then raise exception 'Tournament was not found for this Discord thread.'; end if;
  if v_thread.state <> 'active' or v_tournament.status in ('completed', 'cancelled') then
    raise exception 'This Discord lobby thread is no longer active.';
  end if;

  select count(*)::integer into v_pending
  from public.discord_score_submissions submissions
  where submissions.thread_id = p_thread_id
    and submissions.status in ('queued', 'processing', 'needs_review');
  v_position := v_pending + 1;

  v_cooldown_seconds := coalesce(
    (select configs.score_cooldown_seconds from public.tournament_discord_configs configs
     where configs.tournament_id = v_tournament.id),
    60
  );
  v_retry_after := public.discord_score_cooldown_remaining_seconds(v_thread.last_accepted_at, v_cooldown_seconds);

  if v_retry_after > 0 then
    insert into public.discord_score_submissions(
      tournament_id, round_id, thread_id, discord_message_id, discord_user_id,
      storage_path, mime_type, byte_size, received_at, status, queue_position,
      error_code, error_message
    ) values (
      v_tournament.id, v_thread.round_id, p_thread_id, p_discord_message_id, p_discord_user_id,
      p_storage_path, p_mime_type, p_byte_size, p_received_at, 'rejected_cooldown', v_position,
      'LOBBY_COOLDOWN', format(
        'Lobby %s was scored less than %s second(s) ago. Wait %s more second(s) before sending the next screenshot.',
        v_thread.lobby_number, v_cooldown_seconds, v_retry_after
      )
    ) returning * into v_submission;
  elsif v_pending >= 3 then
    insert into public.discord_score_submissions(
      tournament_id, round_id, thread_id, discord_message_id, discord_user_id,
      storage_path, mime_type, byte_size, received_at, status, queue_position,
      error_code, error_message
    ) values (
      v_tournament.id, v_thread.round_id, p_thread_id, p_discord_message_id, p_discord_user_id,
      p_storage_path, p_mime_type, p_byte_size, p_received_at, 'rejected_overflow', v_position,
      'QUEUE_FULL', 'Too many screenshots are already waiting for this lobby.'
    ) returning * into v_submission;
  elsif exists (
    select 1 from public.discord_score_submissions recent
    where recent.thread_id = p_thread_id
      and recent.discord_user_id = p_discord_user_id
      and recent.created_at > now() - interval '10 seconds'
  ) then
    insert into public.discord_score_submissions(
      tournament_id, round_id, thread_id, discord_message_id, discord_user_id,
      storage_path, mime_type, byte_size, received_at, status, queue_position,
      error_code, error_message
    ) values (
      v_tournament.id, v_thread.round_id, p_thread_id, p_discord_message_id, p_discord_user_id,
      p_storage_path, p_mime_type, p_byte_size, p_received_at, 'rejected_spam', v_position,
      'UPLOAD_COOLDOWN', 'Please wait before sending another screenshot.'
    ) returning * into v_submission;
  else
    insert into public.discord_score_submissions(
      tournament_id, round_id, thread_id, discord_message_id, discord_user_id,
      storage_path, mime_type, byte_size, received_at, status, queue_position
    ) values (
      v_tournament.id, v_thread.round_id, p_thread_id, p_discord_message_id, p_discord_user_id,
      p_storage_path, p_mime_type, p_byte_size, p_received_at, 'queued', v_position
    ) returning * into v_submission;
  end if;

  return query select v_submission.id::text, v_submission.status, v_submission.queue_position,
    v_submission.round_id::text, v_thread.lobby_number, v_thread.accepted_image_count,
    case when v_submission.status = 'rejected_cooldown' then v_retry_after else null::integer end;
end;
$$;

-- claim_discord_score_submission: adds claim_status/discord_message_id/
-- retry_after_seconds output columns (return type change, so the function
-- must be dropped first); fixes the ambiguous-column bug by qualifying every
-- table reference in the lease sweep, candidate lookup, and thread lookup;
-- and rejects (rather than claims) a submission whose lobby thread is still
-- in cooldown, without consuming a retry/lease.
drop function if exists public.claim_discord_score_submission(integer);

create function public.claim_discord_score_submission(
  p_lease_seconds integer default 120
)
returns table(
  submission_id text,
  tournament_id text,
  round_id text,
  thread_id text,
  lobby_id text,
  game_number integer,
  lease_token text,
  storage_path text,
  attempt_count integer,
  claim_status text,
  discord_message_id text,
  retry_after_seconds integer
)
language plpgsql
as $$
declare
  v_submission public.discord_score_submissions%rowtype;
  v_thread public.discord_lobby_threads%rowtype;
  v_lobby public.lobbies%rowtype;
  v_token uuid := gen_random_uuid();
  v_cooldown_seconds integer;
  v_retry_after integer;
begin
  update public.discord_score_submissions submissions
  set status = case when submissions.attempt_count >= 3 then 'needs_review' else 'queued' end,
      lease_token = null, lease_expires_at = null,
      error_code = case when submissions.attempt_count >= 3 then 'PROCESSING_RETRIES_EXHAUSTED' else submissions.error_code end,
      error_message = case when submissions.attempt_count >= 3 then 'The screenshot worker could not process this image after three attempts.' else submissions.error_message end,
      updated_at = now()
  where submissions.status = 'processing' and submissions.lease_expires_at < now();

  select submissions.* into v_submission
  from public.discord_score_submissions submissions
  where submissions.status = 'queued'
    and not exists (
      select 1 from public.discord_score_submissions active
      where active.thread_id = submissions.thread_id
        and active.status in ('processing', 'needs_review')
    )
  order by submissions.received_at, submissions.id
  limit 1
  for update skip locked;
  if not found then return; end if;

  select threads.* into v_thread from public.discord_lobby_threads threads
  where threads.thread_id = v_submission.thread_id for update;

  v_cooldown_seconds := coalesce(
    (select configs.score_cooldown_seconds from public.tournament_discord_configs configs
     where configs.tournament_id::text = v_submission.tournament_id::text),
    60
  );
  v_retry_after := public.discord_score_cooldown_remaining_seconds(v_thread.last_accepted_at, v_cooldown_seconds);
  if v_retry_after > 0 then
    update public.discord_score_submissions submissions
    set status = 'rejected_cooldown', error_code = 'LOBBY_COOLDOWN',
        error_message = format(
          'Lobby %s was scored less than %s second(s) ago. Wait %s more second(s) before sending the next screenshot.',
          v_thread.lobby_number, v_cooldown_seconds, v_retry_after
        ),
        lease_token = null, lease_expires_at = null, updated_at = now()
    where submissions.id = v_submission.id;
    return query select v_submission.id::text, v_submission.tournament_id::text, v_submission.round_id::text,
      v_submission.thread_id, null::text, null::integer, null::text, v_submission.storage_path,
      v_submission.attempt_count, 'rejected_cooldown'::text, v_submission.discord_message_id, v_retry_after;
    return;
  end if;

  select lobbies.* into v_lobby
  from public.lobbies lobbies
  where lobbies.round_id = v_thread.round_id
    and lobbies.lobby_number = v_thread.lobby_number
    and not exists (
      select 1 from public.lobby_participants participants
      where participants.lobby_id = lobbies.id
        and participants.result_status not in ('pending')
    )
  order by lobbies.game_number
  limit 1;
  if not found then
    update public.discord_score_submissions submissions
    set status = 'failed', error_code = 'NO_PENDING_GAME',
        error_message = 'No pending game is available for this lobby thread.', updated_at = now()
    where submissions.id = v_submission.id;
    return;
  end if;

  update public.discord_score_submissions submissions
  set status = 'processing', target_lobby_id = v_lobby.id,
      lease_token = v_token, lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      attempt_count = submissions.attempt_count + 1, updated_at = now()
  where submissions.id = v_submission.id;

  return query select v_submission.id::text, v_submission.tournament_id::text,
    v_submission.round_id::text, v_submission.thread_id, v_lobby.id::text,
    v_lobby.game_number, v_token::text, v_submission.storage_path,
    v_submission.attempt_count + 1, 'claimed'::text, v_submission.discord_message_id, null::integer;
end;
$$;

-- submit_lobby_results: fixes the ambiguous-column bug (round_id in the
-- lobby lookup, round_id/lobby_number in the thread bookkeeping update) and
-- starts the cooldown by stamping discord_lobby_threads.last_accepted_at
-- whenever a Discord submission actually records a previously-pending game.
create or replace function public.submit_lobby_results(
  p_tournament_id text,
  p_lobby_id text,
  p_results jsonb,
  p_idempotency_key text default null,
  p_source text default 'web',
  p_submission_id text default null,
  p_mode text default 'record'
)
returns table(
  updated_lobby_id text,
  updated_participant_count integer,
  round_id text,
  lobby_number integer,
  game_number integer,
  replayed boolean
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_round public.rounds%rowtype;
  v_lobby public.lobbies%rowtype;
  v_node_config jsonb;
  v_placement_points jsonb;
  v_participant_count integer;
  v_result_count integer;
  v_response jsonb;
  v_hash text;
  v_existing public.discord_score_idempotency%rowtype;
  v_submission public.discord_score_submissions%rowtype;
  v_was_pending boolean;
begin
  perform set_config('lock_timeout', '5s', true);
  if p_idempotency_key is not null then
    select * into v_existing from public.discord_score_idempotency
    where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.tournament_id::text <> p_tournament_id or v_existing.lobby_id::text <> p_lobby_id then
        raise exception 'Idempotency key belongs to a different lobby.';
      end if;
      v_hash := encode(digest(coalesce(p_results, 'null'::jsonb)::text, 'sha256'), 'hex');
      if v_existing.request_hash <> v_hash then raise exception 'Idempotency key was reused with different results.'; end if;
      return query select
        v_existing.response ->> 'updated_lobby_id',
        (v_existing.response ->> 'updated_participant_count')::integer,
        v_existing.response ->> 'round_id',
        (v_existing.response ->> 'lobby_number')::integer,
        (v_existing.response ->> 'game_number')::integer,
        true;
      return;
    end if;
  end if;

  select * into v_tournament from public.tournaments
  where id::text = p_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  -- Recheck after taking the tournament lock so two concurrent submissions with
  -- the same idempotency key converge on one committed response.
  if p_idempotency_key is not null then
    select * into v_existing from public.discord_score_idempotency
    where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.tournament_id::text <> p_tournament_id or v_existing.lobby_id::text <> p_lobby_id then
        raise exception 'Idempotency key belongs to a different lobby.';
      end if;
      v_hash := encode(digest(coalesce(p_results, 'null'::jsonb)::text, 'sha256'), 'hex');
      if v_existing.request_hash <> v_hash then raise exception 'Idempotency key was reused with different results.'; end if;
      return query select
        v_existing.response ->> 'updated_lobby_id',
        (v_existing.response ->> 'updated_participant_count')::integer,
        v_existing.response ->> 'round_id',
        (v_existing.response ->> 'lobby_number')::integer,
        (v_existing.response ->> 'game_number')::integer,
        true;
      return;
    end if;
  end if;
  select rounds.* into v_round
  from public.rounds rounds
  where rounds.id = (select lobbies.round_id from public.lobbies lobbies where lobbies.id::text = p_lobby_id)
    and rounds.tournament_id = v_tournament.id for update;
  if not found then raise exception 'Lobby was not found in this tournament.'; end if;
  if v_round.status in ('completed', 'cancelled', 'skipped') or v_tournament.status in ('completed', 'cancelled') then
    raise exception 'Results cannot be edited after the round is completed.'; end if;
  select lobbies.* into v_lobby from public.lobbies lobbies
  where lobbies.id::text = p_lobby_id and lobbies.round_id = v_round.id for update;
  if not found then raise exception 'Lobby was not found in this tournament.'; end if;

  v_was_pending := not exists (
    select 1 from public.lobby_participants where lobby_id = v_lobby.id and result_status <> 'pending'
  );
  if p_mode = 'record' and not v_was_pending then raise exception 'Lobby game has already been recorded.'; end if;
  if p_mode not in ('record', 'correct') then raise exception 'Invalid score write mode.'; end if;
  if p_mode = 'correct' and p_submission_id is null then
    select id::text into p_submission_id
    from public.discord_score_submissions
    where target_lobby_id = v_lobby.id and status = 'needs_review'
    order by received_at, id
    limit 1
    for update;
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'Lobby results must be an array.'; end if;
  select count(*)::integer into v_participant_count from public.lobby_participants where lobby_id = v_lobby.id;
  select count(*)::integer into v_result_count from jsonb_array_elements(p_results);
  if v_participant_count = 0 or v_result_count <> v_participant_count then raise exception 'Submit one result for every lobby player.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where jsonb_typeof(result.value) <> 'object' or coalesce(result.value ->> 'participantId', '') = '' or coalesce(result.value ->> 'placement', '') !~ '^\d+$') then raise exception 'Every result needs a valid player and placement.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where (result.value ->> 'placement')::numeric < 1 or (result.value ->> 'placement')::numeric > v_participant_count) then raise exception 'Every result needs a valid placement.'; end if;
  if (select count(distinct result.value ->> 'participantId') from jsonb_array_elements(p_results) result(value)) <> v_result_count then raise exception 'Each lobby player must appear exactly once.'; end if;
  if (select count(distinct (result.value ->> 'placement')::integer) from jsonb_array_elements(p_results) result(value)) <> v_result_count then raise exception 'Each player must have a unique placement.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where not exists (select 1 from public.lobby_participants participants where participants.lobby_id = v_lobby.id and participants.participant_id::text = result.value ->> 'participantId')) then raise exception 'A submitted player does not belong to this lobby.'; end if;

  v_placement_points := v_tournament.format_config -> 'placementPoints';
  if jsonb_typeof(v_placement_points) <> 'object' then raise exception 'Tournament format does not define placement points.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where coalesce(v_placement_points ->> (result.value ->> 'placement'), '') !~ '^\d+$') then raise exception 'Tournament format has an invalid placement point value.'; end if;

  with parsed_results as (
    select result.value ->> 'participantId' as participant_id,
      (result.value ->> 'placement')::integer as placement,
      (v_placement_points ->> (result.value ->> 'placement'))::integer as points
    from jsonb_array_elements(p_results) result(value)
  )
  update public.lobby_participants participants
  set placement = parsed_results.placement,
      points = parsed_results.points,
      result_status = case when participants.result_status = 'pending' then 'confirmed' else 'corrected' end,
      updated_at = now()
  from parsed_results
  where participants.lobby_id = v_lobby.id and participants.participant_id::text = parsed_results.participant_id;

  update public.participant_round_scores scores
  set score = coalesce((select sum(participants.points) from public.lobbies lobbies join public.lobby_participants participants on participants.lobby_id = lobbies.id where lobbies.round_id = scores.round_id and participants.participant_id = scores.participant_id and participants.result_status in ('confirmed', 'corrected')), 0), updated_at = now()
  where scores.round_id = v_round.id;
  update public.lobbies set updated_at = now() where id = v_lobby.id;

  if p_submission_id is not null then
    select * into v_submission from public.discord_score_submissions where id::text = p_submission_id for update;
    if not found then raise exception 'Score submission was not found.'; end if;
    if v_submission.target_lobby_id is distinct from v_lobby.id then raise exception 'Score submission does not belong to this lobby.'; end if;
    update public.discord_score_submissions
    set status = 'accepted', accepted_game_number = v_lobby.game_number,
        lease_token = null, lease_expires_at = null, error_code = null, error_message = null, updated_at = now()
    where id = v_submission.id;
    if v_was_pending then
      update public.discord_lobby_threads threads
      set accepted_image_count = threads.accepted_image_count + 1,
          last_game_number = v_lobby.game_number,
          last_accepted_at = now(),
          updated_at = now()
      where threads.round_id = v_lobby.round_id and threads.lobby_number = v_lobby.lobby_number;
    end if;
  end if;

  perform public.generate_round_lobbies(v_round.id::text);
  v_response := jsonb_build_object(
    'updated_lobby_id', v_lobby.id::text,
    'updated_participant_count', v_participant_count,
    'round_id', v_round.id::text,
    'lobby_number', v_lobby.lobby_number,
    'game_number', v_lobby.game_number
  );
  if p_idempotency_key is not null then
    insert into public.discord_score_idempotency(idempotency_key, tournament_id, lobby_id, request_hash, response)
    values (p_idempotency_key, v_tournament.id, v_lobby.id, encode(digest(coalesce(p_results, 'null'::jsonb)::text, 'sha256'), 'hex'), v_response);
  end if;
  return query select v_lobby.id::text, v_participant_count, v_round.id::text,
    v_lobby.lobby_number, v_lobby.game_number, false;
end;
$$;

-- check_in_discord_player: fixes the ambiguous-column bug (checked_in_at is
-- both an output column and a tournament_registrations column).
create or replace function public.check_in_discord_player(
  p_tournament_id text,
  p_discord_user_id text
)
returns table(registration_id text, display_name text, checked_in_at timestamptz)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_registration public.tournament_registrations%rowtype;
begin
  select * into v_tournament from public.tournaments
  where id::text = p_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  if v_tournament.check_in_status <> 'open' then raise exception 'Check-in is not currently open.'; end if;
  select * into v_registration from public.tournament_registrations
  where tournament_id = v_tournament.id and discord_user_id = p_discord_user_id
    and registration_status in ('registered', 'waitlisted')
  for update;
  if not found then raise exception 'You must sign up before checking in.'; end if;
  update public.tournament_registrations registrations
  set checked_in_at = coalesce(registrations.checked_in_at, now()), updated_at = now()
  where registrations.id = v_registration.id
  returning * into v_registration;
  return query select v_registration.id::text, v_registration.display_name, v_registration.checked_in_at;
end;
$$;

revoke execute on function public.discord_score_cooldown_remaining_seconds(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.enqueue_discord_score_submission(text, text, text, text, timestamptz, text, text, integer) from public, anon, authenticated;
revoke execute on function public.claim_discord_score_submission(integer) from public, anon, authenticated;
revoke execute on function public.submit_lobby_results(text, text, jsonb, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.check_in_discord_player(text, text) from public, anon, authenticated;
grant execute on function public.discord_score_cooldown_remaining_seconds(timestamptz, integer) to service_role;
grant execute on function public.enqueue_discord_score_submission(text, text, text, text, timestamptz, text, text, integer) to service_role;
grant execute on function public.claim_discord_score_submission(integer) to service_role;
grant execute on function public.submit_lobby_results(text, text, jsonb, text, text, text, text) to service_role;
grant execute on function public.check_in_discord_player(text, text) to service_role;

notify pgrst, 'reload schema';
