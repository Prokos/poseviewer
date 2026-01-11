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
import {
  appendUniqueImages,
  createBatchPicker,
  filterImagesByFavoriteStatus,
} from '../../utils/imageSampling';
import { shuffleItemsSeeded } from '../../utils/random';

type SetViewerTab = 'samples' | 'favorites' | 'nonfavorites' | 'all';

type ResolveSetImages = (
  set: PoseSet,
  buildIfMissing: boolean
) => Promise<DriveImage[]>;

type ViewerGridKind = 'sample' | 'favorites' | 'nonfavorites';

type ViewerSortMode = 'random' | 'chronological';

type ViewerGridConfig = {
  label: string;
  filterMode: 'all' | 'favorites' | 'nonfavorites';
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
  viewerSortSeed: string;
  resolveSetImages: ResolveSetImages;
  setError: (message: string) => void;
  setViewerIndexProgress: (value: string) => void;
  sampleBaseCount: number;
};

export function useSetViewerGrids({
  activeSet,
  isConnected,
  setViewerTab,
  viewerSort,
  viewerSortSeed,
  resolveSetImages,
  setError,
  setViewerIndexProgress,
  sampleBaseCount,
}: UseSetViewerGridsArgs) {
  const [sampleImages, setSampleImages] = useState<DriveImage[]>([]);
  const [nonFavoriteImages, setNonFavoriteImages] = useState<DriveImage[]>([]);
  const [favoriteImages, setFavoriteImages] = useState<DriveImage[]>([]);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [isLoadingNonFavorites, setIsLoadingNonFavorites] = useState(false);
  const [sampleColumns, setSampleColumns] = useState(1);
  const sampleGridRef = useRef<HTMLDivElement | null>(null);
  const sampleSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const favoriteSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const nonFavoriteSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const orderedListsRef = useRef<
    Map<
      string,
      {
        mode: ViewerSortMode;
        favorites: DriveImage[];
        nonfavorites: DriveImage[];
      }
    >
  >(new Map());

  const samplePageSize = useMemo(
    () => Math.max(1, Math.ceil(sampleBaseCount / sampleColumns) * sampleColumns),
    [sampleBaseCount, sampleColumns]
  );

  const pickNext = useMemo(
    () => ({
      sample: createBatchPicker(sampleSeenRef.current),
      nonFavorites: createBatchPicker(nonFavoriteSeenRef.current),
      favorites: createBatchPicker(favoriteSeenRef.current),
    }),
    []
  );

  const buildOrderedLists = useCallback(
    (setId: string, images: DriveImage[], favoriteIds: string[]) => {
      const favoriteSet = new Set(favoriteIds);
      if (viewerSort === 'chronological') {
        const favorites = filterImagesByFavoriteStatus(images, favoriteIds, 'favorites');
        const nonfavorites = filterImagesByFavoriteStatus(images, favoriteIds, 'nonfavorites');
        const next = {
          mode: viewerSort,
          favorites,
          nonfavorites,
        };
        orderedListsRef.current.set(setId, next);
        return next;
      }

      const existing = orderedListsRef.current.get(setId);
      if (existing && existing.mode === 'random') {
        const imageById = new Map(images.map((image) => [image.id, image]));
        const keepFavorites = existing.favorites.filter(
          (image) => imageById.has(image.id) && favoriteSet.has(image.id)
        );
        const keepNonFavorites = existing.nonfavorites.filter(
          (image) => imageById.has(image.id) && !favoriteSet.has(image.id)
        );
        const favoriteKnown = new Set(keepFavorites.map((image) => image.id));
        const nonFavoriteKnown = new Set(keepNonFavorites.map((image) => image.id));
        const missingFavorites = images.filter(
          (image) => favoriteSet.has(image.id) && !favoriteKnown.has(image.id)
        );
        const missingNonFavorites = images.filter(
          (image) => !favoriteSet.has(image.id) && !nonFavoriteKnown.has(image.id)
        );
        const next = {
          mode: viewerSort,
          favorites: keepFavorites.concat(
            shuffleItemsSeeded(missingFavorites, `${viewerSortSeed}|${setId}|favorites`)
          ),
          nonfavorites: keepNonFavorites.concat(
            shuffleItemsSeeded(missingNonFavorites, `${viewerSortSeed}|${setId}|nonfavorites`)
          ),
        };
        orderedListsRef.current.set(setId, next);
        return next;
      }

      const favorites = filterImagesByFavoriteStatus(images, favoriteIds, 'favorites');
      const nonfavorites = filterImagesByFavoriteStatus(images, favoriteIds, 'nonfavorites');
      const next = {
        mode: viewerSort,
        favorites: shuffleItemsSeeded(favorites, `${viewerSortSeed}|${setId}|favorites`),
        nonfavorites: shuffleItemsSeeded(nonfavorites, `${viewerSortSeed}|${setId}|nonfavorites`),
      };
      orderedListsRef.current.set(setId, next);
      return next;
    },
    [viewerSort, viewerSortSeed]
  );

  const getOrderedLists = useCallback(
    async (set: PoseSet) => {
      const images = await resolveSetImages(set, true);
      return buildOrderedLists(set.id, images, set.favoriteImageIds ?? []);
    },
    [buildOrderedLists, resolveSetImages]
  );

  const updateFavoriteImagesFromSource = useCallback(
    (
      setId: string,
      images: DriveImage[],
      favoriteIds: string[],
      options?: { keepLength?: boolean }
    ) => {
      const ordered = buildOrderedLists(setId, images, favoriteIds);
      if (ordered.favorites.length === 0) {
        setFavoriteImages([]);
        favoriteSeenRef.current.set(setId, new Set());
        return;
      }
      const targetLength =
        options?.keepLength && favoriteImages.length > 0
          ? Math.min(favoriteImages.length, ordered.favorites.length)
          : Math.min(samplePageSize, ordered.favorites.length);
      favoriteSeenRef.current.set(setId, new Set());
      setFavoriteImages(ordered.favorites.slice(0, targetLength));
    },
    [buildOrderedLists, favoriteImages.length, samplePageSize]
  );

  const hydrateSetExtras = useCallback(
    async (set: PoseSet, buildIfMissing: boolean) => {
      setIsLoadingSample(true);
      setViewerIndexProgress('Loading index…');
      try {
        const images = await resolveSetImages(set, buildIfMissing);
        updateFavoriteImagesFromSource(set.id, images, set.favoriteImageIds ?? []);
        setSampleImages(pickNext.sample(set.id, images, samplePageSize));
      } catch (loadError) {
        setError((loadError as Error).message);
        setFavoriteImages([]);
        setSampleImages([]);
      } finally {
        setIsLoadingSample(false);
        setViewerIndexProgress('');
      }
    },
    [pickNext, resolveSetImages, samplePageSize, setError, setViewerIndexProgress, updateFavoriteImagesFromSource]
  );

  const hydratedSetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      hydratedSetIdRef.current = null;
      return;
    }
    if (!activeSet) {
      return;
    }
    if (hydratedSetIdRef.current === activeSet.id) {
      return;
    }
    hydratedSetIdRef.current = activeSet.id;
    void hydrateSetExtras(activeSet, true);
  }, [activeSet, hydrateSetExtras, isConnected]);

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    setNonFavoriteImages((current) =>
      filterImagesByFavoriteStatus(current, activeSet.favoriteImageIds ?? [], 'nonfavorites')
    );
  }, [activeSet?.favoriteImageIds, activeSet?.id]);

  useEffect(() => {
    orderedListsRef.current.clear();
  }, [viewerSort]);

  const getViewerGridConfig = useCallback(
    (kind: ViewerGridKind): ViewerGridConfig => {
      if (kind === 'sample') {
        return {
          label: 'Loading sample…',
          filterMode: 'all',
          setImages: setSampleImages,
          setIsLoading: setIsLoadingSample,
          seenRef: sampleSeenRef,
          pickBatch: pickNext.sample,
        };
      }
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
      return {
        label: 'Loading images…',
        filterMode: 'nonfavorites',
        setImages: setNonFavoriteImages,
        setIsLoading: setIsLoadingNonFavorites,
        seenRef: nonFavoriteSeenRef,
        pickBatch: pickNext.nonFavorites,
      };
    },
    [pickNext.favorites, pickNext.nonFavorites, pickNext.sample]
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
        if (kind === 'sample') {
          const images = await resolveSetImages(activeSet, true);
          const filtered = filterImagesByFavoriteStatus(
            images,
            activeSet.favoriteImageIds ?? [],
            config.filterMode
          );
          if (filtered.length === 0) {
            config.setImages([]);
            return;
          }
          const nextBatch = config.pickBatch(activeSet.id, filtered, count);
          if (nextBatch.length === 0) {
            return;
          }
          config.setImages((current) => appendUniqueImages(current, nextBatch));
          return;
        }
        const ordered = await getOrderedLists(activeSet);
        const list = kind === 'favorites' ? ordered.favorites : ordered.nonfavorites;
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
        if (kind === 'sample') {
          const images = await resolveSetImages(activeSet, true);
          const filtered = filterImagesByFavoriteStatus(
            images,
            activeSet.favoriteImageIds ?? [],
            config.filterMode
          );
          if (filtered.length === 0) {
            config.setImages([]);
            return;
          }
          const shuffled = shuffleItemsSeeded(filtered, `${viewerSortSeed}|${activeSet.id}|sample`);
          config.setImages(shuffled);
          config.seenRef.current.set(
            activeSet.id,
            new Set(shuffled.map((image) => image.id))
          );
          return;
        }
        const ordered = await getOrderedLists(activeSet);
        const list = kind === 'favorites' ? ordered.favorites : ordered.nonfavorites;
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

  const handleLoadMoreSample = useCallback(async () => {
    await loadViewerGridBatch('sample', samplePageSize);
  }, [loadViewerGridBatch, samplePageSize]);

  const handleLoadMoreNonFavorites = useCallback(async () => {
    await loadViewerGridBatch('nonfavorites', samplePageSize);
  }, [loadViewerGridBatch, samplePageSize]);

  const handleLoadMoreFavorites = useCallback(async () => {
    await loadViewerGridBatch('favorites', samplePageSize);
  }, [loadViewerGridBatch, samplePageSize]);

  const handleLoadAllSample = useCallback(async () => {
    await loadViewerGridAll('sample');
  }, [loadViewerGridAll]);

  const handleLoadAllFavorites = useCallback(async () => {
    await loadViewerGridAll('favorites');
  }, [loadViewerGridAll]);

  const handleLoadAllNonFavorites = useCallback(async () => {
    await loadViewerGridAll('nonfavorites');
  }, [loadViewerGridAll]);

  const handleResetFavorites = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setFavoriteImages([]);
    await loadViewerGridBatch('favorites', samplePageSize, { replace: true });
  }, [activeSet, isConnected, loadViewerGridBatch, samplePageSize]);

  const handleResetNonFavorites = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setNonFavoriteImages([]);
    await loadViewerGridBatch('nonfavorites', samplePageSize, { replace: true });
  }, [activeSet, isConnected, loadViewerGridBatch, samplePageSize]);

  useEffect(() => {
    if (setViewerTab !== 'samples' || !activeSet || isLoadingSample) {
      return;
    }
    if (sampleColumns <= 1 || sampleImages.length === 0) {
      return;
    }
    const remainder = sampleImages.length % sampleColumns;
    if (remainder === 0) {
      return;
    }
    const fill = sampleColumns - remainder;
    void loadViewerGridBatch('sample', fill);
  }, [
    activeSet,
    isLoadingSample,
    loadViewerGridBatch,
    sampleColumns,
    sampleImages.length,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'favorites' || !activeSet || isLoadingFavorites) {
      return;
    }
    if (favoriteImages.length === 0) {
      void loadViewerGridBatch('favorites', samplePageSize, { replace: true });
      return;
    }
    if (sampleColumns <= 1 || favoriteImages.length === 0) {
      return;
    }
    const remainder = favoriteImages.length % sampleColumns;
    if (remainder === 0) {
      return;
    }
    const fill = sampleColumns - remainder;
    void loadViewerGridBatch('favorites', fill);
  }, [
    activeSet,
    favoriteImages.length,
    isLoadingFavorites,
    loadViewerGridBatch,
    sampleColumns,
    samplePageSize,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'nonfavorites' || !activeSet || isLoadingNonFavorites) {
      return;
    }
    if (nonFavoriteImages.length === 0) {
      void loadViewerGridBatch('nonfavorites', samplePageSize, { replace: true });
      return;
    }
    if (sampleColumns <= 1 || nonFavoriteImages.length === 0) {
      return;
    }
    const remainder = nonFavoriteImages.length % sampleColumns;
    if (remainder === 0) {
      return;
    }
    const fill = sampleColumns - remainder;
    void loadViewerGridBatch('nonfavorites', fill);
  }, [
    activeSet,
    isLoadingNonFavorites,
    loadViewerGridBatch,
    nonFavoriteImages.length,
    sampleColumns,
    samplePageSize,
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
    const readColumns = (element: HTMLDivElement | null) => {
      if (!element) {
        return 1;
      }
      const value = window.getComputedStyle(element).gridTemplateColumns;
      if (!value || value === 'none') {
        return 1;
      }
      const count = value.split(' ').filter(Boolean).length;
      return Math.max(1, count);
    };
    const updateSample = () => setSampleColumns(readColumns(sampleGridRef.current));
    updateSample();
    const observer = new ResizeObserver(() => {
      updateSample();
    });
    if (sampleGridRef.current) {
      observer.observe(sampleGridRef.current);
    }
    return () => observer.disconnect();
  }, []);

  return {
    sampleImages,
    setSampleImages,
    favoriteImages,
    setFavoriteImages,
    nonFavoriteImages,
    setNonFavoriteImages,
    isLoadingSample,
    isLoadingFavorites,
    isLoadingNonFavorites,
    samplePageSize,
    sampleGridRef,
    pickNext,
    updateFavoriteImagesFromSource,
    handleLoadMoreSample,
    handleLoadAllSample,
    handleLoadMoreFavorites,
    handleLoadAllFavorites,
    handleLoadMoreNonFavorites,
    handleLoadAllNonFavorites,
    handleResetFavorites,
    handleResetNonFavorites,
  };
}
