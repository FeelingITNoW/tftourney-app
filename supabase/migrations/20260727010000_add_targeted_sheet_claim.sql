-- Claim one explicitly requested export so a Generate/Publish click does not
-- have to wait for the next scheduled batch worker run.

create or replace function public.claim_tournament_sheet_export(
  p_tournament_id text,
  p_host_user_id text
)
returns setof public.tournament_sheet_exports
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select exports.id
    from public.tournament_sheet_exports exports
    where exports.tournament_id::text = p_tournament_id
      and exports.host_user_id::text = p_host_user_id
      and (
        exports.state = 'queued'
        or (exports.state = 'syncing' and (exports.lease_until is null or exports.lease_until < now()))
      )
      and coalesce(exports.next_attempt_at, now()) <= now()
    limit 1
    for update skip locked
  )
  update public.tournament_sheet_exports exports
  set state = 'syncing',
      lease_until = now() + interval '5 minutes',
      updated_at = now()
  from candidate
  where exports.id = candidate.id
  returning exports.*;
end;
$$;

revoke execute on function public.claim_tournament_sheet_export(text, text) from public, anon, authenticated;
grant execute on function public.claim_tournament_sheet_export(text, text) to service_role;
