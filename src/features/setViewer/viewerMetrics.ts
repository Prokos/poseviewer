export type ViewerTabKey = 'favorites' | 'nonfavorites' | 'hidden' | 'all';

export type ViewerTabMetrics = {
  loaded: number;
  total?: number;
  remaining?: number;
  pending: number;
  showLoadMore: boolean;
  showLoadAll: boolean;
};

export type ViewerTabMetricsMap = Record<ViewerTabKey, ViewerTabMetrics>;

type TabMetricsInput = {
  loaded: number;
  total?: number;
  pageSize: number;
  allowLoadAllWithoutTotal?: boolean;
};

export function computeTabMetrics({
  loaded,
  total,
  pageSize,
  allowLoadAllWithoutTotal = false,
}: TabMetricsInput): ViewerTabMetrics {
  const remaining = total !== undefined ? Math.max(0, total - loaded) : undefined;
  const pending =
    total !== undefined ? Math.max(0, Math.min(pageSize, remaining)) : pageSize;
  const showLoadMore = pending > 0;
  const showLoadAll =
    total !== undefined ? remaining > 0 : allowLoadAllWithoutTotal;
  return { loaded, total, remaining, pending, showLoadMore, showLoadAll };
}

type BuildViewerTabMetricsInput = {
  favorites: { loaded: number; total: number; pageSize: number };
  nonfavorites: {
    loaded: number;
    total?: number;
    pageSize: number;
    allowLoadAllWithoutTotal?: boolean;
  };
  hidden: { loaded: number; total: number; pageSize: number };
  all: { loaded: number; total?: number; pageSize: number };
};

export function buildViewerTabMetrics(
  input: BuildViewerTabMetricsInput
): ViewerTabMetricsMap {
  return {
    favorites: computeTabMetrics({
      ...input.favorites,
      allowLoadAllWithoutTotal: false,
    }),
    nonfavorites: computeTabMetrics({
      ...input.nonfavorites,
      allowLoadAllWithoutTotal: input.nonfavorites.allowLoadAllWithoutTotal ?? true,
    }),
    hidden: computeTabMetrics({
      ...input.hidden,
      allowLoadAllWithoutTotal: false,
    }),
    all: computeTabMetrics({
      ...input.all,
      allowLoadAllWithoutTotal: false,
    }),
  };
}

type SetTotalsInput = {
  totalImagesKnownRaw?: number;
  activeImagesLength: number;
  favoriteIds: string[];
  hiddenIds: string[];
};

export type SetTotals = {
  totalVisibleKnown?: number;
  allImagesCount: number;
  favoritesCount: number;
  hiddenCount: number;
  nonFavoritesCount?: number;
};

export function computeSetTotals({
  totalImagesKnownRaw,
  activeImagesLength,
  favoriteIds,
  hiddenIds,
}: SetTotalsInput): SetTotals {
  const hiddenCount = hiddenIds.length;
  const totalVisibleKnown =
    totalImagesKnownRaw !== undefined
      ? Math.max(0, totalImagesKnownRaw - hiddenCount)
      : undefined;
  const allImagesCount = totalVisibleKnown ?? activeImagesLength;
  const hiddenSet = new Set(hiddenIds);
  const favoritesCount = favoriteIds.filter((id) => !hiddenSet.has(id)).length;
  const nonFavoritesCount =
    totalVisibleKnown !== undefined
      ? Math.max(0, totalVisibleKnown - favoritesCount)
      : undefined;
  return {
    totalVisibleKnown,
    allImagesCount,
    favoritesCount,
    hiddenCount,
    nonFavoritesCount,
  };
}
