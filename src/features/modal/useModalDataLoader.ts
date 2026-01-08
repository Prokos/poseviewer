import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DriveImage } from '../../drive/types';
import type { PoseSet } from '../../metadata';
import { appendUniqueImages } from '../../utils/imageSampling';

type UseModalDataLoaderOptions = {
  activeSet: PoseSet | null;
  modalItems: DriveImage[];
  samplePageSize: number;
  readImageListCache: (setId: string) => DriveImage[] | null;
  resolveSetImages: (
    set: PoseSet,
    buildIfMissing: boolean,
    options?: { suppressProgress?: boolean }
  ) => Promise<DriveImage[]>;
  setError: (message: string) => void;
  setModalImageAtIndex: (
    items: DriveImage[],
    index: number,
    options?: { suppressControls?: boolean }
  ) => void;
  updateModalItems: (items: DriveImage[]) => void;
  filterImagesByFavoriteStatus: (
    images: DriveImage[],
    favoriteIds: string[],
    mode: 'favorites' | 'nonfavorites' | 'all'
  ) => DriveImage[];
  pickNext: {
    sample: (setId: string, images: DriveImage[], count: number) => DriveImage[];
    favorites: (setId: string, images: DriveImage[], count: number) => DriveImage[];
    nonFavorites: (setId: string, images: DriveImage[], count: number) => DriveImage[];
  };
  setSampleImages: Dispatch<SetStateAction<DriveImage[]>>;
  setFavoriteImages: Dispatch<SetStateAction<DriveImage[]>>;
  setNonFavoriteImages: Dispatch<SetStateAction<DriveImage[]>>;
  sampleHistoryRef: MutableRefObject<DriveImage[]>;
  sampleHistorySetRef: MutableRefObject<string | null>;
  loadSlideshowBatch: (
    count: number,
    options?: { openModal?: boolean }
  ) => Promise<DriveImage[] | void>;
  slideshowImagesRef: MutableRefObject<DriveImage[]>;
  slideshowPageSize: number;
};

export function useModalDataLoader({
  activeSet,
  modalItems,
  samplePageSize,
  readImageListCache,
  resolveSetImages,
  setError,
  setModalImageAtIndex,
  updateModalItems,
  filterImagesByFavoriteStatus,
  pickNext,
  setSampleImages,
  setFavoriteImages,
  setNonFavoriteImages,
  sampleHistoryRef,
  sampleHistorySetRef,
  loadSlideshowBatch,
  slideshowImagesRef,
  slideshowPageSize,
}: UseModalDataLoaderOptions) {
  const sampleAppendInFlightRef = useRef(false);
  const favoriteAppendInFlightRef = useRef(false);
  const nonFavoriteAppendInFlightRef = useRef(false);
  const slideshowAppendInFlightRef = useRef(false);

  const appendModalBatch = useCallback(
    async (options: {
      inFlightRef: MutableRefObject<boolean>;
      transformSource: (source: DriveImage[], setId: string) => DriveImage[];
      pickNext: (setId: string, images: DriveImage[], count: number) => DriveImage[];
      appendToList: (items: DriveImage[]) => void;
      beforeAppend?: (setId: string) => boolean;
      onUpdated?: (items: DriveImage[], setId: string) => void;
      suppressControls?: boolean;
    }) => {
      if (!activeSet) {
        return false;
      }
      if (options.inFlightRef.current) {
        return false;
      }
      options.inFlightRef.current = true;
      const setId = activeSet.id;
      try {
        if (options.beforeAppend && !options.beforeAppend(setId)) {
          return false;
        }
        const source =
          readImageListCache(setId) ?? (await resolveSetImages(activeSet, true));
        if (!source || source.length === 0) {
          return false;
        }
        const scopedSource = options.transformSource(source, setId);
        if (scopedSource.length === 0) {
          return false;
        }
        const nextBatch = options.pickNext(setId, scopedSource, samplePageSize);
        if (nextBatch.length === 0) {
          return false;
        }
        const existingIds = new Set(modalItems.map((item) => item.id));
        const deduped = nextBatch.filter((item) => !existingIds.has(item.id));
        if (deduped.length === 0) {
          return false;
        }
        const updated = [...modalItems, ...deduped];
        updateModalItems(updated);
        options.appendToList(deduped);
        options.onUpdated?.(updated, setId);
        const nextIndex = updated.length - deduped.length;
        setModalImageAtIndex(updated, nextIndex, {
          suppressControls: options.suppressControls,
        });
        return true;
      } catch (error) {
        setError((error as Error).message);
        return false;
      } finally {
        options.inFlightRef.current = false;
      }
    },
    [
      activeSet,
      modalItems,
      readImageListCache,
      resolveSetImages,
      samplePageSize,
      setError,
      setModalImageAtIndex,
      updateModalItems,
    ]
  );

  const appendSample = useCallback(
    async (options?: { suppressControls?: boolean }) => {
      return appendModalBatch({
        inFlightRef: sampleAppendInFlightRef,
        transformSource: (source) => source,
        pickNext: pickNext.sample,
        appendToList: (items) => {
          setSampleImages((current) => appendUniqueImages(current, items));
        },
        beforeAppend: (setId) =>
          !sampleHistorySetRef.current || sampleHistorySetRef.current === setId,
        onUpdated: (items, setId) => {
          sampleHistoryRef.current = items;
          sampleHistorySetRef.current = setId;
        },
        suppressControls: options?.suppressControls,
      });
    },
    [
      appendModalBatch,
      pickNext,
      sampleHistoryRef,
      sampleHistorySetRef,
      setSampleImages,
    ]
  );

  const appendNonFavorites = useCallback(
    async (options?: { suppressControls?: boolean }) => {
      return appendModalBatch({
        inFlightRef: nonFavoriteAppendInFlightRef,
        transformSource: (source) =>
          filterImagesByFavoriteStatus(source, activeSet?.favoriteImageIds ?? [], 'nonfavorites'),
        pickNext: pickNext.nonFavorites,
        appendToList: (items) => {
          setNonFavoriteImages((current) => appendUniqueImages(current, items));
        },
        suppressControls: options?.suppressControls,
      });
    },
    [
      activeSet?.favoriteImageIds,
      appendModalBatch,
      filterImagesByFavoriteStatus,
      pickNext,
      setNonFavoriteImages,
    ]
  );

  const appendFavorites = useCallback(
    async (options?: { suppressControls?: boolean }) => {
      return appendModalBatch({
        inFlightRef: favoriteAppendInFlightRef,
        transformSource: (source) =>
          filterImagesByFavoriteStatus(source, activeSet?.favoriteImageIds ?? [], 'favorites'),
        pickNext: pickNext.favorites,
        appendToList: (items) => {
          setFavoriteImages((current) => appendUniqueImages(current, items));
        },
        suppressControls: options?.suppressControls,
      });
    },
    [
      activeSet?.favoriteImageIds,
      appendModalBatch,
      filterImagesByFavoriteStatus,
      pickNext,
      setFavoriteImages,
    ]
  );

  const appendSlideshow = useCallback(
    async (options?: { suppressControls?: boolean }) => {
      if (slideshowAppendInFlightRef.current) {
        return false;
      }
      slideshowAppendInFlightRef.current = true;
      try {
        const updated =
          (await loadSlideshowBatch(slideshowPageSize)) ?? slideshowImagesRef.current;
        const nextIndex = modalItems.length;
        if (!updated[nextIndex]) {
          return false;
        }
        updateModalItems(updated);
        setModalImageAtIndex(updated, nextIndex, options);
        return true;
      } catch (error) {
        setError((error as Error).message);
        return false;
      } finally {
        slideshowAppendInFlightRef.current = false;
      }
    },
    [
      loadSlideshowBatch,
      modalItems.length,
      setError,
      setModalImageAtIndex,
      slideshowImagesRef,
      slideshowPageSize,
      updateModalItems,
    ]
  );

  const resetInFlight = useCallback(() => {
    sampleAppendInFlightRef.current = false;
    favoriteAppendInFlightRef.current = false;
    nonFavoriteAppendInFlightRef.current = false;
    slideshowAppendInFlightRef.current = false;
  }, []);

  return {
    appendSample,
    appendFavorites,
    appendNonFavorites,
    appendSlideshow,
    resetInFlight,
  };
}
