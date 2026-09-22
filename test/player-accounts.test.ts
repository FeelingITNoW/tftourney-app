import assert from "node:assert/strict";
import test from "node:test";
import {
  checkInPlayerAccount,
  claimOrCreatePlayerByDiscord,
  createPlayerAccount,
  findPlayerAccountByUsername,
  getPlayerAccountByAuthUserId,
  getPlayerAccountByDiscordUserId,
  getPlayerAccountPasswordHashById,
  linkDiscordAccountToPlayer,
  linkRiotAccountToPlayer,
  setPlayerAuthIdentity,
  setPlayerCredentials,
  touchPlayerAccountLastSignedIn,
  unlinkDiscordAccountFromPlayer,
} from "../lib/db/players/api";

type Call = { method: string; pathname: string; search: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["SUPABASE_URL", originalUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", originalKey],
      ["NEXT_PUBLIC_SUPABASE_URL", originalPublicUrl],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function stubFetch(calls: Call[], respond: (call: Call) => unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      search: decodeURIComponent(url.search),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
}

const playerRow = {
  id: 42,
  auth_user_id: null,
  username: null,
  discord_user_id: "discord-1",
  discord_username: "FuuTime",
  discord_avatar: "abcd",
  riot_puuid: null,
  riot_game_tag: null,
  email: null,
  created_at: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
  last_signed_in_at: null,
};

test("claimOrCreatePlayerByDiscord calls the RPC with the Discord identity and maps the row", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [playerRow]);
    const player = await claimOrCreatePlayerByDiscord({
      discordUserId: "discord-1",
      discordUsername: "FuuTime",
      discordAvatar: "abcd",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/claim_or_create_player_by_discord");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(calls[0]?.body, {
      p_discord_user_id: "discord-1",
      p_discord_username: "FuuTime",
      p_discord_avatar: "abcd",
    });
    assert.deepEqual(player, {
      id: "42",
      authUserId: null,
      username: null,
      discordUserId: "discord-1",
      discordUsername: "FuuTime",
      discordAvatar: "abcd",
      riotPuuid: null,
      riotGameTag: null,
      email: null,
      createdAt: "2026-09-21T00:00:00Z",
      updatedAt: "2026-09-21T00:00:00Z",
      lastSignedInAt: null,
    });
  });
});

test("claimOrCreatePlayerByDiscord defaults missing optional Discord fields to null", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, discord_username: null, discord_avatar: null }]);
    const player = await claimOrCreatePlayerByDiscord({ discordUserId: "discord-1" });
    assert.deepEqual(calls[0]?.body, {
      p_discord_user_id: "discord-1",
      p_discord_username: null,
      p_discord_avatar: null,
    });
    assert.equal(player?.discordUsername, null);
    assert.equal(player?.discordAvatar, null);
  });
});

test("claimOrCreatePlayerByDiscord throws when the database returns no row", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    await assert.rejects(() =>
      claimOrCreatePlayerByDiscord({ discordUserId: "discord-1" }),
    );
  });
});

test("getPlayerAccountByDiscordUserId returns null when no player is linked", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    const player = await getPlayerAccountByDiscordUserId("discord-missing");
    assert.equal(player, null);
    assert.equal(calls[0]?.pathname, "/rest/v1/player_accounts");
    assert.match(calls[0]?.search ?? "", /discord_user_id=eq\.discord-missing/);
  });
});

test("getPlayerAccountByDiscordUserId maps the stored Riot identity", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, riot_puuid: "puuid-1", riot_game_tag: "FuuTime#xdd" }]);
    const player = await getPlayerAccountByDiscordUserId("discord-1");
    assert.equal(player?.riotPuuid, "puuid-1");
    assert.equal(player?.riotGameTag, "FuuTime#xdd");
  });
});

test("getPlayerAccountByAuthUserId scopes the lookup by auth user id", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, auth_user_id: "auth-1" }]);
    const player = await getPlayerAccountByAuthUserId("auth-1");
    assert.equal(player?.authUserId, "auth-1");
    assert.match(calls[0]?.search ?? "", /auth_user_id=eq\.auth-1/);
  });
});

test("linkRiotAccountToPlayer calls the RPC and returns the linked identity", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, riot_puuid: "puuid-1", riot_game_tag: "FuuTime#xdd" }]);
    const player = await linkRiotAccountToPlayer({
      playerAccountId: "42",
      puuid: "puuid-1",
      gameTag: "FuuTime#xdd",
    });
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/link_riot_account_to_player");
    assert.deepEqual(calls[0]?.body, {
      p_player_account_id: "42",
      p_riot_puuid: "puuid-1",
      p_riot_game_tag: "FuuTime#xdd",
    });
    assert.equal(player.riotPuuid, "puuid-1");
    assert.equal(player.riotGameTag, "FuuTime#xdd");
  });
});

test("linkRiotAccountToPlayer throws when no player row is updated", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    await assert.rejects(() =>
      linkRiotAccountToPlayer({ playerAccountId: "missing", puuid: "p", gameTag: "a#b" }),
    );
  });
});

test("setPlayerAuthIdentity patches the account and returns the updated row", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, auth_user_id: "auth-1", email: "player@example.com" }]);
    const player = await setPlayerAuthIdentity({
      playerAccountId: "42",
      authUserId: "auth-1",
      email: "player@example.com",
    });
    assert.equal(calls[0]?.pathname, "/rest/v1/player_accounts");
    assert.equal(calls[0]?.method, "PATCH");
    assert.match(calls[0]?.search ?? "", /id=eq\.42/);
    assert.deepEqual(calls[0]?.body, { auth_user_id: "auth-1", email: "player@example.com" });
    assert.equal(player.authUserId, "auth-1");
    assert.equal(player.email, "player@example.com");
  });
});

test("createPlayerAccount calls the RPC with the username/password/email and optional Discord identity", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, username: "fuutime", discord_user_id: null, discord_username: null, discord_avatar: null }]);
    const player = await createPlayerAccount({
      username: "fuutime",
      passwordHash: "scrypt$hash",
      email: "player@example.com",
    });
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/create_player_account");
    assert.deepEqual(calls[0]?.body, {
      p_username: "fuutime",
      p_password_hash: "scrypt$hash",
      p_email: "player@example.com",
      p_discord_user_id: null,
      p_discord_username: null,
      p_discord_avatar: null,
    });
    assert.equal(player.username, "fuutime");
  });
});

test("createPlayerAccount throws when the database returns no row", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    await assert.rejects(() =>
      createPlayerAccount({ username: "fuutime", passwordHash: "scrypt$hash" }),
    );
  });
});

test("findPlayerAccountByUsername calls the RPC and returns the row including the password hash", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, username: "fuutime", password_hash: "scrypt$hash" }]);
    const row = await findPlayerAccountByUsername("fuutime");
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/find_player_account_by_username");
    assert.deepEqual(calls[0]?.body, { p_username: "fuutime" });
    assert.equal(row?.password_hash, "scrypt$hash");
  });
});

test("findPlayerAccountByUsername returns null when no account matches", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    const row = await findPlayerAccountByUsername("missing");
    assert.equal(row, null);
  });
});

test("touchPlayerAccountLastSignedIn calls the RPC with the account id", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => null);
    await touchPlayerAccountLastSignedIn("42");
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/touch_player_account_last_signed_in");
    assert.deepEqual(calls[0]?.body, { p_player_account_id: "42" });
  });
});

test("setPlayerCredentials calls the RPC and leaves omitted fields as null (unchanged)", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, username: "fuutime" }]);
    const player = await setPlayerCredentials({ playerAccountId: "42", username: "fuutime" });
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/set_player_credentials");
    assert.deepEqual(calls[0]?.body, {
      p_player_account_id: "42",
      p_username: "fuutime",
      p_password_hash: null,
      p_email: null,
    });
    assert.equal(player.username, "fuutime");
  });
});

test("linkDiscordAccountToPlayer calls the RPC with the Discord identity", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, discord_user_id: "discord-2" }]);
    const player = await linkDiscordAccountToPlayer({
      playerAccountId: "42",
      discordUserId: "discord-2",
      discordUsername: "NewName",
      discordAvatar: "hash",
    });
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/link_discord_account_to_player");
    assert.deepEqual(calls[0]?.body, {
      p_player_account_id: "42",
      p_discord_user_id: "discord-2",
      p_discord_username: "NewName",
      p_discord_avatar: "hash",
    });
    assert.equal(player.discordUserId, "discord-2");
  });
});

test("unlinkDiscordAccountFromPlayer calls the RPC and returns the cleared account", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ ...playerRow, discord_user_id: null, discord_username: null, discord_avatar: null }]);
    const player = await unlinkDiscordAccountFromPlayer("42");
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/unlink_discord_account_from_player");
    assert.deepEqual(calls[0]?.body, { p_player_account_id: "42" });
    assert.equal(player.discordUserId, null);
  });
});

test("checkInPlayerAccount calls the RPC and maps the registration", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [
      { registration_id: "9", display_name: "FuuTime#xdd", checked_in_at: "2026-09-22T00:00:00Z" },
    ]);
    const result = await checkInPlayerAccount({ tournamentId: "1", playerAccountId: "42" });
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/check_in_player_account");
    assert.deepEqual(calls[0]?.body, { p_tournament_id: "1", p_player_account_id: "42" });
    assert.deepEqual(result, {
      registrationId: "9",
      displayName: "FuuTime#xdd",
      checkedInAt: "2026-09-22T00:00:00Z",
    });
  });
});

test("checkInPlayerAccount throws when the database returns no row", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    await assert.rejects(() => checkInPlayerAccount({ tournamentId: "1", playerAccountId: "42" }));
  });
});

test("getPlayerAccountPasswordHashById returns the stored hash", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ password_hash: "scrypt$hash" }]);
    const hash = await getPlayerAccountPasswordHashById("42");
    assert.equal(calls[0]?.pathname, "/rest/v1/player_accounts");
    assert.match(calls[0]?.search ?? "", /id=eq\.42/);
    assert.equal(hash, "scrypt$hash");
  });
});

test("getPlayerAccountPasswordHashById returns null when the account has no row or no hash", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    const hash = await getPlayerAccountPasswordHashById("missing");
    assert.equal(hash, null);
  });
});