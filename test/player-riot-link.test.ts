import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlayerRiotIdentity } from "../lib/players/registration";
import type { PlayerAccount } from "../lib/db/players/types";

function player(overrides: Partial<PlayerAccount> = {}): PlayerAccount {
  return {
    id: "42",
    authUserId: null,
    discordUserId: "discord-1",
    discordUsername: "FuuTime",
    discordAvatar: null,
    riotPuuid: null,
    riotGameTag: null,
    email: null,
    createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:00:00Z",
    ...overrides,
  };
}

function withEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalKey = process.env.RIOT_API_KEY;
  const originalRegion = process.env.RIOT_ACCOUNT_REGION;
  process.env.RIOT_API_KEY = "riot-key";
  delete process.env.RIOT_ACCOUNT_REGION;
  return run().finally(() => {
    if (originalKey === undefined) delete process.env.RIOT_API_KEY;
    else process.env.RIOT_API_KEY = originalKey;
    if (originalRegion === undefined) delete process.env.RIOT_ACCOUNT_REGION;
    else process.env.RIOT_ACCOUNT_REGION = originalRegion;
  });
}

test("reuses the stored Riot identity without calling Riot when no new game tag is given", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Riot should not be called");
  }) as typeof fetch;
  try {
    const result = await resolvePlayerRiotIdentity({
      player: player({ riotPuuid: "puuid-1", riotGameTag: "FuuTime#xdd" }),
    });
    assert.equal(result.verified, true);
    assert.deepEqual(result.account, {
      puuid: "puuid-1",
      gameName: "FuuTime",
      tagLine: "xdd",
      gameTag: "FuuTime#xdd",
    });
    assert.equal(result.needsLink, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports an unlinked account when there is no stored identity and no game tag", async () => {
  const result = await resolvePlayerRiotIdentity({ player: player() });
  assert.equal(result.verified, false);
  assert.equal(result.account, null);
  assert.equal(result.needsLink, true);
});

test("verifies a new game tag with Riot and requests linking", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({ puuid: "puuid-2", gameName: "Braven", tagLine: "ph2" }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    await withEnv(async () => {
      const result = await resolvePlayerRiotIdentity({
        player: player(),
        gameTag: "Braven#ph2",
      });
      assert.equal(result.verified, true);
      assert.deepEqual(result.account, {
        puuid: "puuid-2",
        gameName: "Braven",
        tagLine: "ph2",
        gameTag: "Braven#ph2",
      });
      assert.equal(result.needsLink, true);
      assert.match(urls[0] ?? "", /Braven\/ph2/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an invalid game tag format before calling Riot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Riot should not be called for an invalid tag");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => resolvePlayerRiotIdentity({ player: player(), gameTag: "not a tag" }),
      /GameName#TAG/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("propagates a Riot not-found error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  try {
    await withEnv(async () => {
      await assert.rejects(
        () => resolvePlayerRiotIdentity({ player: player(), gameTag: "Missing#0000" }),
        /not found/i,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});