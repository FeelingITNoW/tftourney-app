// This module used to be ~1.8k lines of mappers, view-model fetchers, and
// mutating commands all in one file. It's now a thin barrel over three
// focused modules -- mappers.ts (pure RPC-row -> domain-object mapping),
// view-models.ts (read-only fetchers), and commands.ts (mutations) -- kept
// here so every existing `from "@/lib/db/tournaments/api"` import keeps
// working unchanged. New code can import from the specific submodule
// directly; this file's export list is exactly the public surface the old
// single file had, no more.
export { TOURNAMENT_STATUS_ACCEPTING_PLAYERS } from "./mappers";
export {
  TOURNAMENT_PAGE_SIZE,
  type TournamentListOptions,
  listTournaments,
  listHostedTournaments,
  type TournamentPageViewOptions,
  getTournamentPageViewModel,
  getTournamentLobbyViewModel,
  getTournamentExportViewModel,
  assertTournamentHost,
} from "./view-models";
export {
  createTournament,
  deleteTournament,
  registerTournamentPlayer,
  startTournament,
  updateLobbyResults,
  submitLobbyResults,
  finalizeTournamentNode,
} from "./commands";
