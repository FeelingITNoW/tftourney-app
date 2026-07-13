do $$
declare
  target_table text;
  target_column text;
begin
  foreach target_table in array array['players', 'tournament_players']
  loop
    foreach target_column in array array['display_name', 'discord_id']
    loop
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = target_table
          and column_name = target_column
      ) then
        execute format(
          'alter table public.%I alter column %I drop not null',
          target_table,
          target_column
        );
      end if;
    end loop;
  end loop;
end $$;
