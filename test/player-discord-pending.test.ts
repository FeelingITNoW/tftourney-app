import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingPlayerDiscordToken,
  readPendingPlayerDiscordToken,
} from "../lib/auth/player-discord-oauth";

function withSecret<T>(run: () => T): T {
  const original = process.env.PLAYER_SESSION_SECRET;
  process.env.PLAYER_SESSION_SECRET = "pending-discord-secret";
  try {
    return run();
  } finally {
    if (original === undefined) delete process.env.PLAYER_SESSION_SECRET;
    else process.env.PLAYER_SESSION_SECRET = original;
  }
}

test("createPendingPlayerDiscordToken/readPendingPlayerDiscordToken round-trips the identity", () => {
  withSecret(() => {
    const token = createPendingPlayerDiscordToken({ id: "discord-1", username: "FuuTime", avatar: "abcd" });
    const identity = readPendingPlayerDiscordToken(token);
    assert.deepEqual(identity, {
      discordUserId: "discord-1",
      discordUsername: "FuuTime",
      discordAvatar: "abcd",
    });
  });
});

test("createPendingPlayerDiscordToken defaults missing username/avatar to null", () => {
  withSecret(() => {
    const token = createPendingPlayerDiscordToken({ id: "discord-1" });
    const identity = readPendingPlayerDiscordToken(token);
    assert.equal(identity?.discordUsername, null);
    assert.equal(identity?.discordAvatar, null);
  });
});

test("readPendingPlayerDiscordToken returns null for a missing or tampered token", () => {
  withSecret(() => {
    assert.equal(readPendingPlayerDiscordToken(undefined), null);
    const token = createPendingPlayerDiscordToken({ id: "discord-1" });
    assert.equal(readPendingPlayerDiscordToken(`${token}tampered`), null);
  });
});
