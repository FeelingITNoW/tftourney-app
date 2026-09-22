import assert from "node:assert/strict";
import test from "node:test";
import {
  changePlayerEmail,
  changePlayerPassword,
  claimPlayerAccountCredentials,
  linkRiotToPlayerAccount,
  PlayerAccountValidationError,
  signInPlayerAccount,
  signUpPlayerAccount,
  unlinkDiscordFromPlayerAccount,
} from "../lib/players/accounts";
import { hashPassword } from "../lib/auth/player-credentials";

type Call = { method: string; pathname: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    PLAYER_SESSION_SECRET: process.env.PLAYER_SESSION_SECRET,
    RIOT_API_KEY: process.env.RIOT_API_KEY,
  };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.PLAYER_SESSION_SECRET = "player-secret";
  process.env.RIOT_API_KEY = "riot-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
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
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
}

// Simulates a Postgres `raise exception '<message>'` surfacing through
// PostgREST as a non-2xx response, the way registerTournamentPlayer's 23505
// handling in lib/db/tournaments/api.ts already does for duplicate rows.
function stubFetchWithError(calls: Call[], match: (call: Call) => boolean, message: string, respond: (call: Call) => unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    if (match(call)) {
      return new Response(JSON.stringify({ code: "P0001", message }), { status: 400 });
    }
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
}

const baseRow = {
  id: 42,
  auth_user_id: null,
  username: null,
  discord_user_id: null,
  discord_username: null,
  discord_avatar: null,
  riot_puuid: null,
  riot_game_tag: null,
  email: null,
  created_at: "2026-09-22T00:00:00Z",
  updated_at: "2026-09-22T00:00:00Z",
  last_signed_in_at: null,
};

test("signUpPlayerAccount rejects invalid input before touching the network", async () => {
  await withEnv(async (calls) => {
    await assert.rejects(
      () => signUpPlayerAccount({ username: "a", password: "short", confirmPassword: "short" }),
      PlayerAccountValidationError,
    );
    assert.equal(calls.length, 0);
  });
});

test("signUpPlayerAccount creates the account, hashes the password, and mints a session", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/create_player_account") {
        return [{ ...baseRow, username: "fuutime" }];
      }
      if (call.pathname === "/rest/v1/rpc/touch_player_account_last_signed_in") return null;
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await signUpPlayerAccount({
      username: "fuutime",
      password: "password123",
      confirmPassword: "password123",
    });
    assert.equal(result.player.username, "fuutime");
    assert.ok(result.sessionToken.includes("."));
    const createCall = calls.find((call) => call.pathname === "/rest/v1/rpc/create_player_account");
    const body = createCall!.body as Record<string, unknown>;
    assert.equal(body.p_username, "fuutime");
    assert.notEqual(body.p_password_hash, "password123");
    assert.match(String(body.p_password_hash), /^scrypt\$/);
  });
});

test("signUpPlayerAccount attaches a pending Discord identity at creation time", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/create_player_account") return [{ ...baseRow, username: "fuutime", discord_user_id: "discord-1" }];
      if (call.pathname === "/rest/v1/rpc/touch_player_account_last_signed_in") return null;
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await signUpPlayerAccount({
      username: "fuutime",
      password: "password123",
      confirmPassword: "password123",
      pendingDiscord: { discordUserId: "discord-1", discordUsername: "FuuTime", discordAvatar: null },
    });
    const createCall = calls.find((call) => call.pathname === "/rest/v1/rpc/create_player_account");
    assert.equal((createCall!.body as Record<string, unknown>).p_discord_user_id, "discord-1");
  });
});

test("signUpPlayerAccount surfaces a taken username as a field error", async () => {
  await withEnv(async (calls) => {
    stubFetchWithError(
      calls,
      (call) => call.pathname === "/rest/v1/rpc/create_player_account",
      "That username is already taken.",
      () => [],
    );
    await assert.rejects(
      () => signUpPlayerAccount({ username: "fuutime", password: "password123", confirmPassword: "password123" }),
      (error: unknown) => {
        assert.ok(error instanceof PlayerAccountValidationError);
        assert.equal(error.errors.username, "That username is already taken.");
        return true;
      },
    );
  });
});

test("signInPlayerAccount succeeds with the right password and records the sign-in", async () => {
  await withEnv(async (calls) => {
    const passwordHash = await hashPassword("password123");
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/find_player_account_by_username") {
        return [{ ...baseRow, username: "fuutime", password_hash: passwordHash }];
      }
      if (call.pathname === "/rest/v1/rpc/touch_player_account_last_signed_in") return null;
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await signInPlayerAccount({ username: "fuutime", password: "password123" });
    assert.equal(result.player.username, "fuutime");
    assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/touch_player_account_last_signed_in"), true);
  });
});

test("signInPlayerAccount gives the same generic error for an unknown username and a wrong password", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/find_player_account_by_username") return [];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const unknownUsername = await signInPlayerAccount({ username: "nobody", password: "whatever1" }).catch((error: Error) => error.message);

    const passwordHash = await hashPassword("password123");
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/find_player_account_by_username") {
        return [{ ...baseRow, username: "fuutime", password_hash: passwordHash }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const wrongPassword = await signInPlayerAccount({ username: "fuutime", password: "wrong-password" }).catch((error: Error) => error.message);

    assert.equal(unknownUsername, wrongPassword);
  });
});

test("claimPlayerAccountCredentials hashes the password and calls set_player_credentials", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/set_player_credentials") return [{ ...baseRow, username: "fuutime" }];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const player = await claimPlayerAccountCredentials({
      playerAccountId: "42",
      username: "fuutime",
      password: "password123",
      confirmPassword: "password123",
    });
    assert.equal(player.username, "fuutime");
    const call = calls.find((call) => call.pathname === "/rest/v1/rpc/set_player_credentials");
    const body = call!.body as Record<string, unknown>;
    assert.equal(body.p_player_account_id, "42");
    assert.match(String(body.p_password_hash), /^scrypt\$/);
  });
});

test("changePlayerPassword rejects an incorrect current password without changing anything", async () => {
  await withEnv(async (calls) => {
    const passwordHash = await hashPassword("current-password");
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/player_accounts") return [{ password_hash: passwordHash }];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await assert.rejects(
      () =>
        changePlayerPassword({
          playerAccountId: "42",
          currentPassword: "wrong-current",
          newPassword: "new-password-1",
          confirmNewPassword: "new-password-1",
        }),
      PlayerAccountValidationError,
    );
    assert.equal(calls.some((call) => call.pathname.includes("rpc/set_player_credentials")), false);
  });
});

test("changePlayerPassword updates the hash when the current password matches", async () => {
  await withEnv(async (calls) => {
    const passwordHash = await hashPassword("current-password");
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/player_accounts") return [{ password_hash: passwordHash }];
      if (call.pathname === "/rest/v1/rpc/set_player_credentials") return [{ ...baseRow, username: "fuutime" }];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await changePlayerPassword({
      playerAccountId: "42",
      currentPassword: "current-password",
      newPassword: "new-password-1",
      confirmNewPassword: "new-password-1",
    });
    const call = calls.find((call) => call.pathname === "/rest/v1/rpc/set_player_credentials");
    assert.match(String((call!.body as Record<string, unknown>).p_password_hash), /^scrypt\$/);
  });
});

test("changePlayerPassword rejects a mismatched confirmation", async () => {
  await withEnv(async (calls) => {
    const passwordHash = await hashPassword("current-password");
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/player_accounts") return [{ password_hash: passwordHash }];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await assert.rejects(
      () =>
        changePlayerPassword({
          playerAccountId: "42",
          currentPassword: "current-password",
          newPassword: "new-password-1",
          confirmNewPassword: "different-password",
        }),
      PlayerAccountValidationError,
    );
  });
});

test("changePlayerEmail clears the email when given an empty string", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/set_player_credentials") return [{ ...baseRow, username: "fuutime", email: null }];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await changePlayerEmail({ playerAccountId: "42", email: null });
    const call = calls.find((call) => call.pathname === "/rest/v1/rpc/set_player_credentials");
    assert.equal((call!.body as Record<string, unknown>).p_email, "");
  });
});

test("linkRiotToPlayerAccount verifies against Riot then links the account", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname.includes("/riot/account/v1/accounts/by-riot-id/")) {
        return { puuid: "puuid-1", gameName: "Braven", tagLine: "ph2" };
      }
      if (call.pathname === "/rest/v1/rpc/link_riot_account_to_player") {
        return [{ ...baseRow, riot_puuid: "puuid-1", riot_game_tag: "Braven#ph2" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const player = await linkRiotToPlayerAccount({ playerAccountId: "42", gameTag: "Braven#ph2" });
    assert.equal(player.riotGameTag, "Braven#ph2");
  });
});

test("linkRiotToPlayerAccount rejects a malformed game tag before calling Riot", async () => {
  await withEnv(async (calls) => {
    await assert.rejects(() => linkRiotToPlayerAccount({ playerAccountId: "42", gameTag: "not-a-tag" }));
    assert.equal(calls.length, 0);
  });
});

test("unlinkDiscordFromPlayerAccount calls the RPC", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/rpc/unlink_discord_account_from_player") return [{ ...baseRow, username: "fuutime" }];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const player = await unlinkDiscordFromPlayerAccount("42");
    assert.equal(player.discordUserId, null);
  });
});
