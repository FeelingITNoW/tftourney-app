-- Deleting a tournament is the aggregate boundary: every registration and
-- gameplay record owned by it must be removed in the same transaction.
do $$
declare
  foreign_key record;
begin
  for foreign_key in
    select c.conrelid::regclass as child_table, c.conname
    from pg_constraint c
    where c.contype = 'f'
      and (
        (
          c.conrelid = 'public.tournament_registrations'::regclass
          and c.confrelid = 'public.tournaments'::regclass
        )
        or (
          c.conrelid = 'public.tournament_participants'::regclass
          and c.confrelid in (
            'public.tournaments'::regclass,
            'public.tournament_registrations'::regclass
          )
        )
        or (
          c.conrelid = 'public.rounds'::regclass
          and c.confrelid = 'public.tournaments'::regclass
        )
        or (
          c.conrelid = 'public.lobbies'::regclass
          and c.confrelid = 'public.rounds'::regclass
        )
        or (
          c.conrelid = 'public.lobby_participants'::regclass
          and c.confrelid in (
            'public.lobbies'::regclass,
            'public.tournament_participants'::regclass
          )
        )
        or (
          c.conrelid = 'public.participant_round_scores'::regclass
          and c.confrelid in (
            'public.rounds'::regclass,
            'public.tournament_participants'::regclass
          )
        )
      )
  loop
    execute format(
      'alter table %s drop constraint %I',
      foreign_key.child_table,
      foreign_key.conname
    );
  end loop;
end $$;

alter table public.tournament_registrations
  add constraint tournament_registrations_tournament_id_fkey
  foreign key (tournament_id)
  references public.tournaments(id)
  on delete cascade;

alter table public.tournament_participants
  add constraint tournament_participants_tournament_id_fkey
  foreign key (tournament_id)
  references public.tournaments(id)
  on delete cascade,
  add constraint tournament_participants_registration_tournament_fk
  foreign key (registration_id, tournament_id)
  references public.tournament_registrations(id, tournament_id)
  on delete cascade;

alter table public.rounds
  add constraint rounds_tournament_id_fkey
  foreign key (tournament_id)
  references public.tournaments(id)
  on delete cascade;

alter table public.lobbies
  add constraint lobbies_round_id_fkey
  foreign key (round_id)
  references public.rounds(id)
  on delete cascade;

alter table public.lobby_participants
  add constraint lobby_participants_lobby_id_fkey
  foreign key (lobby_id)
  references public.lobbies(id)
  on delete cascade,
  add constraint lobby_participants_participant_fk
  foreign key (participant_id)
  references public.tournament_participants(id)
  on delete cascade;

alter table public.participant_round_scores
  add constraint participant_round_scores_round_fk
  foreign key (round_id)
  references public.rounds(id)
  on delete cascade,
  add constraint participant_round_scores_participant_fk
  foreign key (participant_id)
  references public.tournament_participants(id)
  on delete cascade;

-- A cascaded registration delete runs after the parent tournament row is no
-- longer visible. Permit that case while retaining the registration lock for
-- direct changes to an existing tournament.
create or replace function public.prevent_registration_after_start()
returns trigger
language plpgsql
as $$
declare
  registration_tournament_id text;
  tournament_status text;
begin
  registration_tournament_id := case
    when tg_op = 'DELETE' then old.tournament_id::text
    else new.tournament_id::text
  end;

  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  select t.status
  into tournament_status
  from public.tournaments t
  where t.id::text = registration_tournament_id
  for key share;

  if tournament_status is null and tg_op = 'DELETE' then
    return old;
  end if;

  if tournament_status is null then
    raise exception 'Tournament was not found.';
  end if;

  if tournament_status <> 'accepting_players' then
    raise exception 'Registration is closed because the tournament has started.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;
