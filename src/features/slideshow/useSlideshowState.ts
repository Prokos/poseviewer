import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { DriveImage } from '../../drive/types';
import type { PoseSet } from '../../metadata';
import { appendUniqueImages, filterImagesByFavoriteStatus } from '../../utils/imageSampling';
import { pickRandom } from '../../utils/random';

type SlideshowTagFilters = {
  include: string[];
  exclude: string[];
};

type ResolveSetImages = (
  set: PoseSet,
  buildIfMissing: boolean,
  options?: { suppressProgress?: boolean }
) => Promise<DriveImage[]>;

type UseSlideshowStateArgs = {
  page: 'overview' | 'create' | 'set' | 'slideshow';
  isConnected: boolean;
  slideshowSets: PoseSet[];
  slideshowFavoriteFilter: 'all' | 'favorites' | 'nonfavorites';
  slideshowTagFilters: SlideshowTagFilters;
  resolveSetImages: ResolveSetImages;
  setViewerIndexProgress: (value: string) => void;
  setError: (message: string) => void;
  openModalRef: MutableRefObject<(imageId: string, images: DriveImage[], label: string) => void>;
  slideshowPageSize: number;
};

export function useSlideshowState({
  page,
  isConnected,
  slideshowSets,
  slideshowFavoriteFilter,
  slideshowTagFilters,
  resolveSetImages,
  setViewerIndexProgress,
  setError,
  openModalRef,
  slideshowPageSize,
}: UseSlideshowStateArgs) {
  const [slideshowImages, setSlideshowImages] = useState<DriveImage[]>([]);
  const [isLoadingSlideshow, setIsLoadingSlideshow] = useState(false);
  const [slideshowStarted, setSlideshowStarted] = useState(false);
  const slideshowSeenRef = useRef<Set<string>>(new Set());
  const slideshowPoolRef = useRef<{ key: string; images: DriveImage[] } | null>(null);
  const slideshowImageSetRef = useRef<Map<string, string>>(new Map());
  const slideshowImagesRef = useRef<DriveImage[]>(slideshowImages);

  useEffect(() => {
    slideshowImagesRef.current = slideshowImages;
  }, [slideshowImages]);

  const resetSlideshow = useCallback(() => {
    slideshowPoolRef.current = null;
    slideshowSeenRef.current = new Set();
    slideshowImageSetRef.current = new Map();
    setSlideshowImages([]);
    setSlideshowStarted(false);
  }, []);

  const buildSlideshowPool = useCallback(async () => {
    if (!isConnected) {
      return [];
    }
    const shouldSkipSet = (set: PoseSet) => {
      const favorites = set.favoriteImageIds?.length ?? 0;
      if (slideshowFavoriteFilter === 'favorites') {
        return favorites === 0;
      }
      if (slideshowFavoriteFilter === 'nonfavorites') {
        if (typeof set.imageCount === 'number') {
          return set.imageCount - favorites <= 0;
        }
      }
      if (typeof set.imageCount === 'number' && set.imageCount <= 0) {
        return true;
      }
      return false;
    };
    const setsToLoad = slideshowSets.filter((set) => !shouldSkipSet(set));
    const results: DriveImage[] = [];
    const map = new Map<string, string>();
    const totalSets = setsToLoad.length;
    let processed = 0;
    const queue = [...setsToLoad];
    const concurrency = Math.min(6, totalSets || 1);
    const handleSet = async (set: PoseSet) => {
      const images = await resolveSetImages(set, true, { suppressProgress: true });
      if (images.length > 0) {
        if (slideshowFavoriteFilter === 'favorites') {
          const favorites = set.favoriteImageIds ?? [];
          const filtered = filterImagesByFavoriteStatus(images, favorites, 'favorites');
          for (const image of filtered) {
            map.set(image.id, set.id);
          }
          results.push(...filtered);
        } else if (slideshowFavoriteFilter === 'nonfavorites') {
          const favorites = set.favoriteImageIds ?? [];
          const filtered = filterImagesByFavoriteStatus(images, favorites, 'nonfavorites');
          for (const image of filtered) {
            map.set(image.id, set.id);
          }
          results.push(...filtered);
        } else {
          for (const image of images) {
            map.set(image.id, set.id);
          }
          results.push(...images);
        }
      }
      processed += 1;
      setViewerIndexProgress(`Loading indexes ${processed}/${totalSets}`);
    };
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const set = queue.shift();
        if (!set) {
          break;
        }
        await handleSet(set);
      }
    });
    await Promise.all(workers);
    slideshowImageSetRef.current = map;
    setViewerIndexProgress('');
    return results;
  }, [isConnected, resolveSetImages, setViewerIndexProgress, slideshowFavoriteFilter, slideshowSets]);

  const loadSlideshowBatch = useCallback(
    async (count: number, options?: { openModal?: boolean }) => {
      if (!isConnected || count <= 0) {
        return;
      }
      setIsLoadingSlideshow(true);
      setViewerIndexProgress('Loading slideshow…');
      try {
        const key = JSON.stringify({
          include: slideshowTagFilters.include,
          exclude: slideshowTagFilters.exclude,
          favorite: slideshowFavoriteFilter,
        });
        if (!slideshowPoolRef.current || slideshowPoolRef.current.key !== key) {
          slideshowPoolRef.current = {
            key,
            images: await buildSlideshowPool(),
          };
          slideshowSeenRef.current = new Set();
          setSlideshowImages([]);
        }
        const pool = slideshowPoolRef.current.images;
        if (pool.length === 0) {
          return;
        }
        const seen = slideshowSeenRef.current;
        if (seen.size >= pool.length) {
          seen.clear();
        }
        const available = pool.filter((image) => !seen.has(image.id));
        const batch = pickRandom(available, Math.min(count, available.length));
        for (const image of batch) {
          seen.add(image.id);
        }
        let mergedResult: DriveImage[] | null = null;
        setSlideshowImages((current) => {
          const merged = appendUniqueImages(current, batch);
          if (options?.openModal && merged.length > 0 && current.length === 0) {
            openModalRef.current(merged[0].id, merged, 'Slideshow');
          }
          mergedResult = merged;
          return merged;
        });
        if (mergedResult) {
          return mergedResult;
        }
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsLoadingSlideshow(false);
        setViewerIndexProgress('');
      }
    },
    [
      buildSlideshowPool,
      isConnected,
      openModalRef,
      setError,
      setViewerIndexProgress,
      slideshowFavoriteFilter,
      slideshowTagFilters.exclude,
      slideshowTagFilters.include,
    ]
  );

  const handleLoadMoreSlideshow = useCallback(async () => {
    await loadSlideshowBatch(slideshowPageSize);
  }, [loadSlideshowBatch, slideshowPageSize]);

  useEffect(() => {
    if (page !== 'slideshow') {
      return;
    }
    resetSlideshow();
  }, [page, resetSlideshow]);

  useEffect(() => {
    if (page !== 'slideshow') {
      return;
    }
    resetSlideshow();
  }, [
    page,
    resetSlideshow,
    slideshowFavoriteFilter,
    slideshowTagFilters.exclude,
    slideshowTagFilters.include,
  ]);

  const handleStartSlideshow = useCallback(async () => {
    setSlideshowStarted(true);
    if (slideshowImages.length > 0) {
      openModalRef.current(slideshowImages[0].id, slideshowImages, 'Slideshow');
      return;
    }
    await loadSlideshowBatch(slideshowPageSize, { openModal: true });
  }, [loadSlideshowBatch, openModalRef, slideshowImages, slideshowPageSize]);

  return {
    slideshowImages,
    isLoadingSlideshow,
    slideshowStarted,
    slideshowImagesRef,
    slideshowImageSetRef,
    loadSlideshowBatch,
    handleLoadMoreSlideshow,
    handleStartSlideshow,
  };
}
