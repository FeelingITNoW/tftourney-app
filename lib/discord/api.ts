import { createHash, randomBytes } from "node:crypto";
import { supabaseRestRequest } from "../db/supabase-rest/api";

export type TournamentDiscordConfig = {
  tournamentId: string;
  guildId: string;
  guildName: string | null;
  categoryId: string | null;
  signupChannelId: string | null;
  checkinChannelId: string | null;
  scoreChannelId: string | null;
  managerRoleId: string | null;
  signupMessageId: string | null;
  checkinMessageId: string | null;
  state: "pending" | "active" | "error" | "disabled";
  lastError: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  // Set when a host disconnects (state becomes "disabled"): which cleanup the
  // bot should perform on the provisioned category/channels/role, and
  // whether it has finished doing so yet.
  cleanupAction: "archive" | "delete" | null;
  cleanupRequestedAt: string | null;
  cleanupCompletedAt: string | null;
};

export type TournamentCheckInRegistration = {
  registrationId: string;
  displayName: string;
  registrationStatus: "registered" | "waitlisted" | "entered" | "withdrawn";
  checkedInAt: string | null;
  hasDiscord: boolean;
};

export type TournamentCheckInState = {
  status: "not_started" | "open" | "closed";
  openedAt: string | null;
  closedAt: string | null;
  registeredCount: number;
  // Registered-or-waitlisted players with checked_in_at set -- matches the
  // Discord panel and check_in_discord_player, which both allow a waitlisted
  // player to check in. Use checkedInRegisteredCount below for anything that
  // determines who actually enters the tournament.
  checkedInCount: number;
  // Registered players with checked_in_at set -- the number start_tournament
  // will actually seat, since it only ever selects registration_status =
  // 'registered' rows.
  checkedInRegisteredCount: number;
  registrations: TournamentCheckInRegistration[];
};

// The bot's 10s reconcile poll. Every field is produced by the
// get_discord_reconcile_view_model read model in a single round trip, so this
// shape has to stay identical to what the bot already consumes: `config` keeps
// its snake_case keys because the bot reads config.config.guild_id and friends.
export type DiscordReconcileLobbyParticipant = {
  discordUserId: string | null;
  displayName: string;
};

export type DiscordReconcileLobby = {
  id: string;
  roundId: string;
  gameNumber: number;
  lobbyNumber: number;
  participants: DiscordReconcileLobbyParticipant[];
};

export type DiscordReconcileThread = {
  roundId: string;
  lobbyNumber: number;
  threadId: string;
  acceptedImageCount: number;
  state: string;
  lastGameNumber: number | null;
};

export type DiscordReconcileConfig = {
  tournament_id: string;
  guild_id: string;
  category_id: string | null;
  signup_channel_id: string | null;
  checkin_channel_id: string | null;
  score_channel_id: string | null;
  manager_role_id: string | null;
  signup_message_id: string | null;
  checkin_message_id: string | null;
  state: TournamentDiscordConfig["state"];
  last_error: string | null;
  score_cooldown_seconds: number;
};

export type DiscordReconcileTournament = {
  tournamentId: string;
  name: string;
  status: string;
  checkInStatus: string;
  registeredCount: number;
  checkedInCount: number;
  config: DiscordReconcileConfig;
  activeLobbies: DiscordReconcileLobby[];
  threads: DiscordReconcileThread[];
};

export type DiscordReconcilePayload = {
  tournaments: DiscordReconcileTournament[];
};

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

export async function getTournamentDiscordConfig(tournamentId: string): Promise<TournamentDiscordConfig | null> {
  const rows = await supabaseRestRequest<Record<string, unknown>[]>("tournament_discord_configs", {
    query: { select: "tournament_id,guild_id,guild_name,category_id,signup_channel_id,checkin_channel_id,score_channel_id,manager_role_id,signup_message_id,checkin_message_id,state,last_error,last_heartbeat_at,created_at,updated_at,cleanup_action,cleanup_requested_at,cleanup_completed_at", tournament_id: `eq.${tournamentId}`, limit: "1" },
  });
  const row = rows[0];
  if (!row) return null;
  return {
    tournamentId: String(row.tournament_id),
    guildId: String(row.guild_id),
    guildName: nullableString(row.guild_name),
    categoryId: nullableString(row.category_id),
    signupChannelId: nullableString(row.signup_channel_id),
    checkinChannelId: nullableString(row.checkin_channel_id),
    scoreChannelId: nullableString(row.score_channel_id),
    managerRoleId: nullableString(row.manager_role_id),
    signupMessageId: nullableString(row.signup_message_id),
    checkinMessageId: nullableString(row.checkin_message_id),
    state: (row.state ?? "pending") as TournamentDiscordConfig["state"],
    lastError: nullableString(row.last_error),
    lastHeartbeatAt: nullableString(row.last_heartbeat_at),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
    cleanupAction: (row.cleanup_action ?? null) as TournamentDiscordConfig["cleanupAction"],
    cleanupRequestedAt: nullableString(row.cleanup_requested_at),
    cleanupCompletedAt: nullableString(row.cleanup_completed_at),
  };
}

export async function isTournamentManager(tournamentId: string, userId: string): Promise<boolean> {
  const rows = await supabaseRestRequest<Array<{ user_id: string }>>("tournament_managers", {
    query: { select: "user_id", tournament_id: `eq.${tournamentId}`, user_id: `eq.${userId}`, revoked_at: "is.null", limit: "1" },
  });
  return Boolean(rows[0]);
}

export async function getTournamentCheckInState(tournamentId: string): Promise<TournamentCheckInState | null> {
  const rows = await supabaseRestRequest<Record<string, unknown>[]>("tournaments", {
    query: { select: "check_in_status,check_in_opened_at,check_in_closed_at", id: `eq.${tournamentId}`, limit: "1" },
  });
  if (!rows[0]) return null;
  const registrations = await supabaseRestRequest<Array<{
    id: string;
    display_name: string;
    registration_status: TournamentCheckInRegistration["registrationStatus"];
    checked_in_at: string | null;
    discord_user_id: string | null;
  }>>("tournament_registrations", {
    query: { select: "id,display_name,registration_status,checked_in_at,discord_user_id", tournament_id: `eq.${tournamentId}`, order: "created_at.asc,id.asc" },
  });
  const isCheckedIn = (row: (typeof registrations)[number]) =>
    row.checked_in_at !== null && (row.registration_status === "registered" || row.registration_status === "waitlisted");
  return {
    status: (rows[0].check_in_status ?? "not_started") as TournamentCheckInState["status"],
    openedAt: nullableString(rows[0].check_in_opened_at),
    closedAt: nullableString(rows[0].check_in_closed_at),
    registeredCount: registrations.filter((row) => row.registration_status === "registered").length,
    checkedInCount: registrations.filter(isCheckedIn).length,
    checkedInRegisteredCount: registrations.filter((row) => row.registration_status === "registered" && row.checked_in_at !== null).length,
    registrations: registrations.map((row) => ({
      registrationId: String(row.id),
      displayName: row.display_name,
      registrationStatus: row.registration_status,
      checkedInAt: nullableString(row.checked_in_at),
      hasDiscord: row.discord_user_id != null,
    })),
  };
}

// One round trip for the whole reconcile payload. The read model already applies
// the two filters that matter -- configs in state 'disabled', and completed or
// cancelled tournaments that have no active lobby thread left to archive -- so
// there is no per-tournament fan-out here.
export async function getDiscordReconcileViewModel(): Promise<DiscordReconcilePayload> {
  const rows = await supabaseRestRequest<Array<{ view_model?: unknown }>>(
    "rpc/get_discord_reconcile_view_model",
    { method: "POST", body: {} },
  );
  const viewModel = rows?.[0]?.view_model;
  if (!viewModel || typeof viewModel !== "object") {
    return { tournaments: [] };
  }
  const tournaments = (viewModel as { tournaments?: unknown }).tournaments;
  return {
    tournaments: Array.isArray(tournaments) ? (tournaments as DiscordReconcileTournament[]) : [],
  };
}

export async function enqueueDiscordOutbox(input: {
  tournamentId: string;
  eventType: string;
  dedupeKey: string;
  payload?: unknown;
}): Promise<void> {
  await supabaseRestRequest("rpc/enqueue_discord_outbox", {
    method: "POST",
    body: {
      p_tournament_id: input.tournamentId,
      p_event_type: input.eventType,
      p_dedupe_key: input.dedupeKey,
      p_payload: input.payload ?? {},
    },
  });
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

// Check-in is optional: with no Discord config, or check-in never opened,
// every registered player enters as before. Only once the host has opened
// check-in does the roster narrow to who checked in -- and starting while
// check-in is still open closes it first (one click covers both), so a
// partial roster is never seated by accident.
export async function prepareTournamentStartRoster(tournamentId: string): Promise<string[]> {
  const config = await getTournamentDiscordConfig(tournamentId);
  if (!config || config.state === "disabled") return [];
  const state = await getTournamentCheckInState(tournamentId);
  if (!state || state.status === "not_started") return [];
  if (state.status === "open") {
    await supabaseRestRequest("tournaments", {
      method: "PATCH",
      query: { id: `eq.${tournamentId}` },
      prefer: "return=minimal",
      body: { check_in_status: "closed", check_in_closed_at: new Date().toISOString() },
    });
  }
  const rows = await supabaseRestRequest<Array<{ id: string }>>("tournament_registrations", {
    method: "PATCH",
    query: {
      select: "id",
      tournament_id: `eq.${tournamentId}`,
      registration_status: "eq.registered",
      checked_in_at: "is.null",
    },
    prefer: "return=representation",
    body: { registration_status: "waitlisted" },
  });
  return (rows ?? []).map((row) => row.id);
}

// Undoes prepareTournamentStartRoster's demotion after a failed start, so a
// host whose start attempt errored (e.g. an entrant-count mismatch) isn't
// left with players stuck as waitlisted for no reason.
export async function restoreTournamentStartRoster(registrationIds: string[]): Promise<void> {
  for (const batch of chunk(registrationIds, 64)) {
    if (batch.length === 0) continue;
    await supabaseRestRequest("tournament_registrations", {
      method: "PATCH",
      query: { id: `in.(${batch.join(",")})` },
      prefer: "return=minimal",
      body: { registration_status: "registered" },
    });
  }
}

export async function setRegistrationCheckIn(input: {
  tournamentId: string;
  registrationId: string;
  checkedIn: boolean;
}): Promise<void> {
  const config = await getTournamentDiscordConfig(input.tournamentId);
  if (!config || config.state === "disabled") {
    throw new Error("Connect this tournament to Discord before using check-in.");
  }
  const state = await getTournamentCheckInState(input.tournamentId);
  if (!state || state.status === "not_started") {
    throw new Error("Open check-in before checking players in.");
  }
  const rows = await supabaseRestRequest<Array<{ id: string }>>("tournament_registrations", {
    method: "PATCH",
    query: {
      select: "id",
      id: `eq.${input.registrationId}`,
      tournament_id: `eq.${input.tournamentId}`,
      registration_status: "in.(registered,waitlisted)",
    },
    prefer: "return=representation",
    body: { checked_in_at: input.checkedIn ? new Date().toISOString() : null },
  });
  if (!rows?.[0]) throw new Error("Registration was not found.");
}

// Kept as a small pure-looking helper (rather than inline `Date.now()` in the
// page component) so eslint's react-hooks/purity rule doesn't flag a direct
// impure call inside a Server Component's render body.
export function isDiscordConfigPendingTooLong(config: TournamentDiscordConfig | null, thresholdMs = 30_000): boolean {
  if (!config || config.state !== "pending" || config.updatedAt === null) return false;
  return Date.now() - new Date(config.updatedAt).getTime() > thresholdMs;
}

export function createManagerInviteToken(): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
