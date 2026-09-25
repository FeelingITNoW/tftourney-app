import Link from "next/link";
import type { ReactNode } from "react";

export type SiteHeaderMode = "host" | "player" | "public";

type NavLink = {
  label: string;
  href: string;
};

type ModeStyle = {
  badgeLabel: string | null;
  badgeClassName: string;
  barClassName: string;
  homeHref: string;
  nav: NavLink[];
};

const MODE_STYLES: Record<SiteHeaderMode, ModeStyle> = {
  host: {
    badgeLabel: "Host workspace",
    badgeClassName: "bg-emerald-100 text-emerald-800",
    barClassName: "bg-emerald-600",
    homeHref: "/dashboard",
    nav: [],
  },
  player: {
    badgeLabel: "Player",
    badgeClassName: "bg-indigo-100 text-indigo-800",
    barClassName: "bg-indigo-600",
    homeHref: "/player",
    nav: [],
  },
  public: {
    badgeLabel: null,
    badgeClassName: "",
    barClassName: "bg-zinc-300",
    homeHref: "/",
    nav: [
      { label: "Play", href: "/player" },
      { label: "Host", href: "/dashboard" },
    ],
  },
};

type SiteHeaderProps = {
  mode: SiteHeaderMode;
  subtitle: string;
  /** Overrides the default badge text for this mode (e.g. "Host sign-in" on the sign-in page). */
  badgeLabel?: string;
  backHref?: string;
  backLabel?: string;
  /** Small link shown when the visitor also has a session for the other role. */
  switchHref?: string;
  switchLabel?: string;
  /** Quick-nav links (Play/Host, etc). Defaults to the mode's own list; pass false to hide. */
  showNav?: boolean;
  actions?: ReactNode;
  maxWidthClassName?: string;
};

export function SiteHeader({
  mode,
  subtitle,
  badgeLabel,
  backHref,
  backLabel,
  switchHref,
  switchLabel,
  showNav = true,
  actions,
  maxWidthClassName = "max-w-6xl",
}: SiteHeaderProps) {
  const style = MODE_STYLES[mode];
  const badge = badgeLabel ?? style.badgeLabel;

  return (
    <div className="border-b border-zinc-200 bg-white">
      <div aria-hidden="true" className={`h-1.5 w-full ${style.barClassName}`} />
      <div
        className={`mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-6 py-5 sm:px-8 lg:px-10 ${maxWidthClassName}`}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-900 hover:text-zinc-700"
              href={style.homeHref}
            >
              TFTourney
            </Link>
            {badge ? (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badgeClassName}`}>
                {badge}
              </span>
            ) : null}
            {showNav
              ? style.nav.map((link) => (
                  <Link
                    className="ml-1 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 hover:text-zinc-800"
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </Link>
                ))
              : null}
          </div>
          <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {switchHref ? (
            <Link
              className="text-sm font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
              href={switchHref}
            >
              {switchLabel}
            </Link>
          ) : null}
          {backHref ? (
            <Link
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 shadow-sm hover:bg-zinc-50"
              href={backHref}
            >
              {backLabel ?? "Back"}
            </Link>
          ) : null}
          {actions}
        </div>
      </div>
    </div>
  );
}
