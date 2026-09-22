import Link from "next/link";
import { redirect } from "next/navigation";
import { signInPlayerAccountAction } from "@/app/player/actions";
import { PendingButton } from "@/components/ui/pending-button";
import { getPlayerSession } from "@/lib/auth/player-session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ playerAuthError?: string | string[]; returnTo?: string | string[] }>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const PLAYER_AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: "Incorrect username or password.",
  discord_state_invalid: "Your Discord sign-in request expired. Please try again.",
  discord_oauth_not_configured: "Discord sign-in is not configured yet.",
  player_session_not_configured:
    "Player sign-in is not configured: set PLAYER_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY.",
  discord_oauth_failed: "Discord sign-in could not be completed. Please try again.",
  discord_identity_failed: "Your Discord account details could not be loaded. Please try again.",
  player_account_failed: "Your player account could not be loaded. Please try again.",
  discord_link_requires_session: "Your session expired. Sign in, then link Discord again from your account page.",
};

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/player";
}

export default async function PlayerSignInPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const returnTo = safeReturnTo(first(query.returnTo) || "/player");
  const error = first(query.playerAuthError);
  const player = await getPlayerSession();
  // A signed-in player can still land here with an error -- e.g. the Discord
  // "link" flow fails here when the session expires mid-OAuth-round-trip,
  // and by the time the browser gets back here the (new) session is valid
  // again. Auto-redirecting away in that case silently threw the error away
  // and bounced the player back to returnTo with no indication anything went
  // wrong. Only skip the sign-in page when there is nothing to show.
  if (player && !error) redirect(returnTo);

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-12 text-zinc-950 sm:px-8">
      <div className="mx-auto max-w-md">
        <Link className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700" href="/">
          TFTourney
        </Link>
        <section className="mt-10 rounded-xl border border-zinc-200 bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Player access</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to play.</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-600">Sign in with your username and password to see available tournaments, sign up, and manage your account.</p>
          {error ? <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800" role="alert">{PLAYER_AUTH_ERRORS[error] ?? "Sign-in failed. Please try again."}</p> : null}
          <form action={signInPlayerAccountAction} className="mt-6 flex flex-col gap-4">
            <input name="returnTo" type="hidden" value={returnTo} />
            <label className="block text-sm font-medium text-zinc-700" htmlFor="username">
              Username
              <input autoComplete="username" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="username" name="username" required type="text" />
            </label>
            <label className="block text-sm font-medium text-zinc-700" htmlFor="password">
              Password
              <input autoComplete="current-password" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="password" name="password" required type="password" />
            </label>
            <PendingButton className="mt-2 flex h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700" pendingLabel="Signing in…">
              Sign in
            </PendingButton>
          </form>
          <div className="mt-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200" />
            or
            <span className="h-px flex-1 bg-zinc-200" />
          </div>
          <a className="mt-6 flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50" href={`/api/auth/discord/player?returnTo=${encodeURIComponent(returnTo)}`}>
            Continue with Discord
          </a>
          <p className="mt-5 text-center text-sm text-zinc-600">
            New here?{" "}
            <Link className="font-semibold text-emerald-800 hover:text-emerald-950" href={`/player/signup?returnTo=${encodeURIComponent(returnTo)}`}>
              Create an account
            </Link>
          </p>
          <Link className="mt-4 block text-center text-sm font-semibold text-emerald-800 hover:text-emerald-950" href="/">Continue browsing tournaments</Link>
        </section>
      </div>
    </main>
  );
}
