import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Dispatch,
  MouseEvent,
  MutableRefObject,
  PointerEvent,
  RefObject,
  SetStateAction,
  TouchEvent,
  WheelEvent,
} from 'react';
import type { PoseSet } from '../metadata';
import type { DriveImage } from '../drive/types';
import { appendUniqueImages } from '../utils/imageSampling';
import { useModalTimer } from '../features/modal/useModalTimer';
import { useModalMedia } from '../features/modal/useModalMedia';
import { useModalGestures } from '../features/modal/useModalGestures';
import { useModalHistory } from '../features/modal/useModalHistory';

type ResolveSetImages = (
  set: PoseSet,
  buildIfMissing: boolean,
  options?: { suppressProgress?: boolean }
) => Promise<DriveImage[]>;

type UpdateFavoritesFromSource = (
  setId: string,
  images: DriveImage[],
  favoriteIds: string[],
  options?: { keepLength?: boolean }
) => void;

type LoadSlideshowBatch = (
  count: number,
  options?: { openModal?: boolean }
) => Promise<DriveImage[] | void>;

export type ModalDeps = {
  activeSet: PoseSet | null;
  setsById: Map<string, PoseSet>;
  activeImages: DriveImage[];
  setActiveImages: Dispatch<SetStateAction<DriveImage[]>>;
  setImageLimit: Dispatch<SetStateAction<number>>;
  allPageSize: number;
  samplePageSize: number;
  favoriteImages: DriveImage[];
  setFavoriteImages: Dispatch<SetStateAction<DriveImage[]>>;
  setSampleImages: Dispatch<SetStateAction<DriveImage[]>>;
  setNonFavoriteImages: Dispatch<SetStateAction<DriveImage[]>>;
  readImageListCache: (setId: string) => DriveImage[] | null;
  filterFavorites: (images: DriveImage[], favoriteIds: string[]) => DriveImage[];
  filterNonFavorites: (images: DriveImage[], favoriteIds: string[]) => DriveImage[];
  pickNextSample: (setId: string, images: DriveImage[], count: number) => DriveImage[];
  pickNextFavorites: (setId: string, images: DriveImage[], count: number) => DriveImage[];
  pickNextNonFavorites: (setId: string, images: DriveImage[], count: number) => DriveImage[];
  resolveSetImages: ResolveSetImages;
  updateFavoriteImagesFromSource: UpdateFavoritesFromSource;
  handleLoadMoreImages: () => Promise<void>;
  isLoadingMore: boolean;
  toggleFavoriteImage: (setId: string, imageId: string) => void | Promise<void>;
  loadSlideshowBatch: LoadSlideshowBatch;
  slideshowImagesRef: MutableRefObject<DriveImage[]>;
  slideshowImageSetRef: MutableRefObject<Map<string, string>>;
  slideshowPageSize: number;
  prefetchThumbs: (images: DriveImage[]) => void;
  setError: (message: string) => void;
};

export type ModalViewerState = {
  modalImage: DriveImage | null;
  modalItems: DriveImage[];
  modalIndex: number | null;
  modalContextLabel: string;
  modalContextSetId: string | null;
  modalSetId: string | null;
  modalIsFavorite: boolean;
  modalIsLoading: boolean;
  modalPulse: boolean;
  modalFavoritePulse: null | 'add' | 'remove';
  modalFullSrc: string | null;
  modalFullImageId: string | null;
  modalFullAnimate: boolean;
  modalZoom: number;
  modalPan: { x: number; y: number };
  modalControlsVisible: boolean;
  modalShake: boolean;
  modalSwipeAction: null | 'close' | 'favorite' | 'prev' | 'next';
  modalSwipeProgress: number;
  modalTimerMs: number;
  modalTimerProgress: number;
  isModalTimerOpen: boolean;
  modalTimerFade: boolean;
  modalHasHistory: boolean;
  modalTimerOptions: Array<{ label: string; value: number }>;
  modalTotalImagesKnown?: number;
  totalImages: number;
  favoritesCount: number;
  nonFavoritesCount?: number;
  canGoPrevModal: boolean;
  canGoNextModal: boolean;
  modalMediaRef: RefObject<HTMLDivElement>;
  onModalFullLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onModalWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onModalPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onModalPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onModalPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onModalMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onModalTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onModalTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onModalTouchEnd: () => void;
  onSelectModalTimer: (value: number) => void;
  onResetModalTimer: () => void;
  onToggleTimerMenu: () => void;
  onOpenChronologicalContext: () => void;
  onRestoreModalContext: () => void;
  onToggleFavoriteFromModal: () => void;
  onPrevImage: () => void;
  onNextImage: (options?: { suppressControls?: boolean }) => void;
  onCloseModal: () => void;
};

export function useModalViewer({
  activeSet,
  setsById,
  activeImages,
  setActiveImages,
  setImageLimit,
  allPageSize,
  samplePageSize,
  favoriteImages,
  setFavoriteImages,
  setSampleImages,
  setNonFavoriteImages,
  readImageListCache,
  resolveSetImages,
  updateFavoriteImagesFromSource,
  handleLoadMoreImages,
  toggleFavoriteImage,
  loadSlideshowBatch,
  slideshowImagesRef,
  slideshowImageSetRef,
  slideshowPageSize,
  prefetchThumbs,
  setError,
  filterFavorites,
  filterNonFavorites,
  pickNextSample,
  pickNextFavorites,
  pickNextNonFavorites,
  isLoadingMore,
}: ModalDeps) {
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [modalImageId, setModalImageId] = useState<string | null>(null);
  const [modalItems, setModalItems] = useState<DriveImage[]>([]);
  const [modalContextLabel, setModalContextLabel] = useState('');
  const [modalContextSetId, setModalContextSetId] = useState<string | null>(null);
  const [modalPulse, setModalPulse] = useState(false);
  const [modalFavoritePulse, setModalFavoritePulse] = useState<null | 'add' | 'remove'>(null);
  const [modalLoadKey, setModalLoadKey] = useState(0);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
  const [modalControlsVisible, setModalControlsVisible] = useState(true);
  const [modalShake, setModalShake] = useState(false);

  const modalPendingAdvanceRef = useRef(false);
  const modalItemsLengthRef = useRef(0);
  const modalPulseTimeout = useRef<number | null>(null);
  const modalFavoritePulseTimeout = useRef<number | null>(null);
  const modalControlsTimeoutRef = useRef<number | null>(null);
  const modalShakeTimeoutRef = useRef<number | null>(null);
  const goNextImageRef = useRef<(options?: { suppressControls?: boolean }) => void>(() => {});
  const sampleHistoryRef = useRef<DriveImage[]>([]);
  const sampleHistorySetRef = useRef<string | null>(null);
  const sampleAppendInFlightRef = useRef(false);
  const favoriteAppendInFlightRef = useRef(false);
  const nonFavoriteAppendInFlightRef = useRef(false);
  const slideshowAppendInFlightRef = useRef(false);

  const {
    modalTimerMs,
    modalTimerProgress,
    isModalTimerOpen,
    modalTimerFade,
    modalTimerOptions,
    onSelectModalTimer,
    onResetModalTimer,
    onToggleTimerMenu,
    pauseModalTimer,
    scheduleModalTimerResume,
    resetModalTimerState,
  } = useModalTimer({
    modalImageId,
    goNextImageRef,
    setModalControlsVisible,
  });

  const {
    modalIsLoading,
    modalFullSrc,
    modalFullImageId,
    modalFullAnimate,
    modalImageSizeRef,
    onModalFullLoad,
    resetModalMediaState,
    stopModalLoading,
    clearModalMediaCache,
  } = useModalMedia({
    modalImageId,
    modalIndex,
    modalItems,
    modalLoadKey,
    prefetchThumbs,
    setError,
  });

  const modalImage =
    modalIndex !== null && modalIndex >= 0 && modalIndex < modalItems.length
      ? modalItems[modalIndex]
      : null;

  const modalSetId =
    modalContextLabel === 'Set'
      ? modalContextSetId ?? activeSet?.id ?? null
      : modalImage && modalContextLabel === 'Slideshow'
        ? slideshowImageSetRef.current.get(modalImage.id) ?? null
        : activeSet?.id ?? null;

  const modalSet = modalSetId ? setsById.get(modalSetId) : activeSet;
  const modalIsFavorite =
    modalImage && modalSet ? (modalSet.favoriteImageIds ?? []).includes(modalImage.id) : false;

  const cachedCount = activeSet ? readImageListCache(activeSet.id)?.length : undefined;
  const totalImagesKnown = activeSet?.imageCount ?? cachedCount;
  const totalImages = totalImagesKnown ?? activeImages.length;
  const modalTotalImagesKnown =
    modalContextLabel === 'Set' && modalContextSetId
      ? modalSet?.imageCount ?? readImageListCache(modalContextSetId)?.length
      : totalImagesKnown;
  const modalRemainingImages =
    modalTotalImagesKnown !== undefined
      ? Math.max(0, modalTotalImagesKnown - modalItems.length)
      : undefined;
  const favoritesCount = activeSet?.favoriteImageIds?.length ?? 0;
  const nonFavoritesCount =
    totalImagesKnown !== undefined ? Math.max(0, totalImagesKnown - favoritesCount) : undefined;

  const canGoPrevModal = modalIndex !== null && modalIndex > 0;
  const canGoNextModal =
    modalIndex !== null &&
    (modalIndex < modalItems.length - 1 ||
      (modalContextLabel === 'Set' && !!modalRemainingImages) ||
      (modalContextLabel === 'Sample' && !!activeSet) ||
      (modalContextLabel === 'Favorites' && !!activeSet) ||
      (modalContextLabel === 'Non favorites' && !!activeSet) ||
      modalContextLabel === 'Slideshow');

  const scheduleModalControlsHide = useCallback(
    (force = false) => {
      if (!force && (modalTimerMs > 0 || isModalTimerOpen)) {
        return;
      }
      setModalControlsVisible(true);
      if (modalControlsTimeoutRef.current) {
        window.clearTimeout(modalControlsTimeoutRef.current);
      }
      modalControlsTimeoutRef.current = window.setTimeout(() => {
        setModalControlsVisible(false);
      }, 2000);
    },
    [isModalTimerOpen, modalTimerMs]
  );

  useEffect(() => {
    if (isModalTimerOpen) {
      if (modalControlsTimeoutRef.current) {
        window.clearTimeout(modalControlsTimeoutRef.current);
        modalControlsTimeoutRef.current = null;
      }
      setModalControlsVisible(true);
      pauseModalTimer();
      return;
    }
    scheduleModalTimerResume();
  }, [isModalTimerOpen, pauseModalTimer, scheduleModalTimerResume]);

  const requestViewerFullscreen = () => {
    if (document.fullscreenElement) {
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {
      // Ignore fullscreen failures (unsupported or user gesture blocked).
    });
  };

  const exitViewerFullscreen = () => {
    if (!document.fullscreenElement) {
      return;
    }
    document.exitFullscreen().catch(() => {
      // Ignore fullscreen exit failures.
    });
  };

  const triggerModalPulse = () => {
    setModalPulse(false);
    if (modalPulseTimeout.current) {
      window.clearTimeout(modalPulseTimeout.current);
    }
    modalPulseTimeout.current = window.setTimeout(() => {
      setModalPulse(true);
      modalPulseTimeout.current = window.setTimeout(() => {
        setModalPulse(false);
      }, 220);
    }, 10);
  };

  const triggerFavoritePulse = useCallback((mode: 'add' | 'remove') => {
    setModalFavoritePulse(null);
    if (modalFavoritePulseTimeout.current) {
      window.clearTimeout(modalFavoritePulseTimeout.current);
    }
    modalFavoritePulseTimeout.current = window.setTimeout(() => {
      setModalFavoritePulse(mode);
      modalFavoritePulseTimeout.current = window.setTimeout(() => {
        setModalFavoritePulse(null);
      }, 520);
    }, 10);
  }, []);

  const triggerModalShake = useCallback(() => {
    setModalShake(false);
    if (modalShakeTimeoutRef.current) {
      window.clearTimeout(modalShakeTimeoutRef.current);
    }
    modalShakeTimeoutRef.current = window.setTimeout(() => {
      setModalShake(true);
      modalShakeTimeoutRef.current = window.setTimeout(() => {
        setModalShake(false);
      }, 420);
    }, 10);
  }, []);

  const updateModalItems = useCallback((items: DriveImage[]) => {
    setModalItems(items);
    modalItemsLengthRef.current = items.length;
  }, []);

  const setModalImageAtIndex = useCallback(
    (items: DriveImage[], index: number, options?: { suppressControls?: boolean }) => {
      resetModalMediaState();
      const nextImage = items[index];
      setModalImageId(nextImage?.id ?? null);
      setModalIndex(nextImage ? index : null);
      if (options?.suppressControls) {
        setModalPulse(false);
      } else {
        triggerModalPulse();
      }
    },
    [resetModalMediaState, triggerModalPulse]
  );

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

  const appendSlideshowBatch = useCallback(
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

  const applyModalContext = useCallback(
    (snapshot: {
      items: DriveImage[];
      label: string;
      imageId: string | null;
      index: number | null;
      contextSetId?: string | null;
    }) => {
      updateModalItems(snapshot.items);
      setModalContextLabel(snapshot.label);
      setModalContextSetId(snapshot.contextSetId ?? null);
      setModalImageId(snapshot.imageId);
      setModalIndex(snapshot.index);
      resetModalMediaState();
      setModalLoadKey((key) => key + 1);
      triggerModalPulse();
    },
    [resetModalMediaState, triggerModalPulse, updateModalItems]
  );

  const {
    modalHasHistory,
    openModalChronologicalContext,
    restoreModalContext,
    resetModalHistory,
  } = useModalHistory({
    activeSet,
    allPageSize,
    modalContextLabel,
    modalContextSetId,
    modalImageId,
    modalIndex,
    modalItems,
    setsById,
    slideshowImageSetRef,
    resolveSetImages,
    setActiveImages,
    setError,
    setImageLimit,
    prefetchThumbs,
    updateFavoriteImagesFromSource,
    applyModalContext,
  });

  const openModal = useCallback(
    (imageId: string, items: DriveImage[], label: string) => {
      requestViewerFullscreen();
      scheduleModalControlsHide(true);
      const index = items.findIndex((image) => image.id === imageId);
      updateModalItems(items);
      setModalContextLabel(label);
      setModalContextSetId(label === 'Set' && activeSet ? activeSet.id : null);
      resetModalMediaState();
      if (label === 'Sample' && activeSet) {
        sampleHistoryRef.current = items;
        sampleHistorySetRef.current = activeSet.id;
      } else {
        sampleHistoryRef.current = [];
        sampleHistorySetRef.current = null;
      }
      setModalImageId(imageId);
      setModalIndex(index >= 0 ? index : null);
      triggerModalPulse();
    },
    [activeSet, resetModalMediaState, scheduleModalControlsHide, updateModalItems]
  );

  const closeModal = () => {
    setModalIndex(null);
    setModalImageId(null);
    updateModalItems([]);
    setModalContextLabel('');
    setModalContextSetId(null);
    setModalPulse(false);
    setModalFavoritePulse(null);
    resetModalMediaState();
    stopModalLoading();
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
    resetModalTimerState();
    resetModalHistory();
    sampleHistoryRef.current = [];
    sampleHistorySetRef.current = null;
    sampleAppendInFlightRef.current = false;
    favoriteAppendInFlightRef.current = false;
    nonFavoriteAppendInFlightRef.current = false;
    slideshowAppendInFlightRef.current = false;
    if (modalPulseTimeout.current) {
      window.clearTimeout(modalPulseTimeout.current);
      modalPulseTimeout.current = null;
    }
    if (modalFavoritePulseTimeout.current) {
      window.clearTimeout(modalFavoritePulseTimeout.current);
      modalFavoritePulseTimeout.current = null;
    }
    clearModalMediaCache();
    if (modalControlsTimeoutRef.current) {
      window.clearTimeout(modalControlsTimeoutRef.current);
      modalControlsTimeoutRef.current = null;
    }
    exitViewerFullscreen();
  };

  const toggleFavoriteFromModal = useCallback(() => {
    if (!modalImage) {
      return;
    }
    const setId =
      modalContextLabel === 'Set'
        ? modalContextSetId ?? activeSet?.id
        : modalContextLabel === 'Slideshow'
          ? slideshowImageSetRef.current.get(modalImage.id)
          : activeSet?.id;
    if (!setId) {
      return;
    }
    const set = setsById.get(setId);
    const isFavorite = set?.favoriteImageIds?.includes(modalImage.id) ?? false;
    triggerFavoritePulse(isFavorite ? 'remove' : 'add');
    void toggleFavoriteImage(setId, modalImage.id);
  }, [
    activeSet,
    modalContextLabel,
    modalContextSetId,
    modalImage,
    setsById,
    slideshowImageSetRef,
    toggleFavoriteImage,
    triggerFavoritePulse,
  ]);

  const goNextImage = (options?: { suppressControls?: boolean }) => {
    if (modalItems.length === 0) {
      triggerModalShake();
      return;
    }
    if (options?.suppressControls) {
      setModalControlsVisible(false);
    }
    const currentId = modalImageId;
    const currentIndex = currentId
      ? modalItems.findIndex((image) => image.id === currentId)
      : modalIndex;
    if (currentIndex === null || currentIndex === -1) {
      triggerModalShake();
      return;
    }
    const isLast = currentIndex + 1 >= modalItems.length;
    if (isLast) {
      if (modalContextLabel === 'Sample' && activeSet) {
        void appendModalBatch({
          inFlightRef: sampleAppendInFlightRef,
          transformSource: (source) => source,
          pickNext: pickNextSample,
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
        return;
      }
      if (modalContextLabel === 'Non favorites' && activeSet) {
        void appendModalBatch({
          inFlightRef: nonFavoriteAppendInFlightRef,
          transformSource: (source) =>
            filterNonFavorites(source, activeSet.favoriteImageIds ?? []),
          pickNext: pickNextNonFavorites,
          appendToList: (items) => {
            setNonFavoriteImages((current) => appendUniqueImages(current, items));
          },
          suppressControls: options?.suppressControls,
        });
        return;
      }
      if (modalContextLabel === 'Favorites' && activeSet) {
        void appendModalBatch({
          inFlightRef: favoriteAppendInFlightRef,
          transformSource: (source) => filterFavorites(source, activeSet.favoriteImageIds ?? []),
          pickNext: pickNextFavorites,
          appendToList: (items) => {
            setFavoriteImages((current) => appendUniqueImages(current, items));
          },
          suppressControls: options?.suppressControls,
        });
        return;
      }
      if (modalContextLabel === 'Slideshow') {
        void appendSlideshowBatch(options);
        return;
      }
      if (modalContextLabel === 'Set' && modalRemainingImages !== undefined && modalRemainingImages > 0) {
        if (modalContextSetId && activeSet?.id !== modalContextSetId) {
          if (modalPendingAdvanceRef.current) {
            return;
          }
          modalPendingAdvanceRef.current = true;
          const contextSet = setsById.get(modalContextSetId);
          if (!contextSet) {
            modalPendingAdvanceRef.current = false;
            triggerModalShake();
            return;
          }
          (async () => {
            const images = await resolveSetImages(contextSet, true);
            if (images.length === 0) {
              return;
            }
            const nextIndex = modalItems.length;
            const nextLimit = Math.min(images.length, nextIndex + allPageSize);
            const nextItems = images.slice(0, nextLimit);
            if (nextItems.length <= modalItems.length) {
              return;
            }
            updateModalItems(nextItems);
            setModalImageAtIndex(nextItems, nextIndex, options);
          })()
            .catch((error) => {
              setError((error as Error).message);
            })
            .finally(() => {
              modalPendingAdvanceRef.current = false;
            });
          return;
        }
        if (!isLoadingMore && activeSet) {
          modalPendingAdvanceRef.current = true;
          void handleLoadMoreImages();
          return;
        }
      }
      triggerModalShake();
      return;
    }
    const nextIndex = currentIndex + 1;
    setModalImageAtIndex(modalItems, nextIndex, options);
  };

  const goPrevImage = () => {
    if (modalItems.length === 0) {
      triggerModalShake();
      return;
    }
    const currentId = modalImageId;
    const currentIndex = currentId
      ? modalItems.findIndex((image) => image.id === currentId)
      : modalIndex;
    if (currentIndex === null || currentIndex === -1) {
      triggerModalShake();
      return;
    }
    const isFirst = currentIndex - 1 < 0;
    if (isFirst) {
      triggerModalShake();
      return;
    }
    const nextIndex = currentIndex - 1;
    setModalImageAtIndex(modalItems, nextIndex);
  };

  const {
    modalSwipeAction,
    modalSwipeProgress,
    modalMediaRef,
    handleModalWheel,
    handleModalPointerDown,
    handleModalPointerMove,
    handleModalPointerUp,
    handleModalMouseMove,
    handleModalTouchStart,
    handleModalTouchMove,
    handleModalTouchEnd,
  } = useModalGestures({
    modalImageId,
    modalZoom,
    modalPan,
    setModalZoom,
    setModalPan,
    modalImageSizeRef,
    scheduleModalControlsHide,
    pauseModalTimer,
    scheduleModalTimerResume,
    goPrevImage,
    goNextImage,
    onToggleFavoriteFromModal: toggleFavoriteFromModal,
    onCloseModal: closeModal,
  });

  useEffect(() => {
    goNextImageRef.current = goNextImage;
  }, [goNextImage]);

  useEffect(() => {
    if (modalIndex === null) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f') {
        toggleFavoriteFromModal();
      }
      if (event.key.toLowerCase() === 'c') {
        if (modalContextLabel === 'Set' && modalHasHistory) {
          restoreModalContext();
        } else if (activeSet && modalContextLabel !== 'Set') {
          void openModalChronologicalContext();
        }
      }
      if (event.key === 'Escape') {
        closeModal();
      }
      if (event.key === 'ArrowRight') {
        goNextImage();
      }
      if (event.key === 'ArrowLeft') {
        goPrevImage();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [
    activeSet,
    closeModal,
    goNextImage,
    goPrevImage,
    modalContextLabel,
    modalHasHistory,
    modalIndex,
    openModalChronologicalContext,
    restoreModalContext,
    toggleFavoriteFromModal,
  ]);

  useEffect(() => {
    return () => {
      if (modalPulseTimeout.current) {
        window.clearTimeout(modalPulseTimeout.current);
      }
      if (modalFavoritePulseTimeout.current) {
        window.clearTimeout(modalFavoritePulseTimeout.current);
      }
      if (modalControlsTimeoutRef.current) {
        window.clearTimeout(modalControlsTimeoutRef.current);
      }
      if (modalShakeTimeoutRef.current) {
        window.clearTimeout(modalShakeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      modalContextLabel !== 'Set' ||
      !modalPendingAdvanceRef.current ||
      (modalContextSetId && activeSet?.id !== modalContextSetId) ||
      modalItems.length >= activeImages.length ||
      activeImages.length === 0
    ) {
      return;
    }
    const previousLength = modalItemsLengthRef.current;
    const nextImage = activeImages[previousLength];
    if (!nextImage) {
      return;
    }
    updateModalItems(activeImages);
    modalPendingAdvanceRef.current = false;
    setModalImageAtIndex(activeImages, previousLength);
  }, [
    activeImages,
    activeSet?.id,
    modalContextLabel,
    modalContextSetId,
    modalItems.length,
    setModalImageAtIndex,
    updateModalItems,
  ]);

  const modalState: ModalViewerState = {
    modalImage,
    modalItems,
    modalIndex,
    modalContextLabel,
    modalContextSetId,
    modalSetId,
    modalIsFavorite,
    modalIsLoading,
    modalPulse,
    modalFavoritePulse,
    modalFullSrc,
    modalFullImageId,
    modalFullAnimate,
    modalZoom,
    modalPan,
    modalControlsVisible,
    modalShake,
    modalSwipeAction,
    modalSwipeProgress,
    modalTimerMs,
    modalTimerProgress,
    isModalTimerOpen,
    modalTimerFade,
    modalHasHistory,
    modalTimerOptions,
    modalTotalImagesKnown,
    totalImages,
    favoritesCount,
    nonFavoritesCount,
    canGoPrevModal,
    canGoNextModal,
    modalMediaRef,
    onModalFullLoad,
    onModalWheel: handleModalWheel,
    onModalPointerDown: handleModalPointerDown,
    onModalPointerMove: handleModalPointerMove,
    onModalPointerUp: handleModalPointerUp,
    onModalMouseMove: handleModalMouseMove,
    onModalTouchStart: handleModalTouchStart,
    onModalTouchMove: handleModalTouchMove,
    onModalTouchEnd: handleModalTouchEnd,
    onSelectModalTimer,
    onResetModalTimer,
    onToggleTimerMenu,
    onOpenChronologicalContext: openModalChronologicalContext,
    onRestoreModalContext: restoreModalContext,
    onToggleFavoriteFromModal: toggleFavoriteFromModal,
    onPrevImage: goPrevImage,
    onNextImage: goNextImage,
    onCloseModal: closeModal,
  };

  return { modalState, openModal, closeModal };
}
