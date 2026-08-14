-- Discord tournament operations: provisioning, check-in, durable screenshot intake,
-- and an idempotent score-write boundary.

create extension if not exists pgcrypto;

alter table public.tournaments
  add column if not exists check_in_status text not null default 'not_started',
  add column if not exists check_in_opened_at timestamptz,
  add column if not exists check_in_closed_at timestamptz,
  add column if not exists ended_at timestamptz;

update public.tournaments
set ended_at = coalesce(ended_at, now())
where status in ('completed', 'cancelled') and ended_at is null;

create or replace function public.set_tournament_ended_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('completed', 'cancelled') and (old.status is distinct from new.status or old.ended_at is null) then
    new.ended_at := coalesce(new.ended_at, now());
  elsif new.status not in ('completed', 'cancelled') then
    new.ended_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tournaments_set_ended_at on public.tournaments;
create trigger tournaments_set_ended_at
before update of status, ended_at on public.tournaments
for each row execute function public.set_tournament_ended_at();

do $$
begin
  alter table public.tournaments
    add constraint tournaments_check_in_status_check
    check (check_in_status in ('not_started', 'open', 'closed'));
exception when duplicate_object then null;
end $$;

alter table public.tournament_registrations
  add column if not exists discord_user_id text,
  add column if not exists checked_in_at timestamptz;

create unique index if not exists tournament_registrations_discord_user_idx
  on public.tournament_registrations(tournament_id, discord_user_id)
  where discord_user_id is not null;

create table if not exists public.tournament_discord_configs (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  guild_id text not null,
  category_id text,
  signup_channel_id text,
  checkin_channel_id text,
  score_channel_id text,
  manager_role_id text,
  signup_message_id text,
  checkin_message_id text,
  state text not null default 'pending'
    check (state in ('pending', 'active', 'error', 'disabled')),
  last_error text,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, guild_id)
);

create table if not exists public.tournament_managers (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  discord_user_id text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (tournament_id, user_id),
  unique (tournament_id, discord_user_id)
);

create index if not exists tournament_managers_user_idx
  on public.tournament_managers(user_id)
  where revoked_at is null;

create table if not exists public.tournament_manager_invites (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by_user_id bigint references public.users(id) on delete set null,
  claimed_discord_user_id text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tournament_manager_invites_active_idx
  on public.tournament_manager_invites(tournament_id, expires_at)
  where claimed_at is null and revoked_at is null;

create table if not exists public.discord_lobby_threads (
  round_id uuid not null references public.rounds(id) on delete cascade,
  lobby_number integer not null check (lobby_number > 0),
  thread_id text not null unique,
  accepted_image_count integer not null default 0 check (accepted_image_count >= 0),
  state text not null default 'active'
    check (state in ('active', 'archived', 'error')),
  last_game_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (round_id, lobby_number)
);

create table if not exists public.discord_score_submissions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  thread_id text not null,
  discord_message_id text not null unique,
  discord_user_id text not null,
  target_lobby_id uuid references public.lobbies(id) on delete set null,
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  received_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'needs_review', 'accepted', 'rejected', 'rejected_overflow', 'rejected_spam', 'failed')),
  queue_position integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  ocr_result jsonb,
  error_code text,
  error_message text,
  accepted_game_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discord_score_submissions_queue_idx
  on public.discord_score_submissions(thread_id, received_at, id)
  where status in ('queued', 'processing', 'needs_review');

create index if not exists discord_score_submissions_tournament_idx
  on public.discord_score_submissions(tournament_id, status, created_at);

create table if not exists public.discord_score_idempotency (
  idempotency_key text primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.discord_outbox (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  event_type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, dedupe_key)
);

create index if not exists discord_outbox_claim_idx
  on public.discord_outbox(state, available_at, id);

alter table public.tournament_discord_configs enable row level security;
alter table public.tournament_managers enable row level security;
alter table public.tournament_manager_invites enable row level security;
alter table public.discord_lobby_threads enable row level security;
alter table public.discord_score_submissions enable row level security;
alter table public.discord_score_idempotency enable row level security;
alter table public.discord_outbox enable row level security;

create or replace function public.enqueue_discord_outbox(
  p_tournament_id text,
  p_event_type text,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb
)
returns table(outbox_id bigint, was_created boolean)
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into public.discord_outbox(tournament_id, event_type, dedupe_key, payload)
  values (p_tournament_id::uuid, p_event_type, p_dedupe_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (tournament_id, dedupe_key) do update
    set payload = excluded.payload,
        state = case when public.discord_outbox.state = 'completed' then public.discord_outbox.state else 'pending' end,
        available_at = now(),
        updated_at = now()
  returning id into v_id;
  return query select v_id, true;
end;
$$;

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
  update public.tournament_registrations
  set checked_in_at = coalesce(checked_in_at, now()), updated_at = now()
  where id = v_registration.id
  returning * into v_registration;
  return query select v_registration.id::text, v_registration.display_name, v_registration.checked_in_at;
end;
$$;

create or replace function public.enqueue_discord_score_submission(
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
  accepted_image_count integer
)
language plpgsql
as $$
declare
  v_existing public.discord_score_submissions%rowtype;
  v_thread public.discord_lobby_threads%rowtype;
  v_tournament public.tournaments%rowtype;
  v_pending integer;
  v_position integer;
  v_submission public.discord_score_submissions%rowtype;
begin
  perform set_config('lock_timeout', '2s', true);
  select * into v_existing
  from public.discord_score_submissions
  where discord_message_id = p_discord_message_id;
  if found then
    return query select v_existing.id::text, v_existing.status, v_existing.queue_position,
      v_existing.round_id::text, null::integer, 0;
    return;
  end if;

  select * into v_thread
  from public.discord_lobby_threads
  where thread_id = p_thread_id
  for update;
  if not found then raise exception 'Discord lobby thread is not registered.'; end if;

  -- Recheck after the thread lock to make duplicate Discord delivery retries
  -- return the original queue row instead of racing the unique constraint.
  select * into v_existing
  from public.discord_score_submissions
  where discord_message_id = p_discord_message_id;
  if found then
    return query select v_existing.id::text, v_existing.status, v_existing.queue_position,
      v_existing.round_id::text, null::integer, 0;
    return;
  end if;

  select * into v_tournament
  from public.tournaments
  where id = (select rounds.tournament_id from public.rounds rounds where rounds.id = v_thread.round_id)
    and id::text = p_tournament_id
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

  if v_pending >= 3 then
    insert into public.discord_score_submissions(
      tournament_id, round_id, thread_id, discord_message_id, discord_user_id,
      storage_path, mime_type, byte_size, received_at, status, queue_position,
      error_code, error_message
    ) values (
      v_tournament.id, v_thread.round_id, p_thread_id, p_discord_message_id, p_discord_user_id,
      p_storage_path, p_mime_type, p_byte_size, p_received_at, 'rejected_overflow', v_position,
      'QUEUE_FULL', 'Too many screenshots are already waiting for this lobby.'
    ) returning id into v_submission;
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
    ) returning id into v_submission;
  else
    insert into public.discord_score_submissions(
      tournament_id, round_id, thread_id, discord_message_id, discord_user_id,
      storage_path, mime_type, byte_size, received_at, status, queue_position
    ) values (
      v_tournament.id, v_thread.round_id, p_thread_id, p_discord_message_id, p_discord_user_id,
      p_storage_path, p_mime_type, p_byte_size, p_received_at, 'queued', v_position
    ) returning id into v_submission;
  end if;

  return query select v_submission.id::text, v_submission.status, v_submission.queue_position,
    v_submission.round_id::text, v_thread.lobby_number, v_thread.accepted_image_count;
end;
$$;

create or replace function public.claim_discord_score_submission(
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
  attempt_count integer
)
language plpgsql
as $$
declare
  v_submission public.discord_score_submissions%rowtype;
  v_thread public.discord_lobby_threads%rowtype;
  v_lobby public.lobbies%rowtype;
  v_token uuid := gen_random_uuid();
begin
  update public.discord_score_submissions
  set status = case when attempt_count >= 3 then 'needs_review' else 'queued' end,
      lease_token = null, lease_expires_at = null,
      error_code = case when attempt_count >= 3 then 'PROCESSING_RETRIES_EXHAUSTED' else error_code end,
      error_message = case when attempt_count >= 3 then 'The screenshot worker could not process this image after three attempts.' else error_message end,
      updated_at = now()
  where status = 'processing' and lease_expires_at < now();

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

  select * into v_thread from public.discord_lobby_threads
  where thread_id = v_submission.thread_id for update;

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
    update public.discord_score_submissions
    set status = 'failed', error_code = 'NO_PENDING_GAME',
        error_message = 'No pending game is available for this lobby thread.', updated_at = now()
    where id = v_submission.id;
    return;
  end if;

  update public.discord_score_submissions
  set status = 'processing', target_lobby_id = v_lobby.id,
      lease_token = v_token, lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      attempt_count = attempt_count + 1, updated_at = now()
  where id = v_submission.id;

  return query select v_submission.id::text, v_submission.tournament_id::text,
    v_submission.round_id::text, v_submission.thread_id, v_lobby.id::text,
    v_lobby.game_number, v_token::text, v_submission.storage_path,
    v_submission.attempt_count + 1;
end;
$$;

create or replace function public.mark_discord_submission_review(
  p_submission_id text,
  p_lease_token text,
  p_ocr_result jsonb,
  p_error_code text,
  p_error_message text
)
returns table(updated_submission_id text, updated_status text)
language plpgsql
as $$
begin
  update public.discord_score_submissions
  set status = 'needs_review', ocr_result = p_ocr_result,
      error_code = p_error_code, error_message = p_error_message,
      lease_token = null, lease_expires_at = null, updated_at = now()
  where id::text = p_submission_id
    and lease_token::text = p_lease_token
    and status = 'processing';
  if not found then raise exception 'Score submission lease is no longer valid.'; end if;
  return query select p_submission_id, 'needs_review';
end;
$$;

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
  select * into v_lobby from public.lobbies
  where id::text = p_lobby_id and round_id = v_round.id for update;
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
    where id = v_submission.id and status in ('processing', 'needs_review');
    if v_was_pending then
      update public.discord_lobby_threads
      set accepted_image_count = accepted_image_count + 1,
          last_game_number = v_lobby.game_number, updated_at = now()
      where round_id = v_lobby.round_id and lobby_number = v_lobby.lobby_number;
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

create or replace function public.update_lobby_results(
  p_tournament_id text,
  p_lobby_id text,
  p_results jsonb
)
returns table(updated_lobby_id text, updated_participant_count integer)
language plpgsql
as $$
begin
  return query select result.updated_lobby_id, result.updated_participant_count
  from public.submit_lobby_results(p_tournament_id, p_lobby_id, p_results, null, 'web', null, 'correct') result;
end;
$$;

-- All Discord and score-write RPCs are invoked through the server-side service
-- role. Do not expose queue leases or score mutation primitives to browser JWTs.
revoke execute on function public.enqueue_discord_outbox(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.check_in_discord_player(text, text) from public, anon, authenticated;
revoke execute on function public.enqueue_discord_score_submission(text, text, text, text, timestamptz, text, text, integer) from public, anon, authenticated;
revoke execute on function public.claim_discord_score_submission(integer) from public, anon, authenticated;
revoke execute on function public.mark_discord_submission_review(text, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.submit_lobby_results(text, text, jsonb, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.update_lobby_results(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_discord_outbox(text, text, text, jsonb) to service_role;
grant execute on function public.check_in_discord_player(text, text) to service_role;
grant execute on function public.enqueue_discord_score_submission(text, text, text, text, timestamptz, text, text, integer) to service_role;
grant execute on function public.claim_discord_score_submission(integer) to service_role;
grant execute on function public.mark_discord_submission_review(text, text, jsonb, text, text) to service_role;
grant execute on function public.submit_lobby_results(text, text, jsonb, text, text, text, text) to service_role;
grant execute on function public.update_lobby_results(text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
