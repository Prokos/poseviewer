import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { DriveImage } from '../../drive/types';
import type { PoseSet } from '../../metadata';
import type { ViewerTabKey } from './viewerMetrics';
import {
  createBatchPicker,
  filterImagesByFavoriteStatus,
  filterImagesByHiddenStatus,
} from '../../utils/imageSampling';
import { sortImagesChronological, sortImagesRandomSeeded } from '../../utils/imageSorting';

type SetViewerTab = ViewerTabKey;

type ResolveSetImages = (
  set: PoseSet,
  buildIfMissing: boolean
) => Promise<DriveImage[]>;

type ViewerGridKind = 'favorites' | 'nonfavorites' | 'hidden';

type ViewerSortMode = 'random' | 'chronological';
type ViewerSortOrder = 'asc' | 'desc';

type ViewerGridConfig = {
  label: string;
  filterMode: 'all' | 'favorites' | 'nonfavorites' | 'hidden';
  setImages: Dispatch<SetStateAction<DriveImage[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  seenRef: MutableRefObject<Map<string, Set<string>>>;
  pickBatch: (setId: string, images: DriveImage[], count: number) => DriveImage[];
};

type UseSetViewerGridsArgs = {
  activeSet: PoseSet | null;
  isConnected: boolean;
  setViewerTab: SetViewerTab;
  viewerSort: ViewerSortMode;
  viewerSortOrder: ViewerSortOrder;
  viewerSortSeed: string;
  resolveSetImages: ResolveSetImages;
  setError: (message: string) => void;
  setViewerIndexProgress: (value: string) => void;
  gridBaseCount: number;
};

export function useSetViewerGrids({
  activeSet,
  isConnected,
  setViewerTab,
  viewerSort,
  viewerSortOrder,
  viewerSortSeed,
  resolveSetImages,
  setError,
  setViewerIndexProgress,
  gridBaseCount,
}: UseSetViewerGridsArgs) {
  const [nonFavoriteImages, setNonFavoriteImages] = useState<DriveImage[]>([]);
  const [favoriteImages, setFavoriteImages] = useState<DriveImage[]>([]);
  const [hiddenImages, setHiddenImages] = useState<DriveImage[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [isLoadingNonFavorites, setIsLoadingNonFavorites] = useState(false);
  const [isLoadingHidden, setIsLoadingHidden] = useState(false);
  const favoriteSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const nonFavoriteSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const hiddenSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const orderedListsRef = useRef<
    Map<
      string,
      {
        mode: ViewerSortMode;
        favorites: DriveImage[];
        nonfavorites: DriveImage[];
        hidden: DriveImage[];
      }
    >
  >(new Map());

  const gridPageSize = useMemo(() => Math.max(1, gridBaseCount), [gridBaseCount]);

  const pickNext = useMemo(
    () => ({
      nonFavorites: createBatchPicker(nonFavoriteSeenRef.current),
      favorites: createBatchPicker(favoriteSeenRef.current),
      hidden: createBatchPicker(hiddenSeenRef.current),
    }),
    []
  );

  const buildOrderedLists = useCallback(
    (setId: string, images: DriveImage[], favoriteIds: string[], hiddenIds: string[]) => {
      const favoriteSet = new Set(favoriteIds);
      const hiddenSet = new Set(hiddenIds);
      const visibleImages = filterImagesByHiddenStatus(images, hiddenIds, 'visible');
      const hiddenImages = filterImagesByHiddenStatus(images, hiddenIds, 'hidden');
      if (viewerSort === 'chronological') {
        const orderedVisible = sortImagesChronological(visibleImages);
        const orderedHidden = sortImagesChronological(hiddenImages);
        const orderedVisibleFinal =
          viewerSortOrder === 'desc' ? orderedVisible.slice().reverse() : orderedVisible;
        const orderedHiddenFinal =
          viewerSortOrder === 'desc' ? orderedHidden.slice().reverse() : orderedHidden;
        const favorites = filterImagesByFavoriteStatus(orderedVisible, favoriteIds, 'favorites');
        const nonfavorites = filterImagesByFavoriteStatus(orderedVisible, favoriteIds, 'nonfavorites');
        const next = {
          mode: viewerSort,
          favorites:
            viewerSortOrder === 'desc' ? favorites.slice().reverse() : favorites,
          nonfavorites:
            viewerSortOrder === 'desc' ? nonfavorites.slice().reverse() : nonfavorites,
          hidden: orderedHiddenFinal,
        };
        orderedListsRef.current.set(setId, next);
        return next;
      }

      const existing = orderedListsRef.current.get(setId);
      if (existing && existing.mode === 'random') {
        const imageById = new Map(images.map((image) => [image.id, image]));
        const keepFavorites = existing.favorites.filter(
          (image) =>
            imageById.has(image.id) && favoriteSet.has(image.id) && !hiddenSet.has(image.id)
        );
        const keepNonFavorites = existing.nonfavorites.filter(
          (image) =>
            imageById.has(image.id) && !favoriteSet.has(image.id) && !hiddenSet.has(image.id)
        );
        const keepHidden = existing.hidden.filter(
          (image) => imageById.has(image.id) && hiddenSet.has(image.id)
        );
        const favoriteKnown = new Set(keepFavorites.map((image) => image.id));
        const nonFavoriteKnown = new Set(keepNonFavorites.map((image) => image.id));
        const hiddenKnown = new Set(keepHidden.map((image) => image.id));
        const missingFavorites = visibleImages.filter(
          (image) => favoriteSet.has(image.id) && !favoriteKnown.has(image.id)
        );
        const missingNonFavorites = visibleImages.filter(
          (image) => !favoriteSet.has(image.id) && !nonFavoriteKnown.has(image.id)
        );
        const missingHidden = hiddenImages.filter(
          (image) => !hiddenKnown.has(image.id)
        );
        const next = {
          mode: viewerSort,
          favorites: keepFavorites.concat(
            sortImagesRandomSeeded(missingFavorites, `${viewerSortSeed}|${setId}|favorites`)
          ),
          nonfavorites: keepNonFavorites.concat(
            sortImagesRandomSeeded(missingNonFavorites, `${viewerSortSeed}|${setId}|nonfavorites`)
          ),
          hidden: keepHidden.concat(
            sortImagesRandomSeeded(missingHidden, `${viewerSortSeed}|${setId}|hidden`)
          ),
        };
        orderedListsRef.current.set(setId, next);
        return next;
      }

      const favorites = filterImagesByFavoriteStatus(visibleImages, favoriteIds, 'favorites');
      const nonfavorites = filterImagesByFavoriteStatus(visibleImages, favoriteIds, 'nonfavorites');
      const next = {
        mode: viewerSort,
        favorites: sortImagesRandomSeeded(favorites, `${viewerSortSeed}|${setId}|favorites`),
        nonfavorites: sortImagesRandomSeeded(nonfavorites, `${viewerSortSeed}|${setId}|nonfavorites`),
        hidden: sortImagesRandomSeeded(hiddenImages, `${viewerSortSeed}|${setId}|hidden`),
      };
      orderedListsRef.current.set(setId, next);
      return next;
    },
    [viewerSort, viewerSortOrder, viewerSortSeed]
  );

  const getOrderedLists = useCallback(
    async (set: PoseSet) => {
      const images = await resolveSetImages(set, true);
      return buildOrderedLists(
        set.id,
        images,
        set.favoriteImageIds ?? [],
        set.hiddenImageIds ?? []
      );
    },
    [buildOrderedLists, resolveSetImages]
  );

  const updateFavoriteImagesFromSource = useCallback(
    (
      setId: string,
      images: DriveImage[],
      favoriteIds: string[],
      hiddenIds: string[],
      options?: { keepLength?: boolean }
    ) => {
      const ordered = buildOrderedLists(setId, images, favoriteIds, hiddenIds);
      if (ordered.favorites.length === 0) {
        setFavoriteImages([]);
        favoriteSeenRef.current.set(setId, new Set());
        return;
      }
      const targetLength =
        options?.keepLength && favoriteImages.length > 0
          ? Math.min(favoriteImages.length, ordered.favorites.length)
          : Math.min(gridPageSize, ordered.favorites.length);
      favoriteSeenRef.current.set(setId, new Set());
      setFavoriteImages(ordered.favorites.slice(0, targetLength));
    },
    [buildOrderedLists, favoriteImages.length, gridPageSize]
  );

  const updateHiddenImagesFromSource = useCallback(
    (
      setId: string,
      images: DriveImage[],
      favoriteIds: string[],
      hiddenIds: string[],
      options?: { keepLength?: boolean }
    ) => {
      const ordered = buildOrderedLists(setId, images, favoriteIds, hiddenIds);
      if (ordered.hidden.length === 0) {
        setHiddenImages([]);
        hiddenSeenRef.current.set(setId, new Set());
        return;
      }
      const targetLength =
        options?.keepLength && hiddenImages.length > 0
          ? Math.min(hiddenImages.length, ordered.hidden.length)
          : Math.min(gridPageSize, ordered.hidden.length);
      hiddenSeenRef.current.set(setId, new Set());
      setHiddenImages(ordered.hidden.slice(0, targetLength));
    },
    [buildOrderedLists, hiddenImages.length, gridPageSize]
  );

  const hydrateSetExtras = useCallback(
    async (set: PoseSet, buildIfMissing: boolean) => {
      try {
        const images = await resolveSetImages(set, buildIfMissing);
        updateFavoriteImagesFromSource(
          set.id,
          images,
          set.favoriteImageIds ?? [],
          set.hiddenImageIds ?? []
        );
        updateHiddenImagesFromSource(
          set.id,
          images,
          set.favoriteImageIds ?? [],
          set.hiddenImageIds ?? []
        );
      } catch (loadError) {
        setError((loadError as Error).message);
        setFavoriteImages([]);
        setHiddenImages([]);
      }
    },
    [
      resolveSetImages,
      setError,
      updateFavoriteImagesFromSource,
      updateHiddenImagesFromSource,
    ]
  );

  const hydratedSetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      hydratedSetIdRef.current = null;
      return;
    }
    if (!activeSet || setViewerTab === 'all') {
      return;
    }
    if (hydratedSetIdRef.current === activeSet.id) {
      return;
    }
    hydratedSetIdRef.current = activeSet.id;
    void hydrateSetExtras(activeSet, true);
  }, [activeSet, hydrateSetExtras, isConnected, setViewerTab]);

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    setNonFavoriteImages((current) =>
      filterImagesByFavoriteStatus(
        filterImagesByHiddenStatus(current, activeSet.hiddenImageIds ?? [], 'visible'),
        activeSet.favoriteImageIds ?? [],
        'nonfavorites'
      )
    );
    setFavoriteImages((current) =>
      filterImagesByHiddenStatus(current, activeSet.hiddenImageIds ?? [], 'visible')
    );
    setHiddenImages((current) =>
      filterImagesByHiddenStatus(current, activeSet.hiddenImageIds ?? [], 'hidden')
    );
  }, [activeSet?.favoriteImageIds, activeSet?.hiddenImageIds, activeSet?.id]);

  useEffect(() => {
    orderedListsRef.current.clear();
  }, [viewerSort, viewerSortOrder, viewerSortSeed]);

  const getViewerGridConfig = useCallback(
    (kind: ViewerGridKind): ViewerGridConfig => {
      if (kind === 'favorites') {
        return {
          label: 'Loading favorites…',
          filterMode: 'favorites',
          setImages: setFavoriteImages,
          setIsLoading: setIsLoadingFavorites,
          seenRef: favoriteSeenRef,
          pickBatch: pickNext.favorites,
        };
      }
      if (kind === 'hidden') {
        return {
          label: 'Loading hidden…',
          filterMode: 'hidden',
          setImages: setHiddenImages,
          setIsLoading: setIsLoadingHidden,
          seenRef: hiddenSeenRef,
          pickBatch: pickNext.hidden,
        };
      }
      return {
        label: 'Loading images…',
        filterMode: 'nonfavorites',
        setImages: setNonFavoriteImages,
        setIsLoading: setIsLoadingNonFavorites,
        seenRef: nonFavoriteSeenRef,
        pickBatch: pickNext.nonFavorites,
      };
    },
    [pickNext.favorites, pickNext.hidden, pickNext.nonFavorites]
  );

  const loadViewerGridBatch = useCallback(
    async (kind: ViewerGridKind, count: number, options?: { replace?: boolean }) => {
      if (!activeSet || !isConnected || count <= 0) {
        return;
      }
      const config = getViewerGridConfig(kind);
      config.setIsLoading(true);
      setViewerIndexProgress(config.label);
      try {
        const ordered = await getOrderedLists(activeSet);
        const list =
          kind === 'favorites'
            ? ordered.favorites
            : kind === 'hidden'
              ? ordered.hidden
              : ordered.nonfavorites;
        if (list.length === 0) {
          config.setImages([]);
          return;
        }
        config.setImages((current) => {
          const nextLength = options?.replace
            ? Math.min(count, list.length)
            : Math.min(current.length + count, list.length);
          return list.slice(0, nextLength);
        });
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        config.setIsLoading(false);
        setViewerIndexProgress('');
      }
    },
    [
      activeSet,
      getOrderedLists,
      getViewerGridConfig,
      isConnected,
      resolveSetImages,
      setError,
      setViewerIndexProgress,
    ]
  );

  const loadViewerGridAll = useCallback(
    async (kind: ViewerGridKind) => {
      if (!activeSet || !isConnected) {
        return;
      }
      const config = getViewerGridConfig(kind);
      config.setIsLoading(true);
      setViewerIndexProgress(config.label);
      try {
        const ordered = await getOrderedLists(activeSet);
        const list =
          kind === 'favorites'
            ? ordered.favorites
            : kind === 'hidden'
              ? ordered.hidden
              : ordered.nonfavorites;
        config.setImages(list);
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        config.setIsLoading(false);
        setViewerIndexProgress('');
      }
    },
    [
      activeSet,
      getOrderedLists,
      getViewerGridConfig,
      isConnected,
      resolveSetImages,
      setError,
      setViewerIndexProgress,
    ]
  );

  const handleLoadMoreNonFavorites = useCallback(async () => {
    await loadViewerGridBatch('nonfavorites', gridPageSize);
  }, [loadViewerGridBatch, gridPageSize]);

  const handleLoadMoreFavorites = useCallback(async () => {
    await loadViewerGridBatch('favorites', gridPageSize);
  }, [loadViewerGridBatch, gridPageSize]);

  const handleLoadMoreHidden = useCallback(async () => {
    await loadViewerGridBatch('hidden', gridPageSize);
  }, [loadViewerGridBatch, gridPageSize]);

  const handleLoadAllFavorites = useCallback(async () => {
    await loadViewerGridAll('favorites');
  }, [loadViewerGridAll]);

  const handleLoadAllNonFavorites = useCallback(async () => {
    await loadViewerGridAll('nonfavorites');
  }, [loadViewerGridAll]);

  const handleLoadAllHidden = useCallback(async () => {
    await loadViewerGridAll('hidden');
  }, [loadViewerGridAll]);

  const handleResetFavorites = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setFavoriteImages([]);
    await loadViewerGridBatch('favorites', gridPageSize, { replace: true });
  }, [activeSet, gridPageSize, isConnected, loadViewerGridBatch]);

  const handleResetNonFavorites = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setNonFavoriteImages([]);
    await loadViewerGridBatch('nonfavorites', gridPageSize, { replace: true });
  }, [activeSet, gridPageSize, isConnected, loadViewerGridBatch]);

  const handleResetHidden = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setHiddenImages([]);
    await loadViewerGridBatch('hidden', gridPageSize, { replace: true });
  }, [activeSet, gridPageSize, isConnected, loadViewerGridBatch]);

  useEffect(() => {
    if (setViewerTab !== 'favorites' || !activeSet || isLoadingFavorites) {
      return;
    }
    if (favoriteImages.length === 0) {
      void loadViewerGridBatch('favorites', gridPageSize, { replace: true });
    }
  }, [
    activeSet,
    favoriteImages.length,
    gridPageSize,
    isLoadingFavorites,
    loadViewerGridBatch,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'nonfavorites' || !activeSet || isLoadingNonFavorites) {
      return;
    }
    if (nonFavoriteImages.length === 0) {
      void loadViewerGridBatch('nonfavorites', gridPageSize, { replace: true });
    }
  }, [
    activeSet,
    gridPageSize,
    isLoadingNonFavorites,
    loadViewerGridBatch,
    nonFavoriteImages.length,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'hidden' || !activeSet || isLoadingHidden) {
      return;
    }
    if (hiddenImages.length === 0) {
      void loadViewerGridBatch('hidden', gridPageSize, { replace: true });
    }
  }, [
    activeSet,
    gridPageSize,
    hiddenImages.length,
    isLoadingHidden,
    loadViewerGridBatch,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'favorites' || !activeSet) {
      return;
    }
    favoriteSeenRef.current.set(activeSet.id, new Set());
    setFavoriteImages([]);
  }, [activeSet?.id, setViewerTab]);

  useEffect(() => {
    if (setViewerTab !== 'nonfavorites' || !activeSet) {
      return;
    }
    nonFavoriteSeenRef.current.set(activeSet.id, new Set());
    setNonFavoriteImages([]);
  }, [activeSet?.id, setViewerTab]);

  useEffect(() => {
    if (setViewerTab !== 'hidden' || !activeSet) {
      return;
    }
    hiddenSeenRef.current.set(activeSet.id, new Set());
    setHiddenImages([]);
  }, [activeSet?.id, setViewerTab]);

  return {
    favoriteImages,
    setFavoriteImages,
    nonFavoriteImages,
    setNonFavoriteImages,
    hiddenImages,
    setHiddenImages,
    isLoadingFavorites,
    isLoadingNonFavorites,
    isLoadingHidden,
    gridPageSize,
    pickNext,
    updateFavoriteImagesFromSource,
    updateHiddenImagesFromSource,
    handleLoadMoreFavorites,
    handleLoadAllFavorites,
    handleLoadMoreNonFavorites,
    handleLoadAllNonFavorites,
    handleLoadMoreHidden,
    handleLoadAllHidden,
    handleResetFavorites,
    handleResetNonFavorites,
    handleResetHidden,
  };
}
