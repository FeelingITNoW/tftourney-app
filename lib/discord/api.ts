import { createHash, randomBytes } from "node:crypto";
import { supabaseRestRequest } from "../db/supabase-rest/api";

export type TournamentDiscordConfig = {
  tournamentId: string;
  guildId: string;
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
};

export type TournamentCheckInState = {
  status: "not_started" | "open" | "closed";
  openedAt: string | null;
  closedAt: string | null;
  registeredCount: number;
  checkedInCount: number;
};

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

export async function getTournamentDiscordConfig(tournamentId: string): Promise<TournamentDiscordConfig | null> {
  const rows = await supabaseRestRequest<Record<string, unknown>[]>("tournament_discord_configs", {
    query: { select: "tournament_id,guild_id,category_id,signup_channel_id,checkin_channel_id,score_channel_id,manager_role_id,signup_message_id,checkin_message_id,state,last_error,last_heartbeat_at", tournament_id: `eq.${tournamentId}`, limit: "1" },
  });
  const row = rows[0];
  if (!row) return null;
  return {
    tournamentId: String(row.tournament_id),
    guildId: String(row.guild_id),
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
  const counts = await supabaseRestRequest<Array<{ registration_status: string; checked_in_at: string | null }>>("tournament_registrations", {
    query: { select: "registration_status,checked_in_at", tournament_id: `eq.${tournamentId}` },
  });
  return {
    status: (rows[0].check_in_status ?? "not_started") as TournamentCheckInState["status"],
    openedAt: nullableString(rows[0].check_in_opened_at),
    closedAt: nullableString(rows[0].check_in_closed_at),
    registeredCount: counts.filter((row) => row.registration_status === "registered").length,
    checkedInCount: counts.filter((row) => row.checked_in_at !== null && ["registered", "waitlisted"].includes(row.registration_status)).length,
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

export async function prepareConnectedTournamentStart(tournamentId: string): Promise<void> {
  const config = await getTournamentDiscordConfig(tournamentId);
  if (!config) return;
  const state = await getTournamentCheckInState(tournamentId);
  if (!state || state.status !== "closed") {
    throw new Error("Close Discord check-in before starting this tournament.");
  }
  await supabaseRestRequest("tournament_registrations", {
    method: "PATCH",
    query: {
      tournament_id: `eq.${tournamentId}`,
      registration_status: "eq.registered",
      checked_in_at: "is.null",
    },
    prefer: "return=minimal",
    body: { registration_status: "waitlisted" },
  });
}

export function createManagerInviteToken(): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
