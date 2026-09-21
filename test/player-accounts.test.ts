import assert from "node:assert/strict";
import test from "node:test";
import {
  claimOrCreatePlayerByDiscord,
  getPlayerAccountByAuthUserId,
  getPlayerAccountByDiscordUserId,
  linkRiotAccountToPlayer,
  setPlayerAuthIdentity,
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
  discord_user_id: "discord-1",
  discord_username: "FuuTime",
  discord_avatar: "abcd",
  riot_puuid: null,
  riot_game_tag: null,
  email: null,
  created_at: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
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
      discordUserId: "discord-1",
      discordUsername: "FuuTime",
      discordAvatar: "abcd",
      riotPuuid: null,
      riotGameTag: null,
      email: null,
      createdAt: "2026-09-21T00:00:00Z",
      updatedAt: "2026-09-21T00:00:00Z",
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