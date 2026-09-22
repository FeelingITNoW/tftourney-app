This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Create a local environment file before starting the app:

```bash
cp .env.example .env.local
```

Set `NEXT_PUBLIC_SUPABASE_URL` to your Supabase REST URL and
`SUPABASE_SERVICE_ROLE_KEY` to the project service-role key. This workspace is
linked to project `pwhtssicqwaolxgpfoxw`, so the hosted URL is:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://pwhtssicqwaolxgpfoxw.supabase.co
```

If you are using the Supabase CLI, log in and fetch keys with:

```bash
supabase login
supabase projects api-keys --project-ref pwhtssicqwaolxgpfoxw -o env
```

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Organizer sign-in and Google Sheets publishing

Organizers sign in with Google from the shared account control and manage their
own tournaments from `/dashboard`. Ordinary sign-in requests identity access
only. The Google Sheets panel requests separate Drive consent when a host first
chooses to connect Google Drive. Apply all Supabase migrations, including the
latest organizer ownership migration, before enabling deployed sign-in.

The tournament page can queue a public Google Sheets workbook with `Players`,
`Scores`, and `Checkmate` tabs. Apply the Google Sheets export migration, then
configure a Google OAuth client with Drive file access and set the Google
variables in `.env.local`. The current app keeps the existing single host ID for
compatibility; `organizer_google_connections` is ready for encrypted organizer
refresh tokens, while `GOOGLE_REFRESH_TOKEN` is available only as a local
development fallback. Keep `TFT_REQUIRE_AUTH=true` in deployed environments;
setting it to `false` only enables the existing local host-1 compatibility path.
The Supabase callback must return a Google provider refresh token so the worker
can refresh Google access without persisting the Supabase session token.

If sign-in reports `Unsupported provider: provider is not enabled`, enable
Google in Supabase Dashboard → Authentication → Sign In / Providers → Google.
Use the same Google Web OAuth client ID and secret in Supabase and in the app's
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` variables. In Google Cloud, enable
the Google Drive API and add the Supabase Auth callback as an authorized redirect
URI:

```text
https://pwhtssicqwaolxgpfoxw.supabase.co/auth/v1/callback
```

In Supabase Dashboard → Authentication → URL Configuration, allow the app
callback URLs (`http://localhost:3000/api/auth/google/callback` locally and the
deployed equivalent, for example
`https://tftourney-app-production.up.railway.app/api/auth/google/callback`). The
Google consent screen must allow the `https://www.googleapis.com/auth/drive.file`
scope.

The absolute redirect URIs are derived from `TFTOURNEY_APP_URL` (see
`lib/app-url.ts`), so that variable must be set to the deployed origin in
production — otherwise OAuth redirects fall back to the request host, which
resolves to `localhost` behind a reverse proxy such as Railway. Set:

```text
TFTOURNEY_APP_URL=https://tftourney-app-production.up.railway.app
```

A bare host with no `https://` (some platforms, including Railway, generate a
domain variable without a scheme) is accepted too — `lib/app-url.ts` adds the
scheme automatically — but set the full origin to avoid relying on that.

### Deploying on Railway

Google and Discord sign-in both depend on the app knowing its own public
origin, which `next start` cannot reliably read from the incoming request
behind Railway's proxy. Checklist for a working deployment:

- Railway service variables: `TFTOURNEY_APP_URL` (the Railway public domain,
  with `https://`), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `TFT_REQUIRE_AUTH=true`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
  `DISCORD_BOT_TOKEN`, and for Sheets publishing `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`. Recommended:
  `PLAYER_SESSION_SECRET` (generate with `openssl rand -base64 32`) — without
  it, player Discord sign-in still works by deriving a signing key from
  `SUPABASE_SERVICE_ROLE_KEY`, but an explicit secret means player sessions
  survive a service-role-key rotation.
- Supabase Dashboard → Authentication → URL Configuration → add
  `https://<railway-domain>/api/auth/google/callback` to the redirect
  allow list (the Google Cloud OAuth client itself only needs the Supabase
  callback shown above).
- Discord Developer Portal → OAuth2 → Redirects → add the three URIs in
  [Discord tournament operations](#discord-tournament-operations) below for
  the Railway domain.
- Apply all Supabase migrations, including
  `20260921000003_fix_player_account_function_ambiguity.sql` — without it,
  player Discord sign-in fails with `player_account_failed` — and
  `20260922000000`–`20260922000002`, which add player username/password
  accounts, optional Discord/Riot linking, and account-keyed web check-in.

The scheduled worker is exposed through the Supabase Edge Function at
`supabase/functions/sync-tournament-sheets`. Configure Supabase Cron to invoke
it every minute and set `TFTOURNEY_APP_URL` and `GOOGLE_SHEET_WORKER_SECRET` in
the function secrets. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the
app to the same Google OAuth client configured in Supabase Auth. A manual
Generate/Publish request and each organizer tournament mutation wake a targeted
export after the response, while the scheduled worker handles retries and
out-of-band changes made later. The worker calls the protected
`/api/internal/google-sheets/sync` route, claims dirty exports, processes
different tournaments concurrently, and retries transient Google failures.
Set `GOOGLE_SHEET_WORKER_CONCURRENCY` in the app to tune the per-invocation
worker count (defaults to 4 and is bounded to 1–10).

For the complete synchronization flow, performance rationale, tuning guidance,
and troubleshooting states, see [docs/google-sheets-sync.md](docs/google-sheets-sync.md).

Run the deterministic tests with:

```bash
npm test
```

With a test Google OAuth refresh token, run the opt-in end-to-end workbook
check (it trashes the temporary workbook unless `KEEP_LIVE_GOOGLE_SHEET=1`):

```bash
GOOGLE_LIVE_TEST_REFRESH_TOKEN=... npm run test:sheets:live
```

## Discord tournament operations

The optional Discord Gateway worker provides Riot-verified signup, tournament
check-in, private lobby score threads, durable screenshot queues, OCR review,
and idempotent score submission. Configure the Discord variables in
`.env.local`, apply the latest Supabase migration, then follow
[docs/discord-bot.md](docs/discord-bot.md) for Discord Developer Portal,
ngrok, storage, and deployment setup. In the Discord Developer Portal, add both
the local and deployed redirect URIs under OAuth2 → Redirects:

```text
http://localhost:3000/api/auth/discord/callback
http://localhost:3000/api/auth/discord/player/callback
http://localhost:3000/api/auth/discord/bot-install/callback
https://tftourney-app-production.up.railway.app/api/auth/discord/callback
https://tftourney-app-production.up.railway.app/api/auth/discord/player/callback
https://tftourney-app-production.up.railway.app/api/auth/discord/bot-install/callback
```

Players create their own account with a username and password at
`/player/signup`; Riot and Discord are optional links managed from
`/player/account` afterward. "Continue with Discord" on `/player/signin` uses
its own callback route (`/api/auth/discord/player/callback`), separate from
the organizer manager-invite callback (`/api/auth/discord/callback`), so the
two flows never share a redirect URI or a cookie. It signs in an account that
already has that Discord identity linked (including one the bot created);
otherwise it sends the player to `/player/signup` with the Discord identity
attached so they finish creating an account instead of one being silently
auto-created.

Run the worker locally with:

```bash
npm run bot:dev
```
