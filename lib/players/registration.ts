import type { PlayerAccount } from "../db/players/types";
import type { TournamentRegistration } from "../db/tournaments/types";
import type { VerifiedRiotAccount } from "../riot/accounts/types";
import { getRiotAccountByRiotId } from "../riot/accounts/api";
import { getPlayerAccountById, linkRiotAccountToPlayer } from "../db/players/api";
import { registerTournamentPlayer } from "../db/tournaments/api";
import { parseRiotGameTag, validatePlayerRegistration } from "../tournament/players/api";

export type ResolvePlayerRiotIdentityInput = {
  player: PlayerAccount;
  /** A newly entered GameName#TAG. When omitted, the account's stored identity is reused. */
  gameTag?: string | null;
};

export type ResolvedPlayerRiotIdentity = {
  verified: boolean;
  account: VerifiedRiotAccount | null;
  /**
   * True when the verified identity is not yet persisted on the player account,
   * so the caller should call linkRiotAccountToPlayer. False when the stored
   * identity was reused as-is.
   */
  needsLink: boolean;
};

function accountFromStoredIdentity(player: PlayerAccount): VerifiedRiotAccount | null {
  if (!player.riotPuuid || !player.riotGameTag) return null;
  const parsed = parseRiotGameTag(player.riotGameTag);
  if (!parsed) return null;
  return {
    puuid: player.riotPuuid,
    gameName: parsed.gameName,
    tagLine: parsed.tagLine,
    gameTag: parsed.gameTag,
  };
}

// Makes tournament sign-up seamless: a player who already linked a Riot account
// reuses it with no Riot round trip, while a player supplying a new GameName#TAG
// is verified against Riot before the identity is (re)linked to their account.
export async function resolvePlayerRiotIdentity(
  input: ResolvePlayerRiotIdentityInput,
): Promise<ResolvedPlayerRiotIdentity> {
  const enteredGameTag = input.gameTag?.trim() ?? "";
  if (enteredGameTag.length === 0) {
    const stored = accountFromStoredIdentity(input.player);
    if (stored) {
      return { verified: true, account: stored, needsLink: false };
    }
    return { verified: false, account: null, needsLink: true };
  }

  const validation = validatePlayerRegistration({ gameTag: enteredGameTag });
  if (!validation.success) {
    throw new Error(validation.errors.gameTag ?? "Enter a Riot ID in GameName#TAG format.");
  }

  const account = await getRiotAccountByRiotId({
    gameName: validation.data.gameName,
    tagLine: validation.data.tagLine,
  });
  return { verified: true, account, needsLink: true };
}

export type RegisterPlayerAccountInput = {
  playerAccountId: string;
  tournamentId: string;
  /** Optional newly entered GameName#TAG. When omitted, the stored identity is used. */
  gameTag?: string | null;
};

// Signs a web player up for a tournament using their durable account: it reuses
// the account's verified Riot identity when present, otherwise verifies a newly
// supplied GameName#TAG and links it first. Either way the registration carries
// both the Discord id and the player account id, so the bot can contact the
// player and match them to a lobby by identity.
export async function registerPlayerAccountForTournament(
  input: RegisterPlayerAccountInput,
): Promise<TournamentRegistration> {
  const player = await getPlayerAccountById(input.playerAccountId);
  if (!player) throw new Error("Player account was not found.");

  const resolved = await resolvePlayerRiotIdentity({ player, gameTag: input.gameTag });
  if (!resolved.verified || !resolved.account) {
    throw new Error("Link a Riot account before signing up for a tournament.");
  }
  if (resolved.needsLink) {
    await linkRiotAccountToPlayer({
      playerAccountId: player.id,
      puuid: resolved.account.puuid,
      gameTag: resolved.account.gameTag,
    });
  }

  return registerTournamentPlayer({
    tournamentId: input.tournamentId,
    riotAccount: resolved.account,
    ...(player.discordUserId ? { discordUserId: player.discordUserId } : {}),
    playerAccountId: player.id,
  });
}
