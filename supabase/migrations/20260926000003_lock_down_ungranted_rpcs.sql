-- Every mutating or data-returning RPC in this schema is meant to be
-- service-role-only -- see the revoke/grant pairs throughout this migration
-- history for submit_lobby_results, update_lobby_results, the
-- get_*_view_model functions, and so on. Five functions were missed when
-- they were first created and have been callable by anon/authenticated ever
-- since (confirmed against a from-scratch local database built from this
-- exact migration history, which is the only way to see a function's actual
-- default grants rather than assuming a later revoke exists):
--
-- - randomize_pending_lobby_results and start_linear_tournament mutate real
--   tournament data (the former is explicitly a testing helper -- see
--   docs/database-schema.md -- and was directly callable against any live
--   tournament by anyone with the public anon key).
-- - compact_tournament_format_v3, graph_config_node, and graph_config_edges
--   are pure functions with no side effects, but have no legitimate reason
--   to be called directly either.
--
-- start_tournament, checkmate_decisive_game, generate_round_lobbies, and
-- finalize_tournament_node had the same gap and are fixed alongside their
-- own redefinitions in 20260926000000 and 20260926000002 instead of here.
revoke execute on function public.randomize_pending_lobby_results(text, text) from public, anon, authenticated;
revoke execute on function public.start_linear_tournament(text) from public, anon, authenticated;
revoke execute on function public.compact_tournament_format_v3(jsonb) from public, anon, authenticated;
revoke execute on function public.graph_config_node(jsonb, text) from public, anon, authenticated;
revoke execute on function public.graph_config_edges(jsonb) from public, anon, authenticated;
grant execute on function public.randomize_pending_lobby_results(text, text) to service_role;
grant execute on function public.start_linear_tournament(text) to service_role;
grant execute on function public.compact_tournament_format_v3(jsonb) to service_role;
grant execute on function public.graph_config_node(jsonb, text) to service_role;
grant execute on function public.graph_config_edges(jsonb) to service_role;

notify pgrst, 'reload schema';
