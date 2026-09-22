import Link from "next/link";
import { checkInForTournamentAction, signUpForTournamentAction } from "@/app/player/actions";
import { PendingButton } from "@/components/ui/pending-button";
import { requirePlayer } from "@/lib/auth/player-session";
import { getPlayerAccountById } from "@/lib/db/players/api";
import { getPlayerDashboard } from "@/lib/db/players/dashboard";
import { discordAvatarUrl, discordDisplayName } from "@/lib/discord/avatar";

export const dynamic = "force-dynamic";

type PlayerSearchParams = Promise<{
  playerError?: string | string[];
  playerSignedUp?: string | string[];
  playerCheckedIn?: string | string[];
  playerAuth?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const STATUS_LABELS: Record<string, string> = {
  accepting_players: "Accepting players",
  in_progress: "In progress",
  completed: "Completed",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

type TournamentRow = {
  id: string;
  name: string;
  status: string;
  checkInStatus: string;
  registeredPlayerCount: number;
  maxPlayers: number;
  isRegistered: boolean;
  registrationStatus: string | null;
  checkedIn: boolean;
};

function signUpControl(tournament: TournamentRow, hasRiotId: boolean) {
  if (tournament.isRegistered) {
    if (tournament.checkInStatus === "open" && !tournament.checkedIn) {
      return (
        <form action={checkInForTournamentAction}>
          <input name="tournamentId" type="hidden" value={tournament.id} />
          <PendingButton className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700" pendingLabel="Checking in…">
            Check in
          </PendingButton>
        </form>
      );
    }
    if (tournament.checkedIn) return <span className="text-xs font-medium text-emerald-700">Checked in</span>;
    return <span className="text-xs font-medium text-emerald-700">Signed up</span>;
  }
  if (tournament.status !== "accepting_players") return <span className="text-xs text-zinc-500">Closed</span>;
  return (
    <form action={signUpForTournamentAction} className="flex flex-col items-end gap-2">
      <input name="tournamentId" type="hidden" value={tournament.id} />
      {!hasRiotId ? (
        <label className="block text-left text-xs font-medium text-zinc-600" htmlFor={`gameTag-${tournament.id}`}>
          Riot ID (GameName#TAG)
          <input className="mt-1 h-9 w-44 rounded-md border border-zinc-300 px-2 text-sm" id={`gameTag-${tournament.id}`} name="gameTag" placeholder="GameName#TAG" required type="text" />
        </label>
      ) : null}
      <PendingButton className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700" pendingLabel="Signing up…">
        Sign up
      </PendingButton>
    </form>
  );
}

function TournamentTable({ tournaments, hasRiotId, showSignUp }: { tournaments: TournamentRow[]; hasRiotId: boolean; showSignUp: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-600">
          <tr>
            <th className="px-4 py-3 font-medium">Tournament</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Players</th>
            <th className="px-4 py-3 font-medium">Your sign-up</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {tournaments.map((tournament) => (
            <tr key={tournament.id} className="align-top">
              <td className="px-4 py-3">
                <Link className="font-semibold text-emerald-800 hover:text-emerald-950" href={`/tournaments/${tournament.id}`}>
                  {tournament.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-700">{statusLabel(tournament.status)}</td>
              <td className="px-4 py-3 text-zinc-700">{tournament.registeredPlayerCount} / {tournament.maxPlayers}</td>
              <td className="px-4 py-3">
                {tournament.isRegistered ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-800">{tournament.registrationStatus ?? "registered"}</span>
                ) : (
                  <span className="text-zinc-500">Not signed up</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">{showSignUp ? signUpControl(tournament, hasRiotId) : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PlayerPage({ searchParams }: { searchParams: PlayerSearchParams }) {
  const query = await searchParams;
  const session = await requirePlayer("/player");
  const [account, dashboard] = await Promise.all([
    getPlayerAccountById(session.playerAccountId).catch(() => null),
    getPlayerDashboard(session.playerAccountId).catch(() => null),
  ]);
  const error = first(query.playerError);
  const signedUp = first(query.playerSignedUp);
  const checkedIn = first(query.playerCheckedIn);
  const tournaments = dashboard?.tournaments ?? [];
  const myTournaments = tournaments.filter((tournament) => tournament.isRegistered);
  const availableTournaments = tournaments.filter((tournament) => !tournament.isRegistered);
  const hasRiotId = Boolean(account?.riotGameTag);
  const hasDiscord = Boolean(account?.discordUserId);
  const avatarUrl = discordAvatarUrl(account?.discordUserId, account?.discordAvatar);
  const discordName = discordDisplayName(account?.discordUsername);
  const displayName = account?.username ?? (hasDiscord ? discordName : null) ?? account?.riotGameTag ?? "Player";

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-5">
          <div>
            <Link className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700 hover:text-emerald-900" href="/">
              TFTourney
            </Link>
            <p className="mt-1 text-sm text-zinc-500">Player home</p>
          </div>
          <div className="flex items-center gap-3">
            <Link className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 shadow-sm hover:border-zinc-300" href="/player/account" title="Manage your account">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Discord CDN avatar, dimensions are fixed
                <img alt={`${displayName} avatar`} className="h-9 w-9 rounded-full object-cover" height={36} src={avatarUrl} width={36} />
              ) : (
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="flex flex-col leading-tight">
                <span className="text-xs font-semibold text-zinc-900">{displayName}</span>
                <span className="text-[11px] font-medium text-zinc-500">Manage account</span>
              </span>
            </Link>
            <a className="text-sm font-semibold text-zinc-500 hover:text-zinc-900" href={`/api/auth/signout?returnTo=${encodeURIComponent("/")}`}>Sign out</a>
          </div>
        </header>

        <section className="py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Available tournaments</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Play TFT tournaments</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">
            Sign up with your linked Riot account. Linking Discord lets the bot place you into your lobby thread automatically.
          </p>
          <dl className="mt-5 flex flex-wrap gap-3 text-sm">
            <div className="border-l-4 border-indigo-600 bg-white px-4 py-3 shadow-sm">
              <dt className="text-zinc-500">Riot ID</dt>
              <dd className="mt-1 font-semibold text-zinc-950">{account?.riotGameTag ?? "Not linked yet"}</dd>
            </div>
            <div className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
              <dt className="text-zinc-500">Your tournaments</dt>
              <dd className="mt-1 font-semibold text-zinc-950">{myTournaments.length}</dd>
            </div>
          </dl>
          {!hasDiscord ? (
            <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900" role="status">
              Link Discord from <Link className="underline" href="/player/account">your account page</Link> so the bot can place you in a lobby thread and you can submit screenshots.
            </p>
          ) : null}
          {error ? <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{error}</p> : null}
          {signedUp ? <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">You are signed up.{hasDiscord ? " The bot will contact you on Discord about your lobby." : ""}</p> : null}
          {checkedIn ? <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">You are checked in.</p> : null}
        </section>

        <section aria-label="Your tournaments" className="border-t border-zinc-200 py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-zinc-950">Your tournaments</h2>
              <p className="mt-1 text-sm text-zinc-500">Tournaments you have signed up for.</p>
            </div>
          </div>
          <div className="mt-5">
            {myTournaments.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-500">
                You are not signed up for any tournaments yet. Join one below.
              </div>
            ) : (
              <TournamentTable tournaments={myTournaments} hasRiotId={hasRiotId} showSignUp />
            )}
          </div>
        </section>

        <section aria-label="Available tournaments" className="border-t border-zinc-200 py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-zinc-950">Available tournaments</h2>
              <p className="mt-1 text-sm text-zinc-500">Open tournaments you can still join.</p>
            </div>
          </div>
          <div className="mt-5">
            {availableTournaments.length === 0 ? (
              <div className="rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
                No tournaments are available to play right now.
              </div>
            ) : (
              <TournamentTable tournaments={availableTournaments} hasRiotId={hasRiotId} showSignUp />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
