import { submitLobbyResultsRequest, discordErrorResponse } from "../../../../../../../lib/discord/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ tournamentId: string; lobbyId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { tournamentId, lobbyId } = await context.params;
    return await submitLobbyResultsRequest(request, tournamentId, lobbyId);
  } catch (error) {
    return discordErrorResponse(error, "Lobby results could not be submitted.");
  }
}
