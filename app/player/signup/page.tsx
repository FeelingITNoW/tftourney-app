import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signUpPlayerAccountAction } from "@/app/player/actions";
import { SiteHeader } from "@/components/layout/site-header";
import { PendingButton } from "@/components/ui/pending-button";
import { getPlayerSession } from "@/lib/auth/player-session";
import {
  PLAYER_PENDING_DISCORD_COOKIE,
  readPendingPlayerDiscordToken,
} from "@/lib/auth/player-discord-oauth";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  returnTo?: string | string[];
  usernameError?: string | string[];
  passwordError?: string | string[];
  confirmPasswordError?: string | string[];
  emailError?: string | string[];
  formError?: string | string[];
  playerAuth?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/player";
}

export default async function PlayerSignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const returnTo = safeReturnTo(first(query.returnTo) || "/player");
  const player = await getPlayerSession();
  if (player) redirect(returnTo);

  const pendingToken = (await cookies()).get(PLAYER_PENDING_DISCORD_COOKIE)?.value;
  const pendingDiscord = readPendingPlayerDiscordToken(pendingToken);

  const usernameError = first(query.usernameError);
  const passwordError = first(query.passwordError);
  const confirmPasswordError = first(query.confirmPasswordError);
  const emailError = first(query.emailError);
  const formError = first(query.formError);

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <SiteHeader maxWidthClassName="max-w-md" mode="player" showNav={false} subtitle="Create a player account" />
      <div className="px-6 pb-12 pt-10 sm:px-8">
        <div className="mx-auto max-w-md">
        <section className="rounded-xl border border-zinc-200 bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Player access</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Create your account.</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-600">
            A username and password is all you need to register for tournaments. You can link a Riot account and Discord afterward.
          </p>
          {pendingDiscord ? (
            <p className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm font-medium text-indigo-900" role="status">
              Signing up as {pendingDiscord.discordUsername ?? "your Discord account"} — this will link Discord to your new account.
            </p>
          ) : null}
          {formError ? <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800" role="alert">{formError}</p> : null}
          <form action={signUpPlayerAccountAction} className="mt-6 flex flex-col gap-4">
            <input name="returnTo" type="hidden" value={returnTo} />
            <label className="block text-sm font-medium text-zinc-700" htmlFor="username">
              Username
              <input autoComplete="username" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="username" maxLength={20} minLength={3} name="username" required type="text" />
              {usernameError ? <span className="mt-1 block text-xs font-medium text-red-700">{usernameError}</span> : null}
            </label>
            <label className="block text-sm font-medium text-zinc-700" htmlFor="password">
              Password
              <input autoComplete="new-password" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="password" minLength={8} name="password" required type="password" />
              {passwordError ? <span className="mt-1 block text-xs font-medium text-red-700">{passwordError}</span> : null}
            </label>
            <label className="block text-sm font-medium text-zinc-700" htmlFor="confirmPassword">
              Confirm password
              <input autoComplete="new-password" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="confirmPassword" minLength={8} name="confirmPassword" required type="password" />
              {confirmPasswordError ? <span className="mt-1 block text-xs font-medium text-red-700">{confirmPasswordError}</span> : null}
            </label>
            <label className="block text-sm font-medium text-zinc-700" htmlFor="email">
              Email (optional)
              <input autoComplete="email" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="email" name="email" type="email" />
              {emailError ? <span className="mt-1 block text-xs font-medium text-red-700">{emailError}</span> : null}
            </label>
            <PendingButton className="mt-2 flex h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700" pendingLabel="Creating account…">
              Create account
            </PendingButton>
          </form>
          <p className="mt-5 text-center text-sm text-zinc-600">
            Already have an account?{" "}
            <Link className="font-semibold text-emerald-800 hover:text-emerald-950" href={`/player/signin?returnTo=${encodeURIComponent(returnTo)}`}>
              Sign in
            </Link>
          </p>
        </section>
        </div>
      </div>
    </main>
  );
}
