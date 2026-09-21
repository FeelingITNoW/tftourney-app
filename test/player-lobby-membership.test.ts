import assert from "node:assert/strict";
import test from "node:test";
import {
  findLobbyForPlayerAccount,
  isPlayerAccountInLobby,
} from "../lib/players/membership";

const lobby = {
  id: "lobby-1",
  gameNumber: 1,
  lobbyNumber: 2,
  participants: [
    { playerAccountId: "42", discordUserId: "discord-1", displayName: "FuuTime" },
    { playerAccountId: "43", discordUserId: null, displayName: "Braven" },
  ],
};

test("isPlayerAccountInLobby is true when the account id is a participant", () => {
  assert.equal(isPlayerAccountInLobby(lobby, "42"), true);
});

test("isPlayerAccountInLobby is false for an account not in the lobby", () => {
  assert.equal(isPlayerAccountInLobby(lobby, "99"), false);
});

test("isPlayerAccountInLobby is false when the player account id is null or empty", () => {
  assert.equal(isPlayerAccountInLobby(lobby, null), false);
  assert.equal(isPlayerAccountInLobby(lobby, ""), false);
});

test("findLobbyForPlayerAccount returns the matching lobby", () => {
  const lobbies = [lobby, { ...lobby, id: "lobby-2", participants: [] }];
  assert.equal(findLobbyForPlayerAccount(lobbies, "42")?.id, "lobby-1");
});

test("findLobbyForPlayerAccount returns null when the player is in no lobby", () => {
  assert.equal(findLobbyForPlayerAccount([lobby], "99"), null);
});