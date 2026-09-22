import { supabaseRestRequest } from "../supabase-rest/api";
import type {
  ClaimOrCreatePlayerByDiscordInput,
  CreatePlayerAccountInput,
  LinkDiscordAccountToPlayerInput,
  LinkRiotAccountToPlayerInput,
  PlayerAccount,
  PlayerAccountRow,
  PlayerAccountWithPasswordHashRow,
  SetPlayerAuthIdentityInput,
  SetPlayerCredentialsInput,
} from "./types";

const playerSelect =
  "id,auth_user_id,username,discord_user_id,discord_username,discord_avatar,riot_puuid,riot_game_tag,email,created_at,updated_at,last_signed_in_at";

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function mapPlayerAccountRow(row: PlayerAccountRow): PlayerAccount {
  return {
    id: String(row.id),
    authUserId: nullableString(row.auth_user_id),
    username: nullableString(row.username),
    discordUserId: nullableString(row.discord_user_id),
    discordUsername: nullableString(row.discord_username),
    discordAvatar: nullableString(row.discord_avatar),
    riotPuuid: nullableString(row.riot_puuid),
    riotGameTag: nullableString(row.riot_game_tag),
    email: nullableString(row.email),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastSignedInAt: nullableString(row.last_signed_in_at),
  };
}

export async function claimOrCreatePlayerByDiscord(
  input: ClaimOrCreatePlayerByDiscordInput,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>(
    "rpc/claim_or_create_player_by_discord",
    {
      method: "POST",
      body: {
        p_discord_user_id: input.discordUserId,
        p_discord_username: input.discordUsername ?? null,
        p_discord_avatar: input.discordAvatar ?? null,
      },
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Player account could not be created.");
  return mapPlayerAccountRow(row);
}

export async function getPlayerAccountById(
  playerAccountId: string,
): Promise<PlayerAccount | null> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>("player_accounts", {
    query: { select: playerSelect, id: `eq.${playerAccountId}`, limit: "1" },
  });
  return rows[0] ? mapPlayerAccountRow(rows[0]) : null;
}

// Returns just the password hash for an existing, already-authenticated
// player, so changePlayerPassword can verify their current password. Never
// expose this row shape outside that use.
export async function getPlayerAccountPasswordHashById(
  playerAccountId: string,
): Promise<string | null> {
  const rows = await supabaseRestRequest<Array<{ password_hash: string | null }>>("player_accounts", {
    query: { select: "password_hash", id: `eq.${playerAccountId}`, limit: "1" },
  });
  return rows[0]?.password_hash ?? null;
}

export async function getPlayerAccountByDiscordUserId(
  discordUserId: string,
): Promise<PlayerAccount | null> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>("player_accounts", {
    query: {
      select: playerSelect,
      discord_user_id: `eq.${discordUserId}`,
      limit: "1",
    },
  });
  return rows[0] ? mapPlayerAccountRow(rows[0]) : null;
}

export async function getPlayerAccountByAuthUserId(
  authUserId: string,
): Promise<PlayerAccount | null> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>("player_accounts", {
    query: {
      select: playerSelect,
      auth_user_id: `eq.${authUserId}`,
      limit: "1",
    },
  });
  return rows[0] ? mapPlayerAccountRow(rows[0]) : null;
}

export async function linkRiotAccountToPlayer(
  input: LinkRiotAccountToPlayerInput,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>(
    "rpc/link_riot_account_to_player",
    {
      method: "POST",
      body: {
        p_player_account_id: input.playerAccountId,
        p_riot_puuid: input.puuid,
        p_riot_game_tag: input.gameTag,
      },
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Player account was not found.");
  return mapPlayerAccountRow(row);
}

export async function setPlayerAuthIdentity(
  input: SetPlayerAuthIdentityInput,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>("player_accounts", {
    method: "PATCH",
    query: { select: playerSelect, id: `eq.${input.playerAccountId}` },
    prefer: "return=representation",
    body: { auth_user_id: input.authUserId, email: input.email },
  });
  const row = rows[0];
  if (!row) throw new Error("Player account was not found.");
  return mapPlayerAccountRow(row);
}

export async function createPlayerAccount(
  input: CreatePlayerAccountInput,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>("rpc/create_player_account", {
    method: "POST",
    body: {
      p_username: input.username,
      p_password_hash: input.passwordHash,
      p_email: input.email ?? null,
      p_discord_user_id: input.discordUserId ?? null,
      p_discord_username: input.discordUsername ?? null,
      p_discord_avatar: input.discordAvatar ?? null,
    },
  });
  const row = rows[0];
  if (!row) throw new Error("Player account could not be created.");
  return mapPlayerAccountRow(row);
}

// Returns the account including its password hash for sign-in verification.
// Callers must never pass this row shape (or the hash) outside the sign-in
// service -- use mapPlayerAccountRow's PlayerAccount type for anything else.
export async function findPlayerAccountByUsername(
  username: string,
): Promise<PlayerAccountWithPasswordHashRow | null> {
  const rows = await supabaseRestRequest<PlayerAccountWithPasswordHashRow[]>(
    "rpc/find_player_account_by_username",
    { method: "POST", body: { p_username: username } },
  );
  return rows[0] ?? null;
}

export async function touchPlayerAccountLastSignedIn(playerAccountId: string): Promise<void> {
  await supabaseRestRequest<unknown>("rpc/touch_player_account_last_signed_in", {
    method: "POST",
    body: { p_player_account_id: playerAccountId },
  });
}

export async function setPlayerCredentials(
  input: SetPlayerCredentialsInput,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>("rpc/set_player_credentials", {
    method: "POST",
    body: {
      p_player_account_id: input.playerAccountId,
      p_username: input.username ?? null,
      p_password_hash: input.passwordHash ?? null,
      p_email: input.email ?? null,
    },
  });
  const row = rows[0];
  if (!row) throw new Error("Player account was not found.");
  return mapPlayerAccountRow(row);
}

export async function linkDiscordAccountToPlayer(
  input: LinkDiscordAccountToPlayerInput,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>(
    "rpc/link_discord_account_to_player",
    {
      method: "POST",
      body: {
        p_player_account_id: input.playerAccountId,
        p_discord_user_id: input.discordUserId,
        p_discord_username: input.discordUsername ?? null,
        p_discord_avatar: input.discordAvatar ?? null,
      },
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Player account was not found.");
  return mapPlayerAccountRow(row);
}

export async function unlinkDiscordAccountFromPlayer(
  playerAccountId: string,
): Promise<PlayerAccount> {
  const rows = await supabaseRestRequest<PlayerAccountRow[]>(
    "rpc/unlink_discord_account_from_player",
    { method: "POST", body: { p_player_account_id: playerAccountId } },
  );
  const row = rows[0];
  if (!row) throw new Error("Player account was not found.");
  return mapPlayerAccountRow(row);
}

export async function checkInPlayerAccount(input: {
  tournamentId: string;
  playerAccountId: string;
}): Promise<{ registrationId: string; displayName: string; checkedInAt: string }> {
  const rows = await supabaseRestRequest<
    Array<{ registration_id: string; display_name: string; checked_in_at: string }>
  >("rpc/check_in_player_account", {
    method: "POST",
    body: { p_tournament_id: input.tournamentId, p_player_account_id: input.playerAccountId },
  });
  const row = rows[0];
  if (!row) throw new Error("Check-in could not be completed.");
  return {
    registrationId: row.registration_id,
    displayName: row.display_name,
    checkedInAt: row.checked_in_at,
  };
}