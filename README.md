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

## Google Sheets publishing

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
deployed equivalent). The Google consent screen must allow the
`https://www.googleapis.com/auth/drive.file` scope.

The scheduled worker is exposed through the Supabase Edge Function at
`supabase/functions/sync-tournament-sheets`. Configure Supabase Cron to invoke
it every minute and set `TFTOURNEY_APP_URL` and `GOOGLE_SHEET_WORKER_SECRET` in
the function secrets. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the
app to the same Google OAuth client configured in Supabase Auth. A manual
Generate/Publish request starts its own export after the queue response, while
the scheduled worker handles retries and score changes made later. The worker calls the protected
`/api/internal/google-sheets/sync` route, claims dirty exports, and retries
transient Google failures.

Run the deterministic tests with:

```bash
npm test
```

With a test Google OAuth refresh token, run the opt-in end-to-end workbook
check (it trashes the temporary workbook unless `KEEP_LIVE_GOOGLE_SHEET=1`):

```bash
GOOGLE_LIVE_TEST_REFRESH_TOKEN=... npm run test:sheets:live
```
