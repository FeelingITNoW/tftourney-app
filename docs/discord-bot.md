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

From a tournament's page, the host clicks **"Add bot to your Discord server"** (`/api/auth/discord/bot-install?tournamentId=<id>`). This redirects to Discord's own bot-authorization screen with the `bot` scope and the exact permission set above already encoded (view/read channels, send messages, attach files, manage channels, manage roles, create private threads, send messages in threads, manage threads) — the host picks the target server and authorizes there. Discord adds the bot to that server and redirects back to `/api/auth/discord/bot-install/callback` with the chosen `guild_id`, which the app records against that tournament automatically. There's no server ID to copy by hand.

A manual "enter a server ID" fallback remains available (for a bot already installed via the Developer Portal's own OAuth2 URL Generator, or if `DISCORD_CLIENT_ID` isn't configured yet) but is no longer the primary path.

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

On the tournament page, the owner enters the Discord guild ID. The bot’s reconciliation loop creates or repairs:

- one category named `TFTourney • <name>`;
- `sign-up`, `check-in`, and `score-recording` text channels;
- a manager role scoped to the tournament; and
- persistent button panels for signup and check-in.

The score channel is visible but does not accept ordinary parent-channel messages. The bot creates private threads and adds the current lobby players. Managers can view and manage all private threads.

## Queue and score algorithm

Every accepted image attachment is copied to private storage before a queue row is created. Discord message ID is unique, so Gateway retries cannot duplicate a submission.

For each thread, the database locks the thread row, rejects submissions beyond three pending jobs, and applies a ten-second per-user/thread cooldown. Queued rows are ordered by Discord message timestamp and message ID. The claim function leases only the oldest job and refuses to run while another job in the same thread is processing or awaiting review.

The claim transaction reserves the earliest pending game for that round/lobby number. A `needs_review` submission holds that reservation; dismissing or accepting it is required before the next image can advance the game count. Accepted submissions increment `discord_lobby_threads.accepted_image_count` and record the actual app game number.

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

## Operational checks

```bash
npm run lint
npm test
npm run build
npm run bot:build
```

If the bot reconnects after downtime, it reconciles configured guilds, recreates missing resources, rebuilds the active thread map, and resumes unexpired screenshot leases. If the app is unavailable, Discord message intake fails closed and the facilitator alert explains that the screenshot should be resent after the app is healthy.
