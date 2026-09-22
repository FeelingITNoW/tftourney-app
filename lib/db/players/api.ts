import { supabaseRestRequest } from "../supabase-rest/api";
import type {
  ClaimOrCreatePlayerByDiscordInput,
  LinkRiotAccountToPlayerInput,
  PlayerAccount,
  PlayerAccountRow,
  SetPlayerAuthIdentityInput,
} from "./types";

const playerSelect =
  "id,auth_user_id,discord_user_id,discord_username,discord_avatar,riot_puuid,riot_game_tag,email,created_at,updated_at";

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function mapPlayerAccountRow(row: PlayerAccountRow): PlayerAccount {
  return {
    id: String(row.id),
    authUserId: nullableString(row.auth_user_id),
    discordUserId: nullableString(row.discord_user_id),
    discordUsername: nullableString(row.discord_username),
    discordAvatar: nullableString(row.discord_avatar),
    riotPuuid: nullableString(row.riot_puuid),
    riotGameTag: nullableString(row.riot_game_tag),
    email: nullableString(row.email),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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