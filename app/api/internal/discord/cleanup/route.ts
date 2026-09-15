import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";

export const runtime = "nodejs";

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

// Disconnected tournaments (state: "disabled") are excluded from the normal
// /reconcile payload -- the bot is meant to stop touching them. This route is
// the separate, narrow channel for the one thing it still needs to do for a
// disabled tournament: archive or delete the category/channels/role it
// provisioned, once, the first time it sees a pending cleanup request.
export async function GET(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const configs = await supabaseRestRequest<Array<Record<string, unknown>>>("tournament_discord_configs", {
      query: {
        select: "tournament_id,guild_id,category_id,signup_channel_id,checkin_channel_id,score_channel_id,manager_role_id,cleanup_action",
        state: "eq.disabled",
        cleanup_action: "not.is.null",
        cleanup_completed_at: "is.null",
      },
    });
    if (configs.length === 0) return Response.json({ cleanups: [] });
    const tournamentIds = configs.map((config) => String(config.tournament_id));
    const tournaments = await supabaseRestRequest<Array<{ id: string; name: string }>>("tournaments", {
      query: { select: "id,name", id: `in.(${tournamentIds.join(",")})` },
    });
    const nameById = new Map(tournaments.map((tournament) => [String(tournament.id), tournament.name]));
    const cleanups = configs.map((config) => ({
      tournamentId: String(config.tournament_id),
      name: nameById.get(String(config.tournament_id)) ?? "Tournament",
      guildId: String(config.guild_id),
      categoryId: nullableString(config.category_id),
      signupChannelId: nullableString(config.signup_channel_id),
      checkinChannelId: nullableString(config.checkin_channel_id),
      scoreChannelId: nullableString(config.score_channel_id),
      managerRoleId: nullableString(config.manager_role_id),
      cleanupAction: config.cleanup_action as "archive" | "delete",
    }));
    return Response.json({ cleanups });
  } catch (error) {
    return discordErrorResponse(error, "Discord cleanup queue could not be loaded.");
  }
}
