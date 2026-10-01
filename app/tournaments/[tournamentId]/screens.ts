import type { TournamentPanelView } from "@/lib/db/tournaments/types";

// Screens the tournament page tabs between, replacing the old single
// deep-scroll page. Pre-start and started tournaments show different tab
// sets (see screensFor); "players", "integrations", and "settings" are
// shared between both states.
export type TournamentScreen =
  | "overview"
  | "players"
  | "format"
  | "integrations"
  | "settings"
  | "lobbies"
  | "scoresheet"
  | "graph";

export type TournamentScreenTab = { id: TournamentScreen; label: string };

const PRE_START_SCREENS: TournamentScreenTab[] = [
  { id: "overview", label: "Overview" },
  { id: "players", label: "Players" },
  { id: "format", label: "Format" },
  { id: "integrations", label: "Integrations" },
  { id: "settings", label: "Settings" },
];

const STARTED_SCREENS: TournamentScreenTab[] = [
  { id: "lobbies", label: "Lobbies" },
  { id: "scoresheet", label: "Scoresheet" },
  { id: "graph", label: "Tournament graph" },
  { id: "players", label: "Players" },
  { id: "integrations", label: "Integrations" },
  { id: "settings", label: "Settings" },
];

export function screensFor(hasStarted: boolean): TournamentScreenTab[] {
  return hasStarted ? STARTED_SCREENS : PRE_START_SCREENS;
}

export function defaultScreen(hasStarted: boolean): TournamentScreen {
  return hasStarted ? "lobbies" : "overview";
}

// The DB view model still only knows "lobbies" | "scoresheet" | "graph" |
// "details" -- every other screen (overview, players, format, integrations,
// settings) renders off the always-present shell fields plus the "details"
// panel (registrations/participants), so it maps to "details".
export function screenToPanelView(screen: TournamentScreen): TournamentPanelView {
  if (screen === "lobbies" || screen === "scoresheet" || screen === "graph") {
    return screen;
  }
  return "details";
}

// Used to pick which DB panel to request before hasStarted is known (the
// panel fetch and the hasStarted flag come back in the same call). Any of
// the four DB panels can be requested regardless of start status; once
// hasStarted is known, resolveTournamentScreen decides what to actually
// render and the canonicalization redirect fixes up the URL if needed.
export function panelViewForRequestedView(requestedView: string): TournamentPanelView {
  if (requestedView === "lobbies" || requestedView === "scoresheet" || requestedView === "graph") {
    return requestedView;
  }
  return "details";
}

export type TournamentScreenFlashQuery = {
  discordError: string;
  discordConnected: boolean;
  discordDisconnected: string;
  discordManagerGranted: boolean;
  managerInvite: string;
  authError: string;
  authSuccess: boolean;
  checkInError: string;
  checkInUpdated: string;
  registrationError: string;
  deleteError: string;
  startError: string;
};

// When the URL has no (or an invalid) `view`, route to the screen that
// actually displays whichever flash message a server action just set, so a
// redirect back to this page (e.g. a failed Discord connect) lands somewhere
// that shows it instead of silently landing on the default tab.
function defaultScreenFromFlash(query: TournamentScreenFlashQuery): TournamentScreen | null {
  if (
    query.discordError ||
    query.discordConnected ||
    query.discordDisconnected ||
    query.discordManagerGranted ||
    query.managerInvite ||
    query.authError ||
    query.authSuccess ||
    query.checkInError ||
    query.checkInUpdated
  ) {
    // DiscordPanel and GoogleSheetsPublishingPanel are the only renderers of
    // these flash messages, and both now live on the Integrations screen.
    return "integrations";
  }
  if (query.deleteError) {
    return "settings";
  }
  if (query.registrationError) {
    // The register-player form lives in the modal on the Players screen for
    // both pre-start and started tournaments.
    return "players";
  }
  if (query.startError) {
    return "overview";
  }
  return null;
}

export function resolveTournamentScreen(
  requestedView: string,
  query: TournamentScreenFlashQuery,
  hasStarted: boolean,
): TournamentScreen {
  const ids = screensFor(hasStarted).map((tab) => tab.id);
  if (ids.includes(requestedView as TournamentScreen)) {
    return requestedView as TournamentScreen;
  }
  const fromFlash = defaultScreenFromFlash(query);
  if (fromFlash && ids.includes(fromFlash)) {
    return fromFlash;
  }
  return defaultScreen(hasStarted);
}
