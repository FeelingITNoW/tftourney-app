export type PageParam = string | string[] | undefined;

export type ParsedPageParam = {
  page: number;
  redirectPage: number | null;
};

export type PageNavigationItem =
  | { type: "page"; page: number }
  | { type: "ellipsis"; key: string };

export function parsePageParam(value: PageParam): ParsedPageParam {
  if (value === undefined) {
    return { page: 1, redirectPage: null };
  }

  if (
    Array.isArray(value) ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    return { page: 1, redirectPage: 1 };
  }

  const page = Number(value);
  return { page, redirectPage: page === 1 ? 1 : null };
}

export function buildPageHref(pathname: string, page: number): string {
  return page <= 1 ? pathname : `${pathname}?page=${page}`;
}

export function getPageNavigation(
  page: number,
  totalPages: number,
): PageNavigationItem[] {
  const normalizedTotalPages = Math.max(1, totalPages);
  const visiblePages = new Set<number>([
    1,
    normalizedTotalPages,
    page - 2,
    page - 1,
    page,
    page + 1,
    page + 2,
  ]);
  const pages = [...visiblePages]
    .filter((candidate) => candidate >= 1 && candidate <= normalizedTotalPages)
    .sort((first, second) => first - second);
  const navigation: PageNavigationItem[] = [];

  pages.forEach((candidate, index) => {
    if (index > 0 && candidate - pages[index - 1] > 1) {
      navigation.push({ type: "ellipsis", key: `ellipsis-${candidate}` });
    }
    navigation.push({ type: "page", page: candidate });
  });

  return navigation;
}
