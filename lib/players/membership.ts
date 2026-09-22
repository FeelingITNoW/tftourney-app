export type LobbyMembershipParticipant = {
  playerAccountId: string | null;
  discordUserId: string | null;
  displayName: string;
};

export type LobbyMembership = {
  id: string;
  gameNumber: number;
  lobbyNumber: number;
  participants: LobbyMembershipParticipant[];
};

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// Verifies that a player account belongs to a lobby, using the stable account id
// the reconcile view model now projects onto each participant. This is the check
// the bot uses before trusting a screenshot/check-in from a thread member, and
// the check the web app uses to show a player their own lobby.
export function isPlayerAccountInLobby(
  lobby: LobbyMembership,
  playerAccountId: string | null | undefined,
): boolean {
  const target = normalize(playerAccountId);
  if (!target) return false;
  return lobby.participants.some(
    (participant) => normalize(participant.playerAccountId) === target,
  );
}

export function findLobbyForPlayerAccount(
  lobbies: LobbyMembership[],
  playerAccountId: string | null | undefined,
): LobbyMembership | null {
  const target = normalize(playerAccountId);
  if (!target) return null;
  return (
    lobbies.find((lobby) =>
      lobby.participants.some(
        (participant) => normalize(participant.playerAccountId) === target,
      ),
    ) ?? null
  );
}