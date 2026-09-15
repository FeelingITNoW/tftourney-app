import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";

export const runtime = "nodejs";

function inFilter(values: string[]): string | null {
  return values.length ? `in.(${values.join(",")})` : null;
}

export async function GET(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const configs = await supabaseRestRequest<Array<Record<string, unknown>>>("tournament_discord_configs", {
      query: { select: "tournament_id,guild_id,category_id,signup_channel_id,checkin_channel_id,score_channel_id,manager_role_id,signup_message_id,checkin_message_id,state,last_error,score_cooldown_seconds", state: "not.in.(disabled)" },
    });
    const tournaments = [];
    for (const config of configs) {
      const tournamentId = String(config.tournament_id);
      const tournamentRows = await supabaseRestRequest<Array<Record<string, unknown>>>("tournaments", {
        query: { select: "id,name,status,check_in_status", id: `eq.${tournamentId}`, limit: "1" },
      });
      const tournament = tournamentRows[0];
      if (!tournament) continue;
      const rounds = await supabaseRestRequest<Array<Record<string, unknown>>>("rounds", {
        query: { select: "id,status,round_number,stage_name", tournament_id: `eq.${tournamentId}` },
      });
      const roundIds = rounds.map((round) => String(round.id));
      const activeRounds = rounds.filter((round) => round.status === "active");
      const lobbies = await supabaseRestRequest<Array<Record<string, unknown>>>("lobbies", {
        query: { select: "id,round_id,game_number,lobby_number", round_id: inFilter(roundIds) ?? "in.(0)" },
      });
      const lobbyIds = lobbies.map((lobby) => String(lobby.id));
      const lobbyParticipants = await supabaseRestRequest<Array<Record<string, unknown>>>("lobby_participants", {
        query: { select: "lobby_id,participant_id,slot_number", lobby_id: inFilter(lobbyIds) ?? "in.(0)" },
      });
      const participantIds = [...new Set(lobbyParticipants.map((row) => String(row.participant_id)))];
      const participants = await supabaseRestRequest<Array<Record<string, unknown>>>("tournament_participants", {
        query: { select: "id,registration_id,display_name_at_start", id: inFilter(participantIds) ?? "in.(00000000-0000-0000-0000-000000000000)" },
      });
      const registrationIds = participants.map((row) => String(row.registration_id));
      const registrations = await supabaseRestRequest<Array<Record<string, unknown>>>("tournament_registrations", {
        query: { select: "id,discord_user_id", id: inFilter(registrationIds) ?? "in.(0)" },
      });
      const participantById = new Map(participants.map((row) => [String(row.id), row]));
      const registrationById = new Map(registrations.map((row) => [String(row.id), row]));
      const activeRoundIds = new Set(activeRounds.map((round) => String(round.id)));
      const activeLobbies = lobbies.filter((lobby) => activeRoundIds.has(String(lobby.round_id))).map((lobby) => ({
        id: String(lobby.id),
        roundId: String(lobby.round_id),
        gameNumber: Number(lobby.game_number),
        lobbyNumber: Number(lobby.lobby_number),
        participants: lobbyParticipants.filter((row) => String(row.lobby_id) === String(lobby.id)).map((row) => {
          const participant = participantById.get(String(row.participant_id));
          const registration = participant ? registrationById.get(String(participant.registration_id)) : undefined;
          return { discordUserId: registration?.discord_user_id ? String(registration.discord_user_id) : null, displayName: String(participant?.display_name_at_start ?? "Unknown player") };
        }),
      }));
      const threadRows = await supabaseRestRequest<Array<Record<string, unknown>>>("discord_lobby_threads", {
        query: { select: "round_id,lobby_number,thread_id,accepted_image_count,state,last_game_number", round_id: inFilter(roundIds) ?? "in.(0)" },
      });
      const countRows = await supabaseRestRequest<Array<Record<string, unknown>>>("tournament_registrations", {
        query: { select: "checked_in_at,registration_status", tournament_id: `eq.${tournamentId}` },
      });
      tournaments.push({
        tournamentId,
        name: String(tournament.name),
        status: String(tournament.status),
        checkInStatus: String(tournament.check_in_status ?? "not_started"),
        registeredCount: countRows.filter((row) => row.registration_status === "registered").length,
        checkedInCount: countRows.filter((row) => row.checked_in_at !== null && ["registered", "waitlisted"].includes(String(row.registration_status))).length,
        config,
        activeLobbies,
        threads: threadRows.map((row) => ({ roundId: String(row.round_id), lobbyNumber: Number(row.lobby_number), threadId: String(row.thread_id), acceptedImageCount: Number(row.accepted_image_count ?? 0), state: String(row.state), lastGameNumber: row.last_game_number == null ? null : Number(row.last_game_number) })),
      });
    }
    return Response.json({ tournaments });
  } catch (error) {
    return discordErrorResponse(error, "Discord reconciliation failed.");
  }
}
