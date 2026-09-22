import Link from "next/link";
import {
  changeEmailAction,
  changePasswordAction,
  claimPlayerCredentialsAction,
  linkRiotAccountAction,
  unlinkDiscordAccountAction,
} from "@/app/player/account/actions";
import { PendingButton } from "@/components/ui/pending-button";
import { requirePlayer } from "@/lib/auth/player-session";
import { getPlayerAccountById } from "@/lib/db/players/api";
import { discordAvatarUrl, discordDisplayName } from "@/lib/discord/avatar";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ accountUpdated?: string | string[]; accountError?: string | string[] }>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const UPDATE_MESSAGES: Record<string, string> = {
  credentials: "Your account now has a username and password.",
  password: "Your password was changed.",
  email: "Your email was updated.",
  riot: "Your Riot account is linked.",
  discord: "Discord is linked to your account.",
  "discord-unlinked": "Discord was unlinked from your account.",
};

export default async function PlayerAccountPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const session = await requirePlayer("/player/account");
  const account = await getPlayerAccountById(session.playerAccountId);
  if (!account) {
    return (
      <main className="min-h-screen bg-stone-50 px-6 py-12 text-zinc-950 sm:px-8">
        <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-medium text-red-800">
          Your account could not be loaded.
        </div>
      </main>
    );
  }

  const updated = first(query.accountUpdated);
  const error = first(query.accountError);
  const hasCredentials = Boolean(account.username);
  const hasDiscord = Boolean(account.discordUserId);
  const avatarUrl = discordAvatarUrl(account.discordUserId, account.discordAvatar);
  const discordName = discordDisplayName(account.discordUsername);

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-6 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-5">
          <div>
            <Link className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700 hover:text-emerald-900" href="/player">
              ← Player home
            </Link>
            <p className="mt-1 text-2xl font-semibold tracking-tight">Your account</p>
          </div>
          <a className="text-sm font-semibold text-zinc-500 hover:text-zinc-900" href={`/api/auth/signout?returnTo=${encodeURIComponent("/")}`}>Sign out</a>
        </header>

        {error ? <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{error}</p> : null}
        {updated ? <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900" role="status">{UPDATE_MESSAGES[updated] ?? "Your account was updated."}</p> : null}

        {!hasCredentials ? (
          <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-semibold text-amber-900">Set a username and password</h2>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              This account was created from Discord and has no username or password yet. Set them so you can sign in without Discord.
            </p>
            <form action={claimPlayerCredentialsAction} className="mt-4 flex flex-col gap-3">
              <label className="block text-sm font-medium text-zinc-700" htmlFor="claim-username">
                Username
                <input autoComplete="username" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="claim-username" maxLength={20} minLength={3} name="username" required type="text" />
              </label>
              <label className="block text-sm font-medium text-zinc-700" htmlFor="claim-password">
                Password
                <input autoComplete="new-password" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="claim-password" minLength={8} name="password" required type="password" />
              </label>
              <label className="block text-sm font-medium text-zinc-700" htmlFor="claim-confirmPassword">
                Confirm password
                <input autoComplete="new-password" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="claim-confirmPassword" minLength={8} name="confirmPassword" required type="password" />
              </label>
              <label className="block text-sm font-medium text-zinc-700" htmlFor="claim-email">
                Email (optional)
                <input autoComplete="email" className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm" id="claim-email" name="email" type="email" />
              </label>
              <PendingButton className="mt-1 h-11 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700" pendingLabel="Saving…">
                Set username and password
              </PendingButton>
            </form>
          </section>
        ) : (
          <>
            <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-950">Profile</h2>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-zinc-500">Username</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">{account.username}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Email</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">{account.email ?? "Not set"}</dd>
                </div>
              </dl>
              <form action={changeEmailAction} className="mt-4 flex flex-wrap items-end gap-3">
                <label className="block text-sm font-medium text-zinc-700" htmlFor="email">
                  Update email
                  <input autoComplete="email" className="mt-1 h-10 w-64 rounded-md border border-zinc-300 px-3 text-sm" defaultValue={account.email ?? ""} id="email" name="email" type="email" />
                </label>
                <PendingButton className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" pendingLabel="Saving…">
                  Save
                </PendingButton>
              </form>
            </section>

            <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-950">Change password</h2>
              <form action={changePasswordAction} className="mt-4 flex flex-col gap-3">
                <label className="block text-sm font-medium text-zinc-700" htmlFor="currentPassword">
                  Current password
                  <input autoComplete="current-password" className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm" id="currentPassword" name="currentPassword" required type="password" />
                </label>
                <label className="block text-sm font-medium text-zinc-700" htmlFor="newPassword">
                  New password
                  <input autoComplete="new-password" className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm" id="newPassword" minLength={8} name="newPassword" required type="password" />
                </label>
                <label className="block text-sm font-medium text-zinc-700" htmlFor="confirmNewPassword">
                  Confirm new password
                  <input autoComplete="new-password" className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm" id="confirmNewPassword" minLength={8} name="confirmNewPassword" required type="password" />
                </label>
                <PendingButton className="mt-1 h-10 self-start rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" pendingLabel="Saving…">
                  Change password
                </PendingButton>
              </form>
            </section>
          </>
        )}

        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Riot account</h2>
          <p className="mt-1 text-sm text-zinc-500">Used to verify you when you sign up for a tournament.</p>
          <p className="mt-3 text-sm">
            <span className="font-semibold text-zinc-950">{account.riotGameTag ?? "Not linked yet"}</span>
          </p>
          <form action={linkRiotAccountAction} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block text-sm font-medium text-zinc-700" htmlFor="gameTag">
              {account.riotGameTag ? "Change Riot ID" : "Link Riot ID"}
              <input className="mt-1 h-10 w-56 rounded-md border border-zinc-300 px-3 text-sm" id="gameTag" name="gameTag" placeholder="GameName#TAG" required type="text" />
            </label>
            <PendingButton className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" pendingLabel="Linking…">
              {account.riotGameTag ? "Update" : "Link"}
            </PendingButton>
          </form>
        </section>

        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Discord</h2>
          <p className="mt-1 text-sm text-zinc-500">Lets the bot place you in a lobby thread and message you during a tournament.</p>
          {hasDiscord ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external Discord CDN avatar, dimensions are fixed
                  <img alt={`${discordName} Discord avatar`} className="h-10 w-10 rounded-full object-cover" height={40} src={avatarUrl} width={40} />
                ) : (
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                    {discordName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="text-sm font-semibold text-zinc-950">{discordName}</span>
              </div>
              <form action={unlinkDiscordAccountAction}>
                <PendingButton className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" pendingLabel="Unlinking…">
                  Unlink Discord
                </PendingButton>
              </form>
            </div>
          ) : (
            <a className="mt-4 flex h-10 w-fit items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50" href={`/api/auth/discord/player?mode=link&returnTo=${encodeURIComponent("/player/account")}`}>
              Link Discord
            </a>
          )}
        </section>
      </div>
    </main>
  );
}
