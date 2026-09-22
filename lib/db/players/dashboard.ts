import { supabaseRestRequest } from "../supabase-rest/api";

export type PlayerTournamentItem = {
  id: string;
  name: string;
  status: string;
  checkInStatus: string;
  registeredPlayerCount: number;
  maxPlayers: number;
  isRegistered: boolean;
  registrationStatus: string | null;
  checkedIn: boolean;
  participated: boolean;
  createdAt: string;
};

export type PlayerDashboardViewModel = {
  playerAccountId: string | null;
  username: string | null;
  email: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  riotPuuid: string | null;
  riotGameTag: string | null;
  tournaments: PlayerTournamentItem[];
  signedUpCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function valueAt(row: Record<string, unknown>, snake: string, camel = snake): unknown {
  return row[camel] ?? row[snake];
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

// Maps the get_player_dashboard_view_model payload into a view model the player
// page can render directly: every tournament available to play, plus which ones
// this player has already signed up for.
export function mapPlayerDashboardViewModel(rawValue: unknown): PlayerDashboardViewModel {
  const raw = asRecord(rawValue);
  const tournaments = asArray(valueAt(raw, "tournaments")).map((value) => {
    const row = asRecord(value);
    const registrationStatus = valueAt(row, "registration_status", "registrationStatus");
    return {
      id: asString(valueAt(row, "id")),
      name: asString(valueAt(row, "name"), "Untitled tournament"),
      status: asString(valueAt(row, "status"), "accepting_players"),
      checkInStatus: asString(valueAt(row, "check_in_status", "checkInStatus"), "not_started"),
      registeredPlayerCount: asNumber(valueAt(row, "registered_player_count", "registeredPlayerCount")),
      maxPlayers: asNumber(valueAt(row, "max_players", "maxPlayers")),
      isRegistered: asBoolean(valueAt(row, "registered")),
      registrationStatus: registrationStatus == null ? null : asString(registrationStatus),
      checkedIn: asBoolean(valueAt(row, "checked_in", "checkedIn")),
      participated: asBoolean(valueAt(row, "participated")),
      createdAt: asString(valueAt(row, "created_at", "createdAt")),
    } satisfies PlayerTournamentItem;
  });
  return {
    playerAccountId: asNullableString(valueAt(raw, "player_account_id", "playerAccountId")),
    username: asNullableString(valueAt(raw, "username")),
    email: asNullableString(valueAt(raw, "email")),
    discordUserId: asNullableString(valueAt(raw, "discord_user_id", "discordUserId")),
    discordUsername: asNullableString(valueAt(raw, "discord_username", "discordUsername")),
    discordAvatar: asNullableString(valueAt(raw, "discord_avatar", "discordAvatar")),
    riotPuuid: asNullableString(valueAt(raw, "riot_puuid", "riotPuuid")),
    riotGameTag: asNullableString(valueAt(raw, "riot_game_tag", "riotGameTag")),
    tournaments,
    signedUpCount: tournaments.filter((tournament) => tournament.isRegistered).length,
  };
}

export async function getPlayerDashboard(
  playerAccountId: string,
): Promise<PlayerDashboardViewModel | null> {
  const rows = await supabaseRestRequest<Array<{ view_model?: unknown }>>(
    "rpc/get_player_dashboard_view_model",
    { method: "POST", body: { p_player_account_id: playerAccountId } },
  );
  const viewModel = rows[0]?.view_model;
  if (!viewModel || typeof viewModel !== "object") return null;
  return mapPlayerDashboardViewModel(viewModel);
}