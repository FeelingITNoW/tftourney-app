import Link from "next/link";
import { createHash } from "node:crypto";
import { getOrganizerSession } from "../../../../lib/auth/session";
import { supabaseRestRequest } from "../../../../lib/db/supabase-rest/api";

type Params = Promise<{ token: string }>;

export const dynamic = "force-dynamic";

export default async function ManagerInvitePage({ params }: { params: Params }) {
  const { token } = await params;
  const hash = createHash("sha256").update(token).digest("hex");
  const invites = await supabaseRestRequest<Array<{ id: string; tournament_id: string; expires_at: string }>>("tournament_manager_invites", {
    query: { select: "id,tournament_id,expires_at", token_hash: `eq.${hash}`, claimed_at: "is.null", revoked_at: "is.null", expires_at: `gt.${new Date().toISOString()}`, limit: "1" },
  }).catch(() => []);
  const invite = invites[0];
  const organizer = await getOrganizerSession();
  const valid = Boolean(invite);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <section className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-violet-700">TFTourney manager invite</p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950">Join tournament operations</h1>
        {!valid ? <p className="mt-4 text-sm text-red-700">This invite is expired, already claimed, revoked, or invalid.</p> : !organizer ? (
          <>
            <p className="mt-4 text-sm text-zinc-600">Sign in with your Google account first, then connect your Discord identity to claim the manager role.</p>
            <Link className="mt-6 flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white" href={`/signin?returnTo=${encodeURIComponent(`/discord/manager-invites/${token}`)}`}>Sign in to continue</Link>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-zinc-600">You are signed in as {organizer.email}. Discord will be used to verify your server identity and grant the tournament manager role.</p>
            <a className="mt-6 flex h-11 items-center justify-center rounded-md bg-violet-700 px-4 text-sm font-semibold text-white" href={`/api/auth/discord?invite=${encodeURIComponent(token)}`}>Connect Discord and claim invite</a>
          </>
        )}
      </section>
    </main>
  );
}
