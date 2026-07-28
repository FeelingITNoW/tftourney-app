-- Organizer identity linking and host ownership hardening.

alter table public.users
  add column if not exists auth_user_id uuid unique;

create unique index if not exists users_auth_user_id_idx
  on public.users(auth_user_id)
  where auth_user_id is not null;

create index if not exists tournaments_host_created_at_idx
  on public.tournaments(host_user_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournaments_host_user_id_fkey'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_host_user_id_fkey
      foreign key (host_user_id) references public.users(id) on delete restrict;
  end if;
end $$;

create or replace function public.claim_or_create_organizer(
  p_auth_user_id uuid,
  p_email text
)
returns table(id bigint, email text, auth_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.users;
  normalized_email text := lower(trim(p_email));
begin
  select * into existing
  from public.users
  where users.auth_user_id = p_auth_user_id
  for update;

  if found then
    return query select existing.id, existing.email::text, existing.auth_user_id;
    return;
  end if;

  select * into existing
  from public.users
  where lower(users.email) = normalized_email
  order by users.id asc
  limit 1
  for update;

  if found then
    if existing.auth_user_id is not null and existing.auth_user_id <> p_auth_user_id then
      raise exception 'Organizer email is already linked to another account.' using errcode = 'unique_violation';
    end if;
    update public.users
    set auth_user_id = p_auth_user_id,
        email = normalized_email,
        updated_at = now()
    where users.id = existing.id
    returning users.* into existing;
    return query select existing.id, existing.email::text, existing.auth_user_id;
    return;
  end if;

  select * into existing
  from public.users
  where users.id = 1
    and users.auth_user_id is null
  for update;

  if found then
    update public.users
    set auth_user_id = p_auth_user_id,
        email = normalized_email,
        updated_at = now()
    where users.id = existing.id
    returning users.* into existing;
    return query select existing.id, existing.email::text, existing.auth_user_id;
    return;
  end if;

  insert into public.users (email, auth_user_id)
  values (normalized_email, p_auth_user_id)
  returning users.* into existing;
  return query select existing.id, existing.email::text, existing.auth_user_id;
end;
$$;

revoke execute on function public.claim_or_create_organizer(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_or_create_organizer(uuid, text) to service_role;
