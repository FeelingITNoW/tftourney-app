import Link from "next/link";
import { getOrganizerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ authError?: string | string[]; returnTo?: string | string[] }>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const AUTH_ERRORS: Record<string, string> = {
  google_oauth_failed: "Google sign-in could not be completed. Please try again.",
  google_user_failed: "Your Google account details could not be loaded. Please try again.",
  user_profile_failed: "Your organizer profile could not be connected to Google.",
};

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const returnTo = first(query.returnTo) || "/dashboard";
  const organizer = await getOrganizerSession();
  if (organizer) redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard");
  const error = first(query.authError);

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-12 text-zinc-950 sm:px-8">
      <div className="mx-auto max-w-md">
        <Link className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700" href="/">
          TFTourney
        </Link>
        <section className="mt-10 rounded-xl border border-zinc-200 bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Organizer access</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to manage your tournaments.</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-600">Use your Google account to create tournaments, manage results, and open your host dashboard.</p>
          {error ? <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800" role="alert">{AUTH_ERRORS[error] ?? "Google sign-in failed. Please try again."}</p> : null}
          <a className="mt-6 flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2" href={`/api/auth/google?intent=signin&returnTo=${encodeURIComponent(returnTo)}`}>
            Sign in with Google
          </a>
          <Link className="mt-4 block text-center text-sm font-semibold text-emerald-800 hover:text-emerald-950" href="/">Continue browsing tournaments</Link>
        </section>
      </div>
    </main>
  );
}
