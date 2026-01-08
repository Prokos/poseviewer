import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PoseSet } from '../../metadata';
import type { DriveImage } from '../../drive/types';

type ApplyModalSnapshot = (snapshot: {
  items: DriveImage[];
  label: string;
  imageId: string | null;
  index: number | null;
  contextSetId?: string | null;
}) => void;

type UseModalHistoryOptions = {
  activeSet: PoseSet | null;
  allPageSize: number;
  modalContextLabel: string;
  modalContextSetId: string | null;
  modalImageId: string | null;
  modalIndex: number | null;
  modalItems: DriveImage[];
  setsById: Map<string, PoseSet>;
  viewerSort: 'random' | 'chronological';
  slideshowImageSetRef: MutableRefObject<Map<string, string>>;
  resolveSetImages: (
    set: PoseSet,
    buildIfMissing: boolean,
    options?: { suppressProgress?: boolean }
  ) => Promise<DriveImage[]>;
  setActiveImages: Dispatch<SetStateAction<DriveImage[]>>;
  setError: (message: string) => void;
  setImageLimit: Dispatch<SetStateAction<number>>;
  prefetchThumbs: (images: DriveImage[]) => void;
  updateFavoriteImagesFromSource: (
    setId: string,
    images: DriveImage[],
    favoriteIds: string[],
    options?: { keepLength?: boolean }
  ) => void;
  applyModalContext: ApplyModalSnapshot;
};

export function useModalHistory({
  activeSet,
  allPageSize,
  modalContextLabel,
  modalContextSetId,
  modalImageId,
  modalIndex,
  modalItems,
  setsById,
  viewerSort,
  slideshowImageSetRef,
  resolveSetImages,
  setActiveImages,
  setError,
  setImageLimit,
  prefetchThumbs,
  updateFavoriteImagesFromSource,
  applyModalContext,
}: UseModalHistoryOptions) {
  const [modalHasHistory, setModalHasHistory] = useState(false);
  const modalHistoryRef = useRef<{
    items: DriveImage[];
    label: string;
    imageId: string | null;
    index: number | null;
    contextSetId?: string | null;
  } | null>(null);

  const openModalChronologicalContext = useCallback(async () => {
    if (!modalImageId) {
      return;
    }
    if (
      modalContextLabel !== 'Set' &&
      modalContextLabel !== 'Favorites' &&
      modalContextLabel !== 'Non favorites' &&
      modalContextLabel !== 'Slideshow'
    ) {
      return;
    }
    if (modalContextLabel === 'Set' && viewerSort === 'chronological') {
      return;
    }
    const contextSetId =
      modalContextLabel === 'Slideshow'
        ? slideshowImageSetRef.current.get(modalImageId) ?? null
        : activeSet?.id ?? null;
    const contextSet = contextSetId ? setsById.get(contextSetId) : null;
    if (!contextSet) {
      return;
    }
    modalHistoryRef.current = {
      items: modalItems,
      label: modalContextLabel,
      imageId: modalImageId,
      index: modalIndex,
      contextSetId: modalContextSetId,
    };
    setModalHasHistory(true);
    setError('');
    try {
      const images = await resolveSetImages(contextSet, true);
      if (images.length === 0) {
        return;
      }
      const index = images.findIndex((image) => image.id === modalImageId);
      if (index < 0) {
        return;
      }
      const preload = 5;
      const end = Math.min(images.length, index + preload + 1);
      const start = Math.max(0, index - preload);
      const nextLimit = Math.max(end, allPageSize);
      prefetchThumbs(images.slice(start, end));
      if (viewerSort === 'chronological') {
        setImageLimit(nextLimit);
        setActiveImages(images.slice(0, nextLimit));
        if (activeSet?.id === contextSet.id) {
          updateFavoriteImagesFromSource(
            contextSet.id,
            images,
            contextSet.favoriteImageIds ?? [],
            { keepLength: true }
          );
        }
      }
      applyModalContext({
        items: images.slice(0, nextLimit),
        label: 'Set',
        imageId: modalImageId,
        index,
        contextSetId: contextSet.id,
      });
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [
    activeSet,
    allPageSize,
    applyModalContext,
    modalContextLabel,
    modalContextSetId,
    modalImageId,
    modalIndex,
    modalItems,
    prefetchThumbs,
    resolveSetImages,
    setActiveImages,
    setError,
    setImageLimit,
    setsById,
    slideshowImageSetRef,
    viewerSort,
    updateFavoriteImagesFromSource,
  ]);

  const restoreModalContext = useCallback(() => {
    if (!modalHistoryRef.current) {
      return;
    }
    const previous = modalHistoryRef.current;
    modalHistoryRef.current = null;
    setModalHasHistory(false);
    applyModalContext(previous);
  }, [applyModalContext, modalContextLabel, modalContextSetId, modalImageId, modalIndex, modalItems]);

  const resetModalHistory = useCallback(() => {
    modalHistoryRef.current = null;
    setModalHasHistory(false);
  }, []);

  return {
    modalHasHistory,
    openModalChronologicalContext,
    restoreModalContext,
    resetModalHistory,
  };
}
