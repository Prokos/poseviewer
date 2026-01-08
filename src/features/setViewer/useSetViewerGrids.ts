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
import { shuffleItems } from '../../utils/random';

type SetViewerTab = 'samples' | 'favorites' | 'nonfavorites' | 'all';

type ResolveSetImages = (
  set: PoseSet,
  buildIfMissing: boolean
) => Promise<DriveImage[]>;

type ViewerGridKind = 'sample' | 'favorites' | 'nonfavorites';

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
  resolveSetImages: ResolveSetImages;
  setError: (message: string) => void;
  setViewerIndexProgress: (value: string) => void;
  sampleBaseCount: number;
};

export function useSetViewerGrids({
  activeSet,
  isConnected,
  setViewerTab,
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

  const updateFavoriteImagesFromSource = useCallback(
    (
      setId: string,
      images: DriveImage[],
      favoriteIds: string[],
      options?: { keepLength?: boolean }
    ) => {
      const favorites = filterImagesByFavoriteStatus(images, favoriteIds, 'favorites');
      if (favorites.length === 0) {
        setFavoriteImages([]);
        favoriteSeenRef.current.set(setId, new Set());
        return;
      }
      const targetLength =
        options?.keepLength && favoriteImages.length > 0
          ? Math.min(favoriteImages.length, favorites.length)
          : Math.min(samplePageSize, favorites.length);
      favoriteSeenRef.current.set(setId, new Set());
      const next = pickNext.favorites(setId, favorites, targetLength);
      setFavoriteImages(next);
    },
    [favoriteImages.length, pickNext, samplePageSize]
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
    async (kind: ViewerGridKind, count: number) => {
      if (!activeSet || !isConnected || count <= 0) {
        return;
      }
      const config = getViewerGridConfig(kind);
      config.setIsLoading(true);
      setViewerIndexProgress(config.label);
      try {
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
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        config.setIsLoading(false);
        setViewerIndexProgress('');
      }
    },
    [activeSet, getViewerGridConfig, isConnected, resolveSetImages, setError, setViewerIndexProgress]
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
        const shuffled = shuffleItems(filtered);
        config.setImages(shuffled);
        config.seenRef.current.set(
          activeSet.id,
          new Set(shuffled.map((image) => image.id))
        );
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        config.setIsLoading(false);
        setViewerIndexProgress('');
      }
    },
    [activeSet, getViewerGridConfig, isConnected, resolveSetImages, setError, setViewerIndexProgress]
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
      void loadViewerGridBatch('favorites', samplePageSize);
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
      void loadViewerGridBatch('nonfavorites', samplePageSize);
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
  };
}
