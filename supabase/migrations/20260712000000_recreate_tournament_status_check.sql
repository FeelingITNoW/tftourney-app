alter table public.tournaments
  add column if not exists status text not null default 'accepting_players';

alter table public.tournaments
  drop constraint if exists tournaments_status_check;

update public.tournaments
set status = case
  when status in ('accepting_players', 'in_progress', 'completed', 'cancelled') then status
  when status in (
    'draft',
    'open',
    'pending',
    'registration_open',
    'waiting_for_players',
    'accepting_registrations'
  ) then 'accepting_players'
  when status in ('active', 'running', 'started') then 'in_progress'
  when status in ('complete', 'finished') then 'completed'
  when status = 'canceled' then 'cancelled'
  else 'accepting_players'
end
where status is null
  or status not in ('accepting_players', 'in_progress', 'completed', 'cancelled');

alter table public.tournaments
  alter column status set default 'accepting_players',
  alter column status set not null,
  add constraint tournaments_status_check check (
    status in ('accepting_players', 'in_progress', 'completed', 'cancelled')
  );
