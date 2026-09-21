export type PlayerAccount = {
  id: string;
  authUserId: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  riotPuuid: string | null;
  riotGameTag: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlayerAccountRow = {
  id: string | number;
  auth_user_id: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  discord_avatar: string | null;
  riot_puuid: string | null;
  riot_game_tag: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

export type ClaimOrCreatePlayerByDiscordInput = {
  discordUserId: string;
  discordUsername?: string | null;
  discordAvatar?: string | null;
};

export type LinkRiotAccountToPlayerInput = {
  playerAccountId: string;
  puuid: string;
  gameTag: string;
};

export type SetPlayerAuthIdentityInput = {
  playerAccountId: string;
  authUserId: string;
  email: string | null;
};