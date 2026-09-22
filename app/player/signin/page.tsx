import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlayerSession } from "@/lib/auth/player-session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ playerAuthError?: string | string[]; returnTo?: string | string[] }>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const PLAYER_AUTH_ERRORS: Record<string, string> = {
  discord_state_invalid: "Your Discord sign-in request expired. Please try again.",
  discord_oauth_not_configured: "Discord sign-in is not configured yet.",
  player_session_not_configured: "Player sign-in is not configured yet.",
  discord_oauth_failed: "Discord sign-in could not be completed. Please try again.",
  discord_identity_failed: "Your Discord account details could not be loaded. Please try again.",
  player_account_failed: "Your player account could not be created. Please try again.",
};

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/player";
}

export default async function PlayerSignInPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const returnTo = safeReturnTo(first(query.returnTo) || "/player");
  const player = await getPlayerSession();
  if (player) redirect(returnTo);
  const error = first(query.playerAuthError);

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-12 text-zinc-950 sm:px-8">
      <div className="mx-auto max-w-md">
        <Link className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700" href="/">
          TFTourney
        </Link>
        <section className="mt-10 rounded-xl border border-zinc-200 bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Player access</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to play.</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-600">Use your Discord account to see available tournaments, sign up, and let the bot place you in the right lobby.</p>
          {error ? <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800" role="alert">{PLAYER_AUTH_ERRORS[error] ?? "Discord sign-in failed. Please try again."}</p> : null}
          <a className="mt-6 flex h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2" href={`/api/auth/discord/player?returnTo=${encodeURIComponent(returnTo)}`}>
            Sign in with Discord
          </a>
          <Link className="mt-4 block text-center text-sm font-semibold text-emerald-800 hover:text-emerald-950" href="/">Continue browsing tournaments</Link>
        </section>
      </div>
    </main>
  );
}