import Link from "next/link";
import {
  buildPageHref,
  getPageNavigation,
} from "@/lib/pagination";

type TournamentPaginationProps = {
  pathname: string;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export function TournamentPagination({
  pathname,
  page,
  pageSize,
  totalCount,
  totalPages,
}: TournamentPaginationProps) {
  if (totalCount === 0) {
    return null;
  }

  const firstResult = (page - 1) * pageSize + 1;
  const lastResult = Math.min(page * pageSize, totalCount);
  const navigation = getPageNavigation(page, totalPages);

  return (
    <div className="flex flex-col gap-4 border-t border-zinc-200 px-4 py-4 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
      <p aria-live="polite">
        Showing {firstResult}&ndash;{lastResult} of {totalCount} tournaments
      </p>
      {totalPages > 1 ? (
        <nav aria-label="Tournament pages" className="flex items-center gap-1">
          {page > 1 ? (
            <Link
              aria-label="Previous page"
              className="rounded-md border border-zinc-300 px-3 py-2 font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
              href={buildPageHref(pathname, page - 1)}
            >
              Previous
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="cursor-not-allowed rounded-md border border-zinc-200 px-3 py-2 font-medium text-zinc-400"
            >
              Previous
            </span>
          )}

          <div className="hidden items-center gap-1 sm:flex">
            {navigation.map((item) =>
              item.type === "ellipsis" ? (
                <span aria-hidden="true" className="px-2 text-zinc-400" key={item.key}>
                  …
                </span>
              ) : item.page === page ? (
                <span
                  aria-current="page"
                  className="min-w-10 rounded-md bg-zinc-950 px-3 py-2 text-center font-semibold text-white"
                  key={item.page}
                >
                  {item.page}
                </span>
              ) : (
                <Link
                  aria-label={`Page ${item.page}`}
                  className="min-w-10 rounded-md border border-zinc-300 px-3 py-2 text-center font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                  href={buildPageHref(pathname, item.page)}
                  key={item.page}
                >
                  {item.page}
                </Link>
              ),
            )}
          </div>

          <span className="px-2 font-medium text-zinc-700 sm:hidden">
            Page {page} of {totalPages}
          </span>

          {page < totalPages ? (
            <Link
              aria-label="Next page"
              className="rounded-md border border-zinc-300 px-3 py-2 font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
              href={buildPageHref(pathname, page + 1)}
            >
              Next
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="cursor-not-allowed rounded-md border border-zinc-200 px-3 py-2 font-medium text-zinc-400"
            >
              Next
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
