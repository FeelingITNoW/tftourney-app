import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { getOrganizerSession } from "@/lib/auth/session";
import { getPlayerSession } from "@/lib/auth/player-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [organizer, player] = await Promise.all([
    getOrganizerSession(),
    getPlayerSession(),
  ]);

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <SiteHeader
        actions={
          <Link
            className="text-sm font-semibold text-zinc-500 hover:text-zinc-900"
            href="/tournaments"
          >
            Browse tournaments
          </Link>
        }
        mode="public"
        showNav={false}
        subtitle="Tournament operations for Teamfight Tactics"
      />

      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <section className="py-12 text-center lg:py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
            Welcome to TFTourney
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-normal text-zinc-950 sm:text-5xl">
            Run and play Teamfight Tactics tournaments, end to end.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg">
            Are you here to compete, or to run the event? Pick a side below —
            each has its own home, its own sign-in, and its own workflow.
          </p>
        </section>

        <section className="grid gap-6 pb-16 sm:grid-cols-2">
          <div className="flex flex-col rounded-xl border border-indigo-200 bg-white p-7 shadow-sm">
            <span className="w-fit rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
              Compete
            </span>
            <h2 className="mt-4 text-2xl font-semibold text-zinc-950">I&apos;m a player</h2>
            <p className="mt-3 flex-1 text-sm leading-6 text-zinc-600">
              Sign up for open tournaments with your Riot ID, check in when
              the host opens it, get placed into your lobby thread on
              Discord, and submit result screenshots.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {player ? (
                <Link
                  className="flex h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  href="/player"
                >
                  Go to player home
                </Link>
              ) : (
                <>
                  <Link
                    className="flex h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
                    href="/player/signin"
                  >
                    Sign in to play
                  </Link>
                  <Link
                    className="flex h-11 items-center justify-center rounded-md border border-indigo-200 px-4 text-sm font-semibold text-indigo-800 transition hover:bg-indigo-50"
                    href="/player/signup"
                  >
                    Create a player account
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col rounded-xl border border-emerald-200 bg-white p-7 shadow-sm">
            <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              Organize
            </span>
            <h2 className="mt-4 text-2xl font-semibold text-zinc-950">I&apos;m a host</h2>
            <p className="mt-3 flex-1 text-sm leading-6 text-zinc-600">
              Create a bracket, generate lobbies, review OCR-assisted
              screenshot results, publish live standings to Google Sheets,
              and run it all through the Discord bot.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {organizer ? (
                <Link
                  className="flex h-11 items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  href="/dashboard"
                >
                  Open dashboard
                </Link>
              ) : (
                <a
                  className="flex h-11 items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  href="/api/auth/google?intent=signin&returnTo=%2Fdashboard"
                >
                  Sign in with Google
                </a>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
