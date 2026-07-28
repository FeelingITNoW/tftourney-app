import Link from "next/link";
import { getOrganizerSession } from "@/lib/auth/session";

type Props = {
  returnTo?: string;
};

export async function AccountHeader({ returnTo = "/dashboard" }: Props) {
  const organizer = await getOrganizerSession();
  if (organizer?.isLocal) {
    return <div className="flex items-center gap-3"><span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Local organizer mode</span><a className="text-sm font-semibold text-emerald-800 hover:text-emerald-950" href={`/api/auth/google?intent=signin&returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Google</a></div>;
  }
  if (organizer) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-sm text-zinc-600">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />
          <span><span className="sm:hidden">Signed in</span><span className="hidden sm:inline">Signed in as {organizer.email}</span></span>
        </span>
        <Link className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50" href="/dashboard">Dashboard</Link>
        <a className="text-sm font-semibold text-zinc-500 hover:text-zinc-900" href={`/api/auth/signout?returnTo=${encodeURIComponent("/")}`}>Sign out</a>
      </div>
    );
  }
  return (
    <a className="rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2" href={`/api/auth/google?intent=signin&returnTo=${encodeURIComponent(returnTo)}`}>
      Sign in with Google
    </a>
  );
}
