import { NextResponse } from "next/server";
import { appRedirect } from "../../../../../../lib/app-url";
import { errorLogFields } from "../../../../../../lib/auth/log";
import { getHostUserId } from "../../../../../../lib/auth/session";
import { assertTournamentHost } from "../../../../../../lib/db/tournaments/api";
import { supabaseRestRequest } from "../../../../../../lib/db/supabase-rest/api";
import { enqueueDiscordOutbox } from "../../../../../../lib/discord/api";

export const runtime = "nodejs";

const COOKIE_NAMES = ["tftourney-discord-bot-state", "tftourney-discord-bot-tournament"];
const COOKIE_PATH = "/api/auth/discord/bot-install";

function cookieValue(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? "";
}

function clearCookies(response: NextResponse): NextResponse {
  for (const name of COOKIE_NAMES) response.cookies.set(name, "", { maxAge: 0, path: COOKIE_PATH });
  return response;
}

function fail(request: Request, returnTo: string, message: string): NextResponse {
  return clearCookies(appRedirect(returnTo, { discordError: message }));
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const guildId = url.searchParams.get("guild_id") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedState = cookieValue(request, "tftourney-discord-bot-state");
  const tournamentId = cookieValue(request, "tftourney-discord-bot-tournament");
  const returnTo = tournamentId ? `/tournaments/${tournamentId}` : "/";

  if (url.searchParams.get("error")) return fail(request, returnTo, "Discord authorization was cancelled.");
  if (!state || !expectedState || state !== expectedState || !tournamentId) {
    return fail(request, returnTo, "Discord authorization could not be verified. Please try again.");
  }
  if (!/^\d{5,25}$/.test(guildId)) return fail(request, returnTo, "Discord did not return a valid server ID.");

  const hostUserId = await getHostUserId(request);
  if (!hostUserId) return fail(request, returnTo, "Sign in as the tournament host to finish connecting Discord.");
  try {
    await assertTournamentHost(tournamentId, hostUserId);
  } catch {
    return fail(request, returnTo, "Only the tournament host can connect Discord.");
  }

  try {
    // Same upsert shape as the manual connectDiscordAction path: re-running this
    // (e.g. re-authorizing) only refreshes guild_id/state, never clears IDs the
    // bot has already provisioned.
    await supabaseRestRequest("tournament_discord_configs", {
      method: "POST",
      query: { on_conflict: "tournament_id" },
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { tournament_id: tournamentId, guild_id: guildId, state: "pending", last_error: null, updated_at: new Date().toISOString(), cleanup_action: null, cleanup_requested_at: null, cleanup_completed_at: null },
    });
    await enqueueDiscordOutbox({
      tournamentId,
      eventType: "provision_tournament",
      dedupeKey: `provision:${guildId}:${Date.now()}`,
      payload: { guildId },
    });
  } catch (error) {
    console.error("[discord-auth] Bot-install provisioning failed", errorLogFields(error));
    return fail(request, returnTo, error instanceof Error ? error.message : "Discord could not be connected.");
  }

  return clearCookies(appRedirect(returnTo, { discordConnected: "true" }));
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[discord-auth] Bot-install callback failed unexpectedly", errorLogFields(error));
    const tournamentId = cookieValue(request, "tftourney-discord-bot-tournament");
    return fail(request, tournamentId ? `/tournaments/${tournamentId}` : "/", "Discord could not be connected. Please try again.");
  }
}
