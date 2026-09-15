import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { registerTournamentPlayer } from "../../../../../lib/db/tournaments/api";
import { getRiotAccountByRiotId } from "../../../../../lib/riot/accounts/api";
import { validatePlayerRegistration } from "../../../../../lib/tournament/players/api";
import { getTournamentDiscordConfig } from "../../../../../lib/discord/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const body = await request.json() as { tournamentId?: unknown; discordUserId?: unknown; gameTag?: unknown };
    const tournamentId = typeof body.tournamentId === "string" ? body.tournamentId : "";
    const discordUserId = typeof body.discordUserId === "string" ? body.discordUserId : "";
    const gameTag = typeof body.gameTag === "string" ? body.gameTag : "";
    if (!tournamentId || !discordUserId || !gameTag) return Response.json({ error: "Tournament, Discord user, and Riot ID are required.", code: "INPUT_REQUIRED" }, { status: 400 });
    // A disconnected (state: "disabled") tournament can still have a live,
    // orphaned sign-up panel in Discord -- refuse it explicitly.
    const config = await getTournamentDiscordConfig(tournamentId);
    if (!config || config.state === "disabled") return Response.json({ error: "This tournament is not connected to Discord.", code: "NOT_CONNECTED" }, { status: 409 });
    const validation = validatePlayerRegistration({ gameTag });
    if (!validation.success) return Response.json({ error: validation.errors.gameTag ?? "Invalid Riot ID.", code: "INVALID_RIOT_ID" }, { status: 422 });
    const riotAccount = await getRiotAccountByRiotId(validation.data);
    const registration = await registerTournamentPlayer({ tournamentId, riotAccount, discordUserId });
    return Response.json(registration, { status: 201 });
  } catch (error) {
    return discordErrorResponse(error, "Player could not be registered.");
  }
}
