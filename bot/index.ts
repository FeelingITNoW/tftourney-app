import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import dotenv from "dotenv";

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

type ClaimedSubmission = {
  submissionId: string;
  tournamentId: string;
  roundId: string;
  threadId: string;
  lobbyId: string;
  gameNumber: number;
  leaseToken: string;
  attemptCount: number;
  roster: Array<{ id: string; displayName: string }>;
  imageUrl: string;
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

async function ensureRole(guild: Guild, config: ReconcileConfig): Promise<string> {
  const configuredId = String(config.config.manager_role_id ?? "");
  if (configuredId) {
    const role = await guild.roles.fetch(configuredId).catch(() => null);
    if (role) return role.id;
  }
  const role = await guild.roles.create({ name: `TFT Manager • ${config.name}`.slice(0, 100), reason: `TFTourney manager role for ${config.tournamentId}` });
  return role.id;
}

function overwrites(guild: Guild, managerRoleId: string, scoreChannel = false) {
  return [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: scoreChannel ? [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.CreatePublicThreads] : [PermissionFlagsBits.SendMessages] },
    { id: managerRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads] },
  ];
}

async function ensureChannel(guild: Guild, id: string, name: string, categoryId: string, managerRoleId: string, existingChannels: GuildBasedChannel[], scoreChannel = false): Promise<TextChannel> {
  if (id) {
    const existing = await guild.channels.fetch(id).catch(() => null);
    if (existing?.type === ChannelType.GuildText) return existing as TextChannel;
  }
  // The stored ID can be lost (e.g. a failed config write) even though the channel
  // still exists in Discord from an earlier attempt -- reuse it by name/parent
  // instead of creating a duplicate every reconcile tick.
  const byName = existingChannels.find(
    (channel): channel is TextChannel => channel.type === ChannelType.GuildText && channel.parentId === categoryId && channel.name === name,
  );
  if (byName) return byName;
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: categoryId, permissionOverwrites: overwrites(guild, managerRoleId, scoreChannel), reason: "TFTourney Discord tournament setup" }) as Promise<TextChannel>;
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

async function provisionTournament(config: ReconcileConfig, guild: Guild): Promise<ReconcileConfig> {
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
  const signup = await ensureChannel(guild, String(config.config.signup_channel_id ?? ""), "sign-up", category.id, managerRoleId, existingChannels);
  const checkin = await ensureChannel(guild, String(config.config.checkin_channel_id ?? ""), "check-in", category.id, managerRoleId, existingChannels);
  const scores = await ensureChannel(guild, String(config.config.score_channel_id ?? ""), "score-recording", category.id, managerRoleId, existingChannels, true);
  const signupMessageId = await ensurePanel(signup, String(config.config.signup_message_id ?? ""), "Submit your Riot ID once. The bot verifies it with Riot before adding you to the tournament.", buttonRow(config.tournamentId, "signup", config.status !== "accepting_players"));
  const checkinMessageId = await ensurePanel(checkin, String(config.config.checkin_message_id ?? ""), config.checkInStatus === "open" ? `Check-in is open. ${config.checkedInCount} players have checked in.` : `Check-in is ${config.checkInStatus}.`, buttonRow(config.tournamentId, "checkin", config.checkInStatus !== "open"));
  const patchResponse = await appFetch(`/api/internal/discord/config/${config.tournamentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category_id: category.id, signup_channel_id: signup.id, checkin_channel_id: checkin.id, score_channel_id: scores.id, manager_role_id: managerRoleId, signup_message_id: signupMessageId, checkin_message_id: checkinMessageId, state: "active", last_error: null, last_heartbeat_at: new Date().toISOString() }) });
  if (!patchResponse.ok) throw new Error(`Discord config PATCH failed for tournament ${config.tournamentId}: ${patchResponse.status} ${await patchResponse.text().catch(() => "")}`);
  return { ...config, config: { ...config.config, category_id: category.id, signup_channel_id: signup.id, checkin_channel_id: checkin.id, score_channel_id: scores.id, manager_role_id: managerRoleId, signup_message_id: signupMessageId, checkin_message_id: checkinMessageId } };
}

async function reconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const response = await appFetch("/api/internal/discord/reconcile");
    if (!response.ok) throw new Error(`Discord reconciliation returned ${response.status}.`);
    const payload = await response.json() as { tournaments: ReconcileConfig[] };
    for (const config of payload.tournaments) {
    // One tournament's failure (a bad guild ID, a stale config, a transient
    // Discord/API error) must not stop every other connected tournament from
    // being reconciled this tick -- isolate each tournament's work.
    try {
    const guildId = String(config.config.guild_id ?? "");
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    const provisioned = await provisionTournament(config, guild);
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

async function processSubmission(): Promise<void> {
  if (processing) return;
  processing = true;
  let claim: ClaimedSubmission | null = null;
  try {
    const claimResponse = await appFetch("/api/internal/discord/submissions/claim", { method: "POST" });
    if (claimResponse.status === 204) return;
    if (!claimResponse.ok) return;
    claim = await claimResponse.json() as ClaimedSubmission;
    const currentThread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
    const currentContext = threadContext.get(claim.threadId);
    if (currentThread && currentContext) threadContext.set(claim.threadId, { ...currentContext, lobbyId: claim.lobbyId });
    const imageResponse = await appFetch(claim.imageUrl);
    if (!imageResponse.ok) throw new Error("Stored screenshot could not be loaded.");
    const imageBytes = await imageResponse.arrayBuffer();
    const form = new FormData();
    form.append("image", new Blob([imageBytes], { type: imageResponse.headers.get("content-type") ?? "image/png" }), "score.png");
    form.append("roster", JSON.stringify(claim.roster));
    const ocrResponse = await fetch(`${appUrl}/api/ocr/placements`, { method: "POST", headers: { Authorization: `Bearer ${ocrSecret}` }, body: form });
    const ocr = await ocrResponse.json() as { status?: string; placements?: Array<{ placement: number; matchStatus: string; matchedRosterEntry?: { id: string } | null }>; issues?: unknown[] };
    const complete = ocrResponse.ok && ocr.status === "complete" && Array.isArray(ocr.placements) && ocr.placements.length === claim.roster.length && ocr.placements.every((row) => row.matchStatus === "matched" && row.matchedRosterEntry?.id);
    const thread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
    if (!complete) {
      await appFetch(`/api/internal/discord/submissions/${claim.submissionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseToken: claim.leaseToken, ocrResult: ocr, errorCode: "OCR_REVIEW_REQUIRED", errorMessage: "OCR could not produce an unambiguous complete roster." }) });
      if (thread) await notifyFacilitator(thread, "OCR could not validate this screenshot. A facilitator must review it before the next image is processed.");
      return;
    }
    const results = ocr.placements!.map((row) => ({ participantId: row.matchedRosterEntry!.id, placement: row.placement }));
    const scoreResponse = await appFetch(`/api/tournaments/${claim.tournamentId}/lobbies/${claim.lobbyId}/results`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": claim.submissionId }, body: JSON.stringify({ results, submissionId: claim.submissionId, mode: "record" }) });
    if (!scoreResponse.ok) {
      const error = await scoreResponse.json().catch(() => ({})) as { error?: string };
      await appFetch(`/api/internal/discord/submissions/${claim.submissionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseToken: claim.leaseToken, ocrResult: ocr, errorCode: "SCORE_WRITE_FAILED", errorMessage: error.error ?? "The score could not be recorded." }) });
      if (thread) await notifyFacilitator(thread, error.error ?? "The score could not be recorded; facilitator review is required.");
      return;
    }
    if (thread) await thread.send({ content: `✅ Game ${claim.gameNumber} has been recorded.` });
  } catch (error) {
    console.error("[discord-score-worker]", error);
    if (claim && claim.attemptCount >= 3) {
      const thread = await client.channels.fetch(claim.threadId).catch(() => null) as ThreadChannel | null;
      await appFetch(`/api/internal/discord/submissions/${claim.submissionId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseToken: claim.leaseToken, errorCode: "PROCESSING_RETRIES_EXHAUSTED", errorMessage: "The screenshot worker could not process this image after three attempts." }) }).catch(() => undefined);
      if (thread) await notifyFacilitator(thread, "The screenshot worker could not process this image after three attempts. A facilitator must review it.");
    }
  } finally {
    processing = false;
  }
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
  const result = await response.json().catch(() => ({})) as { status?: string; queuePosition?: number | null; error?: string };
  if (response.status === 429 || result.status === "rejected_overflow") await notifyFacilitator(message.channel as ThreadChannel, result.error ?? "Too many screenshots are waiting; facilitator attention is required.");
  else if (!response.ok) await notifyFacilitator(message.channel as ThreadChannel, result.error ?? "The screenshot could not be queued.");
  else await message.reply({ content: `Screenshot queued${result.queuePosition ? ` at position ${result.queuePosition}` : ""}.`, allowedMentions: { repliedUser: false } });
}

async function handleInteraction(interaction: import("discord.js").Interaction): Promise<void> {
  if (interaction.isButton()) {
    const [kind, tournamentId] = interaction.customId.split(":");
    if (kind === "signup") {
      const modal = new ModalBuilder().setCustomId(`signup-modal:${tournamentId}`).setTitle("TFTourney sign up");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("riot-id").setLabel("Riot ID (GameName#TAG)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));
      await interaction.showModal(modal);
    } else if (kind === "checkin") {
      await interaction.deferReply({ ephemeral: true });
      const response = await appFetch("/api/internal/discord/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentId, discordUserId: interaction.user.id }) });
      const result = await response.json().catch(() => ({})) as { displayName?: string; error?: string };
      await interaction.editReply(response.ok ? `✅ ${result.displayName ?? "You"} are checked in.` : `Unable to check in: ${result.error ?? "try again later."}`);
    }
  } else if (interaction.isModalSubmit() && interaction.customId.startsWith("signup-modal:")) {
    const tournamentId = interaction.customId.split(":")[1] ?? "";
    await interaction.deferReply({ ephemeral: true });
    const response = await appFetch("/api/internal/discord/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentId, discordUserId: interaction.user.id, gameTag: interaction.fields.getTextInputValue("riot-id") }) });
    const result = await response.json().catch(() => ({})) as { displayName?: string; error?: string };
    await interaction.editReply(response.ok ? `✅ ${result.displayName ?? "Riot account"} verified and registered.` : `Unable to register: ${result.error ?? "try again later."}`);
  }
}

client.once("ready", () => {
  console.log(`[discord-bot] logged in as ${client.user?.tag}`);
  void reconcile().catch((error) => console.error("[discord-reconcile]", error));
  void appFetch("/api/internal/discord/retention", { method: "POST" }).catch((error) => console.error("[discord-retention]", error));
  setInterval(() => void reconcile().catch((error) => console.error("[discord-reconcile]", error)), 10_000);
  setInterval(() => void processSubmission(), 2_000);
  setInterval(() => void appFetch("/api/internal/discord/retention", { method: "POST" }).catch((error) => console.error("[discord-retention]", error)), 60 * 60 * 1000);
});
client.on("messageCreate", (message) => void handleMessage(message).catch((error) => console.error("[discord-message]", error)));
client.on("interactionCreate", (interaction) => void handleInteraction(interaction).catch((error) => console.error("[discord-interaction]", error)));
process.on("SIGINT", () => void client.destroy());
process.on("SIGTERM", () => void client.destroy());
void client.login(botToken);
