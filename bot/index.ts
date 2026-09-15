import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIInteractionGuildMember,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import dotenv from "dotenv";
import {
  SCORE_COOLDOWN_DEFAULT_SECONDS,
  SCORE_COOLDOWN_MAX_SECONDS,
  cooldownRejectionMessage,
  formatCooldownDuration,
  parseCooldownSeconds,
} from "../lib/discord/cooldown";
import { canManageLobbyCooldown, selectTournamentForCommand, type CommandTournament } from "../lib/discord/commands";

dotenv.config({ path: ".env.local" });
dotenv.config();

type ReconcileConfig = {
  tournamentId: string;
  name: string;
  status: string;
  checkInStatus: string;
  registeredCount: number;
  checkedInCount: number;
  config: Record<string, unknown>;
  activeLobbies: Array<{
    id: string;
    roundId: string;
    gameNumber: number;
    lobbyNumber: number;
    participants: Array<{ discordUserId: string | null; displayName: string }>;
  }>;
  threads: Array<{ roundId: string; lobbyNumber: number; threadId: string; state: string }>;
};

type ClaimedSubmission =
  | {
      claimStatus: "claimed";
      submissionId: string;
      tournamentId: string;
      roundId: string;
      threadId: string;
      discordMessageId: string;
      lobbyId: string;
      gameNumber: number;
      leaseToken: string;
      attemptCount: number;
      roster: Array<{ id: string; displayName: string }>;
      imageUrl: string;
    }
  | {
      claimStatus: "rejected_cooldown";
      submissionId: string;
      tournamentId: string;
      roundId: string;
      threadId: string;
      discordMessageId: string;
      retryAfterSeconds: number;
    };

const appUrl = (process.env.TFTOURNEY_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const botToken = process.env.DISCORD_BOT_TOKEN;
const apiSecret = process.env.DISCORD_BOT_API_SECRET;
const ocrSecret = process.env.OCR_API_SECRET;

if (!botToken || !apiSecret || !ocrSecret) {
  throw new Error("DISCORD_BOT_TOKEN, DISCORD_BOT_API_SECRET, and OCR_API_SECRET are required.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const threadContext = new Map<string, { tournamentId: string; managerRoleId: string | null; lobbyId: string | null }>();
const threadParticipantKeys = new Map<string, string>();
// Refreshed at the start of every reconcile() tick: which tournaments (if any) a
// guild is currently connected to, plus the fields slash commands need
// (category, manager role, cooldown). Lets guildCreate/guildDelete and
// /lobby-cooldown react without a second round trip to the app for data
// reconcile() just fetched. Values can lag by up to one 10s tick after a
// tournament's Discord resources first provision.
const guildTournaments = new Map<string, CommandTournament[]>();
let processing = false;
let reconciling = false;

async function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiSecret}`);
  return fetch(`${appUrl}${path}`, { ...init, headers });
}

function buttonRow(tournamentId: string, kind: "signup" | "checkin", disabled = false): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(`${kind}:${tournamentId}`)
    .setLabel(kind === "signup" ? "Sign up with Riot ID" : "Check in")
    .setStyle(kind === "signup" ? ButtonStyle.Primary : ButtonStyle.Success)
    .setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

// No setDefaultMemberPermissions: that would hide the command from anyone
// without Manage Server, including tournament manager-role holders who
// legitimately need it. The permission check instead happens in
// handleLobbyCooldownCommand, which also allows the manager role.
const lobbyCooldownCommand = new SlashCommandBuilder()
  .setName("lobby-cooldown")
  .setDescription("Show or set how long a lobby thread ignores new screenshots after one is accepted.")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) => sub.setName("show").setDescription("Show the current cooldown."))
  .addSubcommand((sub) => sub
    .setName("set")
    .setDescription("Set the cooldown in seconds (0 disables it).")
    .addIntegerOption((option) => option
      .setName("seconds")
      .setDescription(`Whole seconds, 0-${SCORE_COOLDOWN_MAX_SECONDS}. 0 disables the cooldown.`)
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(SCORE_COOLDOWN_MAX_SECONDS)));

// The guild-level permission set requested by /api/auth/discord/bot-install (and
// documented for manual installs in docs/discord-bot.md). Discord lets the
// authorizing user uncheck any of these on its own consent screen even though the
// invite URL pre-selects them, so a missing one here is a real, user-caused
// misconfiguration worth surfacing by name rather than only failing later with
// whatever raw error the first blocked Discord API call happens to produce.
const REQUIRED_GUILD_PERMISSIONS: Array<[bigint, string]> = [
  [PermissionFlagsBits.ViewChannel, "View Channels"],
  [PermissionFlagsBits.SendMessages, "Send Messages"],
  [PermissionFlagsBits.ManageChannels, "Manage Channels"],
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.ManageThreads, "Manage Threads"],
  [PermissionFlagsBits.CreatePrivateThreads, "Create Private Threads"],
  [PermissionFlagsBits.SendMessagesInThreads, "Send Messages in Threads"],
  [PermissionFlagsBits.AttachFiles, "Attach Files"],
];

async function getBotMember(guild: Guild) {
  return guild.members.me ?? await guild.members.fetchMe().catch(() => null);
}

async function missingGuildPermissions(guild: Guild): Promise<string[]> {
  const me = await getBotMember(guild);
  if (!me) return ["(could not read the bot's own permissions)"];
  return REQUIRED_GUILD_PERMISSIONS.filter(([flag]) => !me.permissions.has(flag)).map(([, label]) => label);
}

async function ensureRole(guild: Guild, config: ReconcileConfig): Promise<string> {
  const configuredId = String(config.config.manager_role_id ?? "");
  if (configuredId) {
    const role = await guild.roles.fetch(configuredId).catch(() => null);
    if (role) return role.id;
  }
  const role = await guild.roles.create({ name: `TFT Manager • ${config.name}`.slice(0, 100), reason: `TFTourney manager role for ${config.tournamentId}` });
  return role.id;
}

// Permissions the bot itself needs in every provisioned channel: sending the
// signup/check-in panels, and -- critically -- creating and posting in the
// private per-lobby result threads under the score-recording channel. Without
// an explicit overwrite here the bot inherits the @everyone denial (below) the
// same as any other member, since it does not hold the manager role.
const BOT_OVERWRITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageChannels,
];

function overwrites(guild: Guild, managerRoleId: string, botMemberId: string, scoreChannel = false) {
  return [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: scoreChannel ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.CreatePublicThreads] : [PermissionFlagsBits.SendMessages] },
    { id: managerRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads] },
    { id: botMemberId, allow: BOT_OVERWRITE_PERMISSIONS },
  ];
}

async function ensureChannel(guild: Guild, id: string, name: string, categoryId: string, managerRoleId: string, botMemberId: string, existingChannels: GuildBasedChannel[], scoreChannel = false): Promise<TextChannel> {
  async function repairBotOverwrite(channel: TextChannel): Promise<TextChannel> {
    // A channel created before this fix (or one recovered by name below) can be
    // missing the bot's own overwrite entirely, which silently blocks thread
    // creation and message sends in the score-recording channel. Repair it in
    // place instead of only fixing newly-created channels.
    const current = channel.permissionOverwrites.cache.get(botMemberId);
    const hasAll = current ? BOT_OVERWRITE_PERMISSIONS.every((flag) => current.allow.has(flag)) : false;
    if (!hasAll) await channel.permissionOverwrites.create(botMemberId, Object.fromEntries(BOT_OVERWRITE_PERMISSIONS.map((flag) => [flag, true]))).catch((error) => console.error(`[discord-reconcile] failed to repair bot overwrite on #${channel.name}`, error));
    return channel;
  }
  if (id) {
    const existing = await guild.channels.fetch(id).catch(() => null);
    if (existing?.type === ChannelType.GuildText) return repairBotOverwrite(existing as TextChannel);
  }
  // The stored ID can be lost (e.g. a failed config write) even though the channel
  // still exists in Discord from an earlier attempt -- reuse it by name/parent
  // instead of creating a duplicate every reconcile tick.
  const byName = existingChannels.find(
    (channel): channel is TextChannel => channel.type === ChannelType.GuildText && channel.parentId === categoryId && channel.name === name,
  );
  if (byName) return repairBotOverwrite(byName);
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: categoryId, permissionOverwrites: overwrites(guild, managerRoleId, botMemberId, scoreChannel), reason: "TFTourney Discord tournament setup" }) as Promise<TextChannel>;
}

async function ensurePanel(channel: TextChannel, messageId: string, content: string, row: ActionRowBuilder<ButtonBuilder>): Promise<string> {
  if (messageId) {
    const old = await channel.messages.fetch(messageId).catch(() => null);
    if (old) {
      await old.edit({ content, components: [row] });
      return old.id;
    }
  }
  return (await channel.send({ content, components: [row] })).id;
}

function checkInPanelContent(config: ReconcileConfig): string {
  if (config.checkInStatus === "open") return `Check-in is open. ${config.checkedInCount} players have checked in.`;
  if (config.checkInStatus === "closed") return "Check-in is closed. The host has the final roster.";
  return "Check-in hasn't opened yet. The host opens it from the tournament page.";
}

async function provisionTournament(config: ReconcileConfig, guild: Guild): Promise<ReconcileConfig> {
  // Check permissions up front so a shortfall produces one clear, specific error
  // (and last_error message) instead of an opaque failure on whichever Discord API
  // call happens to hit the missing permission first -- which could be anywhere from
  // category creation to the very last panel message.
  const missing = await missingGuildPermissions(guild);
  if (missing.length > 0) {
    throw new Error(`Bot is missing required Discord permissions: ${missing.join(", ")}. Re-invite the bot with the full permission set from the tournament's Discord panel.`);
  }
  // Snapshot the guild's channels once so a lost category_id/channel_id (e.g. from an
  // earlier failed config write) can be recovered by name instead of recreated.
  const existingChannels = [...(await guild.channels.fetch().catch(() => guild.channels.cache)).values()].filter(
    (channel): channel is GuildBasedChannel => channel != null,
  );
  const categoryName = `TFTourney • ${config.name}`.slice(0, 100);
  let category = config.config.category_id ? await guild.channels.fetch(String(config.config.category_id)).catch(() => null) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = existingChannels.find(
      (channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory && channel.name === categoryName,
    ) ?? null;
  }
  if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: "TFTourney Discord tournament setup" });
  const managerRoleId = await ensureRole(guild, config);
  const botMemberId = (await getBotMember(guild))?.id ?? guild.client.user.id;
  const signup = await ensureChannel(guild, String(config.config.signup_channel_id ?? ""), "sign-up", category.id, managerRoleId, botMemberId, existingChannels);
  const checkin = await ensureChannel(guild, String(config.config.checkin_channel_id ?? ""), "check-in", category.id, managerRoleId, botMemberId, existingChannels);
  const scores = await ensureChannel(guild, String(config.config.score_channel_id ?? ""), "score-recording", category.id, managerRoleId, botMemberId, existingChannels, true);
  const signupMessageId = await ensurePanel(signup, String(config.config.signup_message_id ?? ""), "Submit your Riot ID once. The bot verifies it with Riot before adding you to the tournament.", buttonRow(config.tournamentId, "signup", config.status !== "accepting_players"));
  const checkinMessageId = await ensurePanel(checkin, String(config.config.checkin_message_id ?? ""), checkInPanelContent(config), buttonRow(config.tournamentId, "checkin", config.checkInStatus !== "open"));
  const patchResponse = await appFetch(`/api/internal/discord/config/${config.tournamentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guild_name: guild.name, category_id: category.id, signup_channel_id: signup.id, checkin_channel_id: checkin.id, score_channel_id: scores.id, manager_role_id: managerRoleId, signup_message_id: signupMessageId, checkin_message_id: checkinMessageId, state: "active", last_error: null, last_heartbeat_at: new Date().toISOString() }) });
  if (!patchResponse.ok) throw new Error(`Discord config PATCH failed for tournament ${config.tournamentId}: ${patchResponse.status} ${await patchResponse.text().catch(() => "")}`);
  return { ...config, config: { ...config.config, category_id: category.id, signup_channel_id: signup.id, checkin_channel_id: checkin.id, score_channel_id: scores.id, manager_role_id: managerRoleId, signup_message_id: signupMessageId, checkin_message_id: checkinMessageId } };
}

async function reportProvisionError(tournamentId: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : "Discord provisioning failed.").slice(0, 500);
  console.error(`[discord-reconcile] tournament ${tournamentId} provisioning failed`, error);
  await appFetch(`/api/internal/discord/config/${tournamentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "error", last_error: message }),
  }).catch((patchError) => console.error(`[discord-reconcile] failed to record error for tournament ${tournamentId}`, patchError));
}

async function reconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const response = await appFetch("/api/internal/discord/reconcile");
    if (!response.ok) throw new Error(`Discord reconciliation returned ${response.status}.`);
    const payload = await response.json() as { tournaments: ReconcileConfig[] };
    guildTournaments.clear();
    for (const config of payload.tournaments) {
      const guildId = String(config.config.guild_id ?? "");
      if (!guildId) continue;
      const list = guildTournaments.get(guildId) ?? [];
      list.push({
        tournamentId: config.tournamentId,
        name: config.name,
        categoryId: String(config.config.category_id ?? "") || null,
        managerRoleId: String(config.config.manager_role_id ?? "") || null,
        scoreCooldownSeconds: Number(config.config.score_cooldown_seconds ?? SCORE_COOLDOWN_DEFAULT_SECONDS),
      });
      guildTournaments.set(guildId, list);
    }
    for (const config of payload.tournaments) {
    // One tournament's failure (a bad guild ID, a stale config, a transient
    // Discord/API error) must not stop every other connected tournament from
    // being reconciled this tick -- isolate each tournament's work.
    try {
    const guildId = String(config.config.guild_id ?? "");
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    let provisioned: ReconcileConfig;
    try {
      provisioned = await provisionTournament(config, guild);
    } catch (error) {
      await reportProvisionError(config.tournamentId, error);
      continue;
    }
    const parent = await guild.channels.fetch(String(provisioned.config.score_channel_id)) as TextChannel | null;
    if (!parent || parent.type !== ChannelType.GuildText) continue;
    const existing = new Map(provisioned.threads.map((thread) => [`${thread.roundId}:${thread.lobbyNumber}`, thread]));
    const lobbiesByThread = new Map<string, ReconcileConfig["activeLobbies"][number]>();
    for (const lobby of provisioned.activeLobbies) {
      const key = `${lobby.roundId}:${lobby.lobbyNumber}`;
      if (!lobbiesByThread.has(key) || lobby.gameNumber < lobbiesByThread.get(key)!.gameNumber) lobbiesByThread.set(key, lobby);
    }
    for (const lobby of lobbiesByThread.values()) {
      const key = `${lobby.roundId}:${lobby.lobbyNumber}`;
      let thread = existing.get(key) ? await guild.channels.fetch(existing.get(key)!.threadId).catch(() => null) as ThreadChannel | null : null;
      if (!thread || !thread.isThread()) {
        thread = await parent.threads.create({ name: `Round ${lobby.roundId} • Lobby ${lobby.lobbyNumber}`, type: ChannelType.PrivateThread, autoArchiveDuration: 10080, reason: "TFTourney score recording lobby" });
        await appFetch("/api/internal/discord/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundId: lobby.roundId, lobbyNumber: lobby.lobbyNumber, threadId: thread.id }) });
        await thread.send({ content: `This thread records Lobby ${lobby.lobbyNumber}. Screenshots are processed in order; the bot announces each accepted game.` });
        existing.set(key, { roundId: lobby.roundId, lobbyNumber: lobby.lobbyNumber, threadId: thread.id, state: "active" });
      }
      const participantIds = lobby.participants.map((participant) => participant.discordUserId).filter((id): id is string => Boolean(id)).sort();
      const participantKey = participantIds.join(",");
      if (threadParticipantKeys.get(thread.id) !== participantKey) {
        let allAdded = true;
        for (const participantId of participantIds) {
          const added = await thread.members.add(participantId).then(() => true).catch(() => false);
          if (!added) allAdded = false;
        }
        if (allAdded) threadParticipantKeys.set(thread.id, participantKey);
      }
      threadContext.set(thread.id, { tournamentId: config.tournamentId, managerRoleId: String(provisioned.config.manager_role_id ?? "") || null, lobbyId: lobby.id });
    }
    const activeKeys = new Set(lobbiesByThread.keys());
    for (const oldThread of provisioned.threads) {
      const key = `${oldThread.roundId}:${oldThread.lobbyNumber}`;
      if (oldThread.state !== "active" || activeKeys.has(key)) continue;
      const thread = await guild.channels.fetch(oldThread.threadId).catch(() => null) as ThreadChannel | null;
      if (thread?.isThread()) {
        await thread.setLocked(true, "TFTourney round concluded").catch(() => undefined);
        await thread.setArchived(true, "TFTourney round concluded").catch(() => undefined);
      }
      await appFetch("/api/internal/discord/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundId: oldThread.roundId, lobbyNumber: oldThread.lobbyNumber, threadId: oldThread.threadId, state: "archived" }) }).catch(() => undefined);
      threadContext.delete(oldThread.threadId);
      threadParticipantKeys.delete(oldThread.threadId);
    }
    } catch (error) {
      console.error(`[discord-reconcile] tournament ${config.tournamentId}`, error);
    }
    }
  } finally {
    reconciling = false;
  }
}

type CleanupItem = {
  tournamentId: string;
  name: string;
  guildId: string;
  categoryId: string | null;
  signupChannelId: string | null;
  checkinChannelId: string | null;
  scoreChannelId: string | null;
  managerRoleId: string | null;
  cleanupAction: "archive" | "delete";
};

let cleaningUp = false;

// Locks and Discord-archives every open per-lobby result thread under a
// score-recording channel, mirroring the "round concluded" archival already
// done in reconcile() -- so an archived tournament doesn't leave live threads
// a manager could still post score corrections into.
async function archiveChannelThreads(channel: TextChannel): Promise<void> {
  const active = await channel.threads.fetchActive().catch(() => null);
  for (const thread of active?.threads.values() ?? []) {
    await thread.setLocked(true, "TFTourney tournament disconnected").catch(() => undefined);
    await thread.setArchived(true, "TFTourney tournament disconnected").catch(() => undefined);
  }
}

async function cleanupTournament(item: CleanupItem): Promise<Record<string, unknown>> {
  const guild = await client.guilds.fetch(item.guildId).catch(() => null);
  // The bot was removed from the guild (or never made it in) -- there is
  // nothing left to archive or delete.
  if (!guild) return {};

  const channelIds = [item.signupChannelId, item.checkinChannelId, item.scoreChannelId]
    .filter((id): id is string => Boolean(id));

  if (item.cleanupAction === "delete") {
    const reason = `TFTourney: tournament "${item.name}" disconnected`;
    for (const channelId of channelIds) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.delete(reason).catch((error) => console.error(`[discord-cleanup] failed to delete channel ${channelId}`, error));
    }
    if (item.categoryId) {
      const category = await guild.channels.fetch(item.categoryId).catch(() => null);
      if (category) await category.delete(reason).catch((error) => console.error(`[discord-cleanup] failed to delete category ${item.categoryId}`, error));
    }
    if (item.managerRoleId) {
      const role = await guild.roles.fetch(item.managerRoleId).catch(() => null);
      if (role) await role.delete(reason).catch((error) => console.error(`[discord-cleanup] failed to delete role ${item.managerRoleId}`, error));
    }
    // The provisioned IDs no longer point at anything -- clear them so a
    // future reconnect provisions fresh resources instead of repeatedly
    // failing to fetch deleted ones (it would fall back to creating new ones
    // either way, but this keeps the row from being misleading in the meantime).
    return {
      category_id: null, signup_channel_id: null, checkin_channel_id: null, score_channel_id: null,
      manager_role_id: null, signup_message_id: null, checkin_message_id: null,
    };
  }

  // Archive: freeze the manager role's write access, lock+archive any open
  // result threads, and rename channels/category for visibility. @everyone
  // already has SendMessages denied on every provisioned channel from
  // creation (see overwrites()), so only the manager role needs locking down.
  for (const channelId of channelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    await archiveChannelThreads(channel as TextChannel);
    if (item.managerRoleId) {
      await channel.permissionOverwrites
        .create(item.managerRoleId, { SendMessages: false, SendMessagesInThreads: false, ManageThreads: false })
        .catch((error) => console.error(`[discord-cleanup] failed to lock channel ${channelId}`, error));
    }
    if (!channel.name.startsWith("archived-")) {
      await channel.setName(`archived-${channel.name}`.slice(0, 100), "TFTourney tournament disconnected")
        .catch((error) => console.error(`[discord-cleanup] failed to rename channel ${channelId}`, error));
    }
  }
  if (item.categoryId) {
    const category = await guild.channels.fetch(item.categoryId).catch(() => null);
    if (category && category.type === ChannelType.GuildCategory && !category.name.startsWith("Archived • ")) {
      await category.setName(`Archived • ${category.name}`.slice(0, 100), "TFTourney tournament disconnected")
        .catch((error) => console.error(`[discord-cleanup] failed to rename category ${item.categoryId}`, error));
    }
  }
  return {};
}

// Disconnected tournaments (state: "disabled") drop out of the normal
// reconcile() payload, so this is polled separately for the one thing they
// still need: a one-time archive-or-delete of what was provisioned.
async function runCleanup(): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  try {
    const response = await appFetch("/api/internal/discord/cleanup");
    if (!response.ok) {
      console.error(`[discord-cleanup] queue fetch failed with ${response.status}`, await response.text().catch(() => ""));
      return;
    }
    const payload = await response.json() as { cleanups: CleanupItem[] };
    for (const item of payload.cleanups) {
      try {
        const extraFields = await cleanupTournament(item);
        await appFetch(`/api/internal/discord/config/${item.tournamentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...extraFields, cleanup_completed_at: new Date().toISOString() }),
        });
        console.log(`[discord-cleanup] ${item.cleanupAction}d Discord resources for tournament ${item.tournamentId}`);
      } catch (error) {
        console.error(`[discord-cleanup] failed for tournament ${item.tournamentId}`, error);
      }
    }
  } catch (error) {
    console.error("[discord-cleanup]", error);
  } finally {
    cleaningUp = false;
  }
}

async function processSubmission(): Promise<void> {
  if (processing) return;
  processing = true;
  let claim: ClaimedSubmission | null = null;
  try {
    const claimResponse = await appFetch("/api/internal/discord/submissions/claim", { method: "POST" });
    if (claimResponse.status === 204) return;
    if (!claimResponse.ok) {
      console.error(`[discord-score-worker] claim request failed with ${claimResponse.status}`, await claimResponse.text().catch(() => ""));
      return;
    }
    claim = await claimResponse.json() as ClaimedSubmission;
    if (claim.claimStatus === "rejected_cooldown") {
      const thread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
      if (thread) await replyInThread(thread, claim.discordMessageId, cooldownRejectionMessage(claim.retryAfterSeconds));
      return;
    }
    const currentThread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
    const currentContext = threadContext.get(claim.threadId);
    if (currentThread && currentContext) threadContext.set(claim.threadId, { ...currentContext, lobbyId: claim.lobbyId });
    const logPrefix = `[discord-score-worker] submission ${claim.submissionId} (tournament ${claim.tournamentId}, lobby ${claim.lobbyId}, game ${claim.gameNumber})`;
    console.log(`${logPrefix}: claimed, running OCR against a ${claim.roster.length}-player roster`);
    const imageResponse = await appFetch(claim.imageUrl);
    if (!imageResponse.ok) throw new Error("Stored screenshot could not be loaded.");
    const imageBytes = await imageResponse.arrayBuffer();
    const form = new FormData();
    form.append("image", new Blob([imageBytes], { type: imageResponse.headers.get("content-type") ?? "image/png" }), "score.png");
    form.append("roster", JSON.stringify(claim.roster));
    const ocrResponse = await fetch(`${appUrl}/api/ocr/placements`, { method: "POST", headers: { Authorization: `Bearer ${ocrSecret}` }, body: form });
    const ocr = await ocrResponse.json() as {
      status?: string;
      strategy?: string;
      placements?: Array<{ placement: number; extractedName?: string; matchStatus: string; matchedRosterEntry?: { id: string; displayName?: string } | null }>;
      issues?: Array<{ code?: string; message?: string }>;
      debug?: { layoutConfidence?: number; selectedProfile?: string };
      error?: string;
      code?: string;
    };
    if (!ocrResponse.ok) {
      console.error(`${logPrefix}: OCR request failed with ${ocrResponse.status} (${ocr.code ?? "unknown"}) ${ocr.error ?? ""}`);
    } else {
      const matched = ocr.placements?.filter((row) => row.matchStatus === "matched").length ?? 0;
      console.log(`${logPrefix}: OCR status=${ocr.status ?? "n/a"} strategy=${ocr.strategy ?? "n/a"} profile=${ocr.debug?.selectedProfile ?? "n/a"} confidence=${ocr.debug?.layoutConfidence?.toFixed(2) ?? "n/a"} matched=${matched}/${claim.roster.length}`);
    }
    const complete = ocrResponse.ok && ocr.status === "complete" && Array.isArray(ocr.placements) && ocr.placements.length === claim.roster.length && ocr.placements.every((row) => row.matchStatus === "matched" && row.matchedRosterEntry?.id);
    const thread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
    if (!complete) {
      if (ocrResponse.ok) {
        for (const row of ocr.placements ?? []) {
          if (row.matchStatus !== "matched") console.log(`${logPrefix}:   #${row.placement} "${row.extractedName}" -> ${row.matchStatus}`);
        }
        for (const issue of ocr.issues ?? []) console.log(`${logPrefix}:   issue: ${issue.code} - ${issue.message}`);
      }
      await appFetch(`/api/internal/discord/submissions/${claim.submissionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseToken: claim.leaseToken, ocrResult: ocr, errorCode: "OCR_REVIEW_REQUIRED", errorMessage: "OCR could not produce an unambiguous complete roster." }) });
      if (thread) await notifyFacilitator(thread, "OCR could not validate this screenshot. A facilitator must review it before the next image is processed.");
      return;
    }
    const results = ocr.placements!.map((row) => ({ participantId: row.matchedRosterEntry!.id, placement: row.placement }));
    const scoreResponse = await appFetch(`/api/tournaments/${claim.tournamentId}/lobbies/${claim.lobbyId}/results`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": claim.submissionId }, body: JSON.stringify({ results, submissionId: claim.submissionId, mode: "record" }) });
    if (!scoreResponse.ok) {
      const error = await scoreResponse.json().catch(() => ({})) as { error?: string; code?: string };
      console.error(`${logPrefix}: score write failed with ${scoreResponse.status} (${error.code ?? "unknown"}) ${error.error ?? ""}`);
      await appFetch(`/api/internal/discord/submissions/${claim.submissionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseToken: claim.leaseToken, ocrResult: ocr, errorCode: "SCORE_WRITE_FAILED", errorMessage: error.error ?? "The score could not be recorded." }) });
      if (thread) await notifyFacilitator(thread, error.error ?? "The score could not be recorded; facilitator review is required.");
      return;
    }
    console.log(`${logPrefix}: recorded`);
    if (thread) await replyInThread(thread, claim.discordMessageId, `✅ Game ${claim.gameNumber} has been recorded.`);
  } catch (error) {
    console.error("[discord-score-worker]", error);
    if (claim?.claimStatus === "claimed" && claim.attemptCount >= 3) {
      const thread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
      await appFetch(`/api/internal/discord/submissions/${claim.submissionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseToken: claim.leaseToken, errorCode: "PROCESSING_RETRIES_EXHAUSTED", errorMessage: "The screenshot worker could not process this image after three attempts." }) }).catch(() => undefined);
      if (thread) await notifyFacilitator(thread, "The screenshot worker could not process this image after three attempts. A facilitator must review it.");
    }
  } finally {
    processing = false;
  }
}

// Replies directly to the Discord message that produced a queue result
// (accepted or rejected), instead of a plain thread post, so the submitter
// can tell which of their screenshots the notice is about. Falls back to a
// plain post if the original message is gone (e.g. deleted by the sender).
async function replyInThread(thread: ThreadChannel, messageId: string, content: string): Promise<void> {
  await thread
    .send({ content, reply: { messageReference: messageId, failIfNotExists: false }, allowedMentions: { repliedUser: false } })
    .catch(() => thread.send({ content }).catch((error) => console.error("[discord-bot] failed to post in thread", error)));
}

async function notifyFacilitator(thread: ThreadChannel, message: string): Promise<void> {
  const context = threadContext.get(thread.id);
  const lobbyLink = context?.lobbyId ? ` ${appUrl}/tournaments/${context.tournamentId}/lobbies/${context.lobbyId}` : "";
  await thread.send({ content: `${context?.managerRoleId ? `<@&${context.managerRoleId}> ` : ""}${message}${lobbyLink ? `\nLobby review: ${lobbyLink}` : ""}`, allowedMentions: context?.managerRoleId ? { roles: [context.managerRoleId] } : undefined });
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.channel.isThread()) return;
  const context = threadContext.get(message.channel.id);
  if (!context) return;
  if (message.attachments.size !== 1) {
    await notifyFacilitator(message.channel as ThreadChannel, "Send exactly one score screenshot per message.");
    return;
  }
  const attachment = message.attachments.first();
  if (!attachment || !["image/png", "image/jpeg", "image/webp"].includes(attachment.contentType ?? "")) {
    await notifyFacilitator(message.channel as ThreadChannel, "Only PNG, JPEG, or WebP score screenshots are accepted.");
    return;
  }
  if (attachment.size > 7 * 1024 * 1024) {
    await notifyFacilitator(message.channel as ThreadChannel, "Score screenshots must be 7 MB or smaller.");
    return;
  }
  const imageResponse = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
  if (!imageResponse.ok) {
    await notifyFacilitator(message.channel as ThreadChannel, "The Discord attachment could not be downloaded.");
    return;
  }
  const form = new FormData();
  form.append("tournamentId", context.tournamentId);
  form.append("threadId", message.channel.id);
  form.append("messageId", message.id);
  form.append("userId", message.author.id);
  form.append("receivedAt", message.createdAt.toISOString());
  form.append("image", new Blob([await imageResponse.arrayBuffer()], { type: attachment.contentType ?? "image/png" }), attachment.name);
  const response = await appFetch("/api/internal/discord/submissions", { method: "POST", body: form });
  const result = await response.json().catch(() => ({})) as { status?: string; queuePosition?: number | null; retryAfterSeconds?: number | null; error?: string };
  if (result.status === "rejected_cooldown") {
    // Reply, don't hold: this lobby was just scored, so the sender needs to
    // know now rather than have the screenshot silently overwrite the next
    // game once the cooldown clears. No facilitator ping -- this is routine.
    await message.reply({ content: cooldownRejectionMessage(result.retryAfterSeconds ?? SCORE_COOLDOWN_DEFAULT_SECONDS), allowedMentions: { repliedUser: false } });
  } else if (result.status === "rejected_spam") {
    await message.reply({ content: result.error ?? "Please wait before sending another screenshot.", allowedMentions: { repliedUser: false } });
  } else if (response.status === 429 || result.status === "rejected_overflow") {
    await notifyFacilitator(message.channel as ThreadChannel, result.error ?? "Too many screenshots are waiting; facilitator attention is required.");
  } else if (!response.ok) {
    await notifyFacilitator(message.channel as ThreadChannel, result.error ?? "The screenshot could not be queued.");
  } else {
    await message.reply({ content: `Screenshot queued${result.queuePosition ? ` at position ${result.queuePosition}` : ""}.`, allowedMentions: { repliedUser: false } });
  }
}

// Resolves the Discord category a slash command was invoked under -- a
// tournament's category is how we know which connected tournament a command
// in that guild refers to (see selectTournamentForCommand). Handles both a
// command run directly in a tournament channel and one run inside one of its
// private score-recording threads.
async function resolveCommandCategoryId(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const channel = await client.channels.fetch(interaction.channelId).catch(() => null);
  if (!channel) return null;
  if (channel.isThread()) {
    const parent = channel.parent ?? (channel.parentId ? await client.channels.fetch(channel.parentId).catch(() => null) : null);
    return parent && "parentId" in parent ? parent.parentId : null;
  }
  return "parentId" in channel ? channel.parentId : null;
}

function memberRoleIds(member: GuildMember | APIInteractionGuildMember | null | undefined): string[] {
  if (!member) return [];
  return Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()];
}

async function handleLobbyCooldownCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "This command only works inside a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  const candidates = guildTournaments.get(interaction.guildId) ?? [];
  if (candidates.length === 0) {
    await interaction.reply({ content: "This server isn't connected to a tournament yet, or the bot is still syncing -- try again in a few seconds.", flags: MessageFlags.Ephemeral });
    return;
  }
  const categoryId = await resolveCommandCategoryId(interaction);
  const tournament = selectTournamentForCommand(candidates, categoryId);
  if (!tournament) {
    await interaction.reply({ content: "Run this command inside one of the tournament's own channels or threads so the bot knows which tournament you mean.", flags: MessageFlags.Ephemeral });
    return;
  }
  const hasManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!canManageLobbyCooldown({ hasManageGuild, roleIds: memberRoleIds(interaction.member), managerRoleId: tournament.managerRoleId })) {
    await interaction.reply({ content: "You need the Manage Server permission or the tournament's manager role to change this.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.options.getSubcommand() === "show") {
    await interaction.reply({ content: `Lobby cooldown for **${tournament.name}**: ${formatCooldownDuration(tournament.scoreCooldownSeconds)}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const seconds = parseCooldownSeconds(interaction.options.getInteger("seconds", true));
  if (seconds === null) {
    await interaction.reply({ content: `Seconds must be a whole number between 0 and ${SCORE_COOLDOWN_MAX_SECONDS}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  const response = await appFetch(`/api/internal/discord/config/${tournament.tournamentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score_cooldown_seconds: seconds }) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    await interaction.editReply(error.error ?? "Could not update the lobby cooldown; try again later.");
    return;
  }
  tournament.scoreCooldownSeconds = seconds;
  await interaction.editReply(`✅ Lobby cooldown for **${tournament.name}** is now ${formatCooldownDuration(seconds)}.`);
}

async function handleInteraction(interaction: import("discord.js").Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "lobby-cooldown") await handleLobbyCooldownCommand(interaction);
    return;
  }
  if (interaction.isButton()) {
    const [kind, tournamentId] = interaction.customId.split(":");
    if (kind === "signup") {
      const modal = new ModalBuilder().setCustomId(`signup-modal:${tournamentId}`).setTitle("TFTourney sign up");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("riot-id").setLabel("Riot ID (GameName#TAG)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));
      await interaction.showModal(modal);
    } else if (kind === "checkin") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const response = await appFetch("/api/internal/discord/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentId, discordUserId: interaction.user.id }) });
      const result = await response.json().catch(() => ({})) as { displayName?: string; error?: string };
      await interaction.editReply(response.ok ? `✅ ${result.displayName ?? "You"} are checked in.` : `Unable to check in: ${result.error ?? "try again later."}`);
    }
  } else if (interaction.isModalSubmit() && interaction.customId.startsWith("signup-modal:")) {
    const tournamentId = interaction.customId.split(":")[1] ?? "";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await appFetch("/api/internal/discord/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentId, discordUserId: interaction.user.id, gameTag: interaction.fields.getTextInputValue("riot-id") }) });
    const result = await response.json().catch(() => ({})) as { displayName?: string; error?: string };
    await interaction.editReply(response.ok ? `✅ ${result.displayName ?? "Riot account"} verified and registered.` : `Unable to register: ${result.error ?? "try again later."}`);
  }
}

function findGreetableChannel(guild: Guild, botMember: GuildMember | null): TextChannel | null {
  const canSend = (channel: GuildBasedChannel): channel is TextChannel =>
    channel.type === ChannelType.GuildText && (!botMember || channel.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages) === true);
  if (guild.systemChannel && canSend(guild.systemChannel)) return guild.systemChannel;
  return [...guild.channels.cache.values()].find(canSend) ?? null;
}

async function greetUnmatchedGuild(guild: Guild): Promise<void> {
  const botMember = await getBotMember(guild);
  const missing = botMember ? REQUIRED_GUILD_PERMISSIONS.filter(([flag]) => !botMember.permissions.has(flag)).map(([, label]) => label) : [];
  const channel = findGreetableChannel(guild, botMember);
  const lines = [
    "👋 Thanks for adding the TFTourney Organizer bot!",
    missing.length > 0
      ? `⚠️ It's missing these permissions: ${missing.join(", ")}. Re-invite it with the full permission set from the tournament's Discord panel.`
      : null,
    `This server isn't connected to a tournament yet. If you just used "Connect a Discord server" on a tournament's page, refresh that page -- it usually finishes within a few seconds. Otherwise, open the **Discord** card on the tournament's page and use "Connect a Discord server" again, or enter this server's ID by hand: \`${guild.id}\``,
  ].filter((line): line is string => line !== null).join("\n\n");
  if (!channel) {
    console.error(`[discord-bot] joined guild ${guild.id} (${guild.name}) but has no channel it can post in`);
    return;
  }
  await channel.send({ content: lines }).catch((error) => console.error(`[discord-bot] failed to greet guild ${guild.id}`, error));
}

// How long to keep polling for the OAuth callback's config write before
// concluding a guild join is genuinely a manual/standalone install. Discord
// adds the bot (and fires this event) as soon as the user authorizes --
// before the browser has even been redirected back to our callback, which
// still has to check the host's session and write to the database. A single
// short wait can lose that race in a slower environment (a local dev server
// behind a tunnel, a cold database connection, etc.), which was producing a
// false "this server isn't connected" greeting on every use of "Add bot to
// your Discord server". Polling for longer costs nothing (this runs off the
// event loop, not blocking anything else) and makes the connection complete
// silently in the vast majority of cases instead of alarming the host.
const GUILD_CREATE_RECONCILE_RETRIES = 9;
const GUILD_CREATE_RECONCILE_INTERVAL_MS = 2_000;

async function handleGuildCreate(guild: Guild): Promise<void> {
  console.log(`[discord-bot] joined guild ${guild.id} (${guild.name})`);
  await reconcile().catch((error) => console.error("[discord-reconcile]", error));
  for (let attempt = 0; attempt < GUILD_CREATE_RECONCILE_RETRIES; attempt += 1) {
    if (guildTournaments.has(guild.id)) return;
    await new Promise((resolve) => setTimeout(resolve, GUILD_CREATE_RECONCILE_INTERVAL_MS));
    await reconcile().catch((error) => console.error("[discord-reconcile]", error));
  }
  if (guildTournaments.has(guild.id)) return;
  await greetUnmatchedGuild(guild);
}

async function handleGuildDelete(guild: Guild): Promise<void> {
  console.log(`[discord-bot] removed from guild ${guild.id} (${guild.name})`);
  const tournamentIds = (guildTournaments.get(guild.id) ?? []).map((tournament) => tournament.tournamentId);
  for (const tournamentId of tournamentIds) {
    await appFetch(`/api/internal/discord/config/${tournamentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "error", last_error: "The bot was removed from the Discord server." }),
    }).catch((error) => console.error(`[discord-reconcile] failed to record removal for tournament ${tournamentId}`, error));
  }
  guildTournaments.delete(guild.id);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] logged in as ${readyClient.user.tag}`);
  // Global command registration (as opposed to per-guild) needs the
  // `applications.commands` OAuth scope on every install; the bot-install
  // route requests it, but a server authorized before that change will not
  // see the command until the host re-runs "Connect a Discord server".
  void readyClient.application.commands.set([lobbyCooldownCommand])
    .then(() => console.log("[discord-bot] registered application commands"))
    .catch((error) => console.error("[discord-bot] command registration failed", error));
  void reconcile().catch((error) => console.error("[discord-reconcile]", error));
  void runCleanup().catch((error) => console.error("[discord-cleanup]", error));
  void appFetch("/api/internal/discord/retention", { method: "POST" }).catch((error) => console.error("[discord-retention]", error));
  setInterval(() => void reconcile().catch((error) => console.error("[discord-reconcile]", error)), 10_000);
  setInterval(() => void runCleanup().catch((error) => console.error("[discord-cleanup]", error)), 10_000);
  setInterval(() => void processSubmission(), 2_000);
  setInterval(() => void appFetch("/api/internal/discord/retention", { method: "POST" }).catch((error) => console.error("[discord-retention]", error)), 60 * 60 * 1000);
});
client.on("messageCreate", (message) => void handleMessage(message).catch((error) => console.error("[discord-message]", error)));
client.on("interactionCreate", (interaction) => void handleInteraction(interaction).catch((error) => console.error("[discord-interaction]", error)));
client.on("guildCreate", (guild) => void handleGuildCreate(guild).catch((error) => console.error("[discord-bot] guildCreate handler failed", error)));
client.on("guildDelete", (guild) => void handleGuildDelete(guild).catch((error) => console.error("[discord-bot] guildDelete handler failed", error)));
process.on("SIGINT", () => void client.destroy());
process.on("SIGTERM", () => void client.destroy());
void client.login(botToken);
