// Pure helpers for bot slash-command handling. No imports: shared between
// Next.js route handlers (if ever needed) and the standalone bot process,
// which must not pull in the Supabase/Next code paths (see cooldown.ts).

export type CommandTournament = {
  tournamentId: string;
  name: string;
  categoryId: string | null;
  managerRoleId: string | null;
  scoreCooldownSeconds: number;
};

/**
 * Resolves which connected tournament a guild slash command applies to.
 * Prefers the tournament whose Discord category matches the channel the
 * command was run in (or its parent, for a thread); falls back to the sole
 * connected tournament when there's exactly one and no category match is
 * possible; otherwise null (ambiguous or no candidates).
 */
export function selectTournamentForCommand(
  candidates: CommandTournament[],
  categoryId: string | null,
): CommandTournament | null {
  if (candidates.length === 0) return null;
  if (categoryId) {
    const match = candidates.find((candidate) => candidate.categoryId === categoryId);
    if (match) return match;
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Who may change a tournament's Discord settings from within Discord. */
export function canManageLobbyCooldown(input: {
  hasManageGuild: boolean;
  roleIds: string[];
  managerRoleId: string | null;
}): boolean {
  if (input.hasManageGuild) return true;
  if (!input.managerRoleId) return false;
  return input.roleIds.includes(input.managerRoleId);
}
