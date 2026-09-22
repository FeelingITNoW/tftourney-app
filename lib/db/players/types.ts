export type PlayerAccount = {
  id: string;
  authUserId: string | null;
  username: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
  riotPuuid: string | null;
  riotGameTag: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  lastSignedInAt: string | null;
};

export type PlayerAccountRow = {
  id: string | number;
  auth_user_id: string | null;
  username?: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  discord_avatar: string | null;
  riot_puuid: string | null;
  riot_game_tag: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  last_signed_in_at?: string | null;
};

// Only find_player_account_by_username returns this shape. It must never be
// exposed outside the sign-in service -- mapPlayerAccountRow deliberately
// cannot accidentally leak password_hash because PlayerAccount has no such
// field.
export type PlayerAccountWithPasswordHashRow = PlayerAccountRow & {
  password_hash: string | null;
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

export type CreatePlayerAccountInput = {
  username: string;
  passwordHash: string;
  email?: string | null;
  discordUserId?: string | null;
  discordUsername?: string | null;
  discordAvatar?: string | null;
};

export type SetPlayerCredentialsInput = {
  playerAccountId: string;
  username?: string | null;
  passwordHash?: string | null;
  email?: string | null;
};

export type LinkDiscordAccountToPlayerInput = {
  playerAccountId: string;
  discordUserId: string;
  discordUsername?: string | null;
  discordAvatar?: string | null;
};