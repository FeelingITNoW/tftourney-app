import Link from "next/link";

type PlayerAccountChipProps = {
  displayName: string;
  avatarUrl: string | null;
};

export function PlayerAccountChip({ displayName, avatarUrl }: PlayerAccountChipProps) {
  return (
    <div className="flex items-center gap-3">
      <Link
        className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 shadow-sm hover:border-zinc-300"
        href="/player/account"
        title="Manage your account"
      >
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
      <a className="text-sm font-semibold text-zinc-500 hover:text-zinc-900" href={`/api/auth/signout?returnTo=${encodeURIComponent("/")}`}>
        Sign out
      </a>
    </div>
  );
}
