import assert from "node:assert/strict";
import test from "node:test";
import { discordAvatarUrl, discordDisplayName } from "../lib/discord/avatar";

test("builds a CDN avatar URL for a static hash", () => {
  assert.equal(
    discordAvatarUrl("123456789", "abcdef", 64),
    "https://cdn.discordapp.com/avatars/123456789/abcdef.png?size=64",
  );
});

test("uses a gif extension for animated (a_) hashes", () => {
  assert.equal(
    discordAvatarUrl("123456789", "a_abcdef", 128),
    "https://cdn.discordapp.com/avatars/123456789/a_abcdef.gif?size=128",
  );
});

test("returns null when the user id or avatar hash is missing", () => {
  assert.equal(discordAvatarUrl("123456789", null), null);
  assert.equal(discordAvatarUrl("123456789", ""), null);
  assert.equal(discordAvatarUrl(null, "abcdef"), null);
  assert.equal(discordAvatarUrl("   ", "abcdef"), null);
});

test("clamps the size to Discord's supported range and powers of two usage", () => {
  assert.equal(discordAvatarUrl("1", "abc", 4), "https://cdn.discordapp.com/avatars/1/abc.png?size=16");
  assert.equal(discordAvatarUrl("1", "abc", 4096), "https://cdn.discordapp.com/avatars/1/abc.png?size=1024");
});

test("discordDisplayName prefers the username and falls back safely", () => {
  assert.equal(discordDisplayName("FuuTime"), "FuuTime");
  assert.equal(discordDisplayName("  FuuTime  "), "FuuTime");
  assert.equal(discordDisplayName(null), "Discord player");
  assert.equal(discordDisplayName(""), "Discord player");
});