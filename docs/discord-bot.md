# Discord tournament bot

The Discord integration is split into two processes:

1. Next.js owns authentication, Riot verification, Supabase transactions, OCR, and the protected bot HTTP API.
2. `bot/index.ts` owns the Discord Gateway connection, channel/thread provisioning, Discord interactions, screenshot intake, and the OCR worker loop.

Ngrok exposes the Next.js process at `https://deploy-tapping-unwed.ngrok-free.dev`. The Gateway connection is outbound and does not require a public bot webhook; the public URL is required for Google/Discord OAuth callbacks and links sent to facilitators. Ngrok forwards the URL to the local Next.js port with:

```bash
ngrok http 3000 --url https://deploy-tapping-unwed.ngrok-free.dev
```

## Discord application setup

Create a Discord application and bot, then enable these Gateway intents:

- `GUILDS`
- `GUILD_MESSAGES`
- privileged `MESSAGE_CONTENT` (required for attachment fields in message events)

Configure these OAuth callback URLs:

```text
https://deploy-tapping-unwed.ngrok-free.dev/api/auth/discord/callback
https://deploy-tapping-unwed.ngrok-free.dev/api/auth/discord/bot-install/callback
```

The manager claim flow requests `identify guilds.join`. The claimant must first sign in to TFTourney with Google, then open the one-time manager link. The bot adds the Discord member and assigns the tournament-specific role before activating the app manager record.

### Adding the bot to a tournament's server

The primary path is manual: the host invites the bot to their server themselves (via a standard Discord bot invite link, or the Developer Portal's OAuth2 URL Generator with the `bot applications.commands` scopes and the permission set above), then pastes that server's ID into the "Discord server ID" field on the tournament page (`connectDiscordAction`). This upserts `tournament_discord_configs {tournament_id, guild_id, state: "pending"}` immediately and synchronously — the bot picks it up on its next reconcile tick (≤10s later).

A one-click alternative remains available under "Or use one-click authorize instead": **"Connect a Discord server"** (`/api/auth/discord/bot-install?tournamentId=<id>`) redirects to Discord's own bot-authorization screen with the same scopes and permissions pre-filled — the host picks the target server and authorizes there, and Discord adds the bot and redirects back to `/api/auth/discord/bot-install/callback` with the chosen `guild_id`, which the app records the same way. This is one fewer step (no ID to copy), but its completion depends on a full round trip (session check, database write) finishing after Discord has already added the bot and fired its join event — slower or less reliable environments (a local dev server behind a tunnel, a cold database connection) can visibly lag behind the manual form, which writes the row directly from the tournament page with no such race. The manual form is presented first for that reason; both paths write to the same `tournament_discord_configs` row and are equivalent once connected.

The `applications.commands` scope is required for the bot's slash commands (see [Slash commands](#slash-commands)) to appear in the server. A server authorized (or invited) before this scope was added will not show the commands until the host re-invites the bot with both scopes.

Put the bot's role above the manager roles it creates in the target server (Server Settings → Roles) after installation.

## Environment

Copy `.env.example` to `.env.local` and set the existing Supabase, Riot, OCR, and Google values plus:

```text
TFTOURNEY_APP_URL=https://deploy-tapping-unwed.ngrok-free.dev
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_BOT_API_SECRET=
DISCORD_OAUTH_STATE_SECRET=
```

Run the app and worker in separate supervised processes:

```bash
npm run dev
npm run bot:dev
```

For a production build:

```bash
npm run build
npm run bot:build
npm start
npm run bot:start
```

Apply the Discord migration before connecting a tournament (`supabase db push`) and create a private Supabase Storage bucket named `discord-score-images`. Limit it to PNG/JPEG/WebP and 7 MB. The bucket is private; the worker accesses images through the protected app route. The bot runs retention cleanup hourly and deletes image objects and submission rows seven days after a tournament ends.

## Provisioning and permissions

Once a tournament is connected (via "Connect a Discord server" or the manual server-ID fallback -- see "Adding the bot to a tournament's server" above), the bot's reconciliation loop creates or repairs:

- one category named `TFTourney • <name>`;
- `sign-up`, `check-in`, and `score-recording` text channels;
- a manager role scoped to the tournament; and
- persistent button panels for signup and check-in.

The score channel is visible but does not accept ordinary parent-channel messages. The bot creates private threads and adds the current lobby players. Managers can view and manage all private threads.

The loop only reconciles tournaments that still have work: a `completed` or `cancelled` tournament is dropped from the poll once it has no open lobby thread left, so finished events stop costing Discord API calls and database work. That last condition matters — the reconcile tick is the only thing that archives a lobby thread and the only thing that disables the sign-up button, so a tournament that ends while the bot is offline still gets one final tick to finish that before it is skipped for good.

### On joining and leaving a server

When the bot joins a guild, it reconciles immediately (rather than waiting for the next 10-second tick) so a tournament connected via "Connect a Discord server" gets its category and channels right away. If the guild doesn't match any connected tournament after a short grace period (the OAuth callback that records the guild ID can still be in flight), the bot treats it as a manual/standalone install: it checks its own permissions and posts a short message in the first channel it can reach, naming any missing permissions and giving the host the server ID to paste into the "Enter a server ID by hand" form.

Before provisioning a guild, the bot checks that it actually holds the full permission set requested at install time (view channels, send messages, manage channels, manage roles, manage threads, create private threads, send messages in threads, attach files) -- since Discord lets the authorizing user uncheck any of these on its own consent screen. A shortfall is written to `tournament_discord_configs.state = "error"` with a specific `last_error` naming what's missing, surfaced on the tournament page, instead of failing opaquely on whichever Discord API call hits the missing permission first.

If the bot is removed from a server, every tournament connected to that guild is marked `state = "error"` with `last_error` explaining the bot was removed, so the host sees it on the tournament page rather than the integration silently going stale.

## Check-in

Discord check-in is optional and never blocks starting a tournament:

- **Never opened** (`tournaments.check_in_status = "not_started"`, the default) -- every registered player enters when the host presses Start, exactly as without Discord.
- **Open** -- players confirm attendance with the Discord check-in button (or the host checks them in manually from the Registered players table on the tournament page, for players who registered on the website without a Discord account). Pressing Start while check-in is still open closes it and starts in one click ("Close check-in & start (N checked in)"); only checked-in registered players enter.
- **Closed** -- same as open, but check-in is final. The host can reopen it (preserving existing check-ins) from the tournament page.

The Discord check-in button reflects the host's Open/Close action within about 10 seconds (the bot's poll interval), and its panel text names the current status in plain language. A failed start attempt restores any players it waitlisted so they aren't left stranded.

## Disconnecting

The tournament page offers two disconnect buttons, **"Archive & disconnect"** and **"Delete & disconnect"** (`disconnectDiscordAction`). Both immediately soft-disable the connection (`tournament_discord_configs.state = "disabled"`) rather than deleting the row: check-in returns to `not_started`, player check-ins are cleared, and the bot's reconciliation loop stops touching that tournament on its next poll. The internal check-in and sign-up endpoints (`/api/internal/discord/check-in`, `/api/internal/discord/signup`) refuse requests for a disconnected tournament, so an orphaned Discord panel button can't keep registering or checking in players after disconnect.

What happens to the provisioned category, channels, and manager role depends on which button was used, recorded as `cleanup_action` (`"archive"` or `"delete"`) and picked up by the bot's separate `runCleanup()` poll of `/api/internal/discord/cleanup` (disabled tournaments are excluded from the normal `/reconcile` payload, so this is a dedicated channel for the one thing they still need):

- **Archive** locks every provisioned channel (denies the manager role's send/thread permissions -- `@everyone` already has no send access from provisioning), locks and Discord-archives any open per-lobby result threads under score-recording, and renames the channels and category with an `archived-`/`Archived • ` prefix. Nothing is deleted; the config row's channel/role IDs stay valid, so reconnecting later reuses them exactly as before.
- **Delete** permanently removes the category, all three channels (and their threads with them), and the manager role from the server, then clears the now-invalid IDs from the config row so a future reconnect provisions clean ones instead of repeatedly failing to fetch deleted resources.

Either way, `cleanup_completed_at` is stamped once the bot finishes, and the tournament page polls briefly (via the same live-refresh used elsewhere) to reflect that. Reconnecting a tournament (manual or one-click) always resets `cleanup_action`/`cleanup_requested_at`/`cleanup_completed_at` to null.

## Queue and score algorithm

Every accepted image attachment is copied to private storage before a queue row is created. Discord message ID is unique, so Gateway retries cannot duplicate a submission.

For each thread, the database locks the thread row, rejects submissions beyond three pending jobs, and applies a ten-second per-user/thread upload cooldown. Queued rows are ordered by Discord message timestamp and message ID. The claim function leases only the oldest job and refuses to run while another job in the same thread is processing or awaiting review.

The claim transaction reserves the earliest pending game for that round/lobby number. A `needs_review` submission holds that reservation; dismissing or accepting it is required before the next image can advance the game count. Accepted submissions increment `discord_lobby_threads.accepted_image_count` and record the actual app game number.

**Per-lobby score cooldown.** Independent of the ten-second upload cooldown above, each tournament has a `tournament_discord_configs.score_cooldown_seconds` setting (default `60`, `0` disables it, max `3600`) that blocks new screenshots for a lobby *thread* for that many seconds after one of its games is accepted — so a stray duplicate screenshot can't silently overwrite the next pending game. It is enforced twice: at enqueue time (a screenshot posted while the cooldown is active is rejected immediately) and at claim time (a screenshot that was already queued before the cooldown started, but reaches the front of the queue after another screenshot in the same thread was accepted, is rejected instead of claimed). Either way the submission is marked `rejected_cooldown`, the sender gets a reply naming the remaining wait, and — unlike overflow or an OCR failure — the tournament manager role is **not** pinged, since this is a routine, expected rejection. Recording a game via the web lobby editor (with no Discord submission attached) does not start or check the cooldown; only a Discord-sourced accept does.

The worker downloads the stored image, posts it to `/api/ocr/placements` with the authoritative lobby roster, and accepts only a complete result where every placement maps uniquely to a current participant. It then calls the score endpoint with `Idempotency-Key: <submission id>`. PostgreSQL locks the tournament, round, and lobby, sets a five-second lock timeout, validates the full roster/unique placements, derives format points, recalculates round totals, and records the idempotency response in the same transaction.

The score endpoint is also available to an authenticated host/manager for manual correction:

```http
POST /api/tournaments/<tournament-id>/lobbies/<lobby-id>/results
Authorization: Bearer <DISCORD_BOT_API_SECRET>
Idempotency-Key: <unique-key>
Content-Type: application/json

{"mode":"record","results":[{"participantId":"<participant-id>","placement":1}]}
```

Use `mode: "correct"` for a facilitator correction. The endpoint returns `201` for a new write, `200` for an idempotent replay, `409` for a race/state conflict, and `422` for invalid placements.

Transient image/OCR failures are retried when the two-minute lease expires, up to three attempts. After the third failed attempt the submission is held in `needs_review`. Invalid OCR, a score race, or queue overflow pings the tournament manager role and includes the Discord thread and app lobby URL. Facilitators use the linked lobby editor to submit corrected placements; a correction automatically resolves the oldest review item for that lobby and unblocks the next queued screenshot.

The bot replies directly to the Discord message that produced a result — the accepted `✅ Game N has been recorded.` notice as well as a cooldown or upload-cooldown rejection — instead of posting a plain message in the thread, so a facilitator scrolling a busy thread can tell which screenshot each notice is about.

## Slash commands

The bot registers one global application command on startup, `client.application.commands.set([...])` — this can take a few minutes to propagate to every server the first time, and Discord clients occasionally need a restart to show a newly registered command.

- **`/lobby-cooldown show`** — replies (ephemerally) with the running tournament's current per-lobby score cooldown.
- **`/lobby-cooldown set seconds:<0-3600>`** — updates it; `0` disables the cooldown. Posts a public confirmation.

Anyone with the server's **Manage Server** permission, or the tournament's manager role, may run `set`; anyone else gets an ephemeral refusal. The command works in any of the tournament's channels or threads — the bot resolves which connected tournament it applies to from the Discord category the command was run under (or, in a server connected to only one tournament, that tournament by default). Run it inside a tournament-owned channel or thread if a server has more than one connected tournament.

## Operational checks

```bash
npm run lint
npm test
npm run build
npm run bot:build
supabase db push
```

(`20260915000000_discord_connect_ux.sql` should be applied alongside the Part 1 cooldown migration.)

If the bot reconnects after downtime, it reconciles configured guilds, recreates missing resources, rebuilds the active thread map, and resumes unexpired screenshot leases. If the app is unavailable, Discord message intake fails closed and the facilitator alert explains that the screenshot should be resent after the app is healthy.
