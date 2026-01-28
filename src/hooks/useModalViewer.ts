import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Dispatch,
  MouseEvent,
  MutableRefObject,
  PointerEvent,
  RefObject,
  SetStateAction,
  SyntheticEvent,
  TouchEvent,
  WheelEvent,
} from 'react';
import type { FavoriteFilterMode } from '../utils/imageSampling';
import type { PoseSet } from '../metadata';
import type { DriveImage } from '../drive/types';
import type { ModalOpenOptions } from '../features/modal/types';
import { useModalTimer } from '../features/modal/useModalTimer';
import { useModalMedia } from '../features/modal/useModalMedia';
import { useModalGestures } from '../features/modal/useModalGestures';
import { useModalHistory } from '../features/modal/useModalHistory';
import { useModalDataLoader } from '../features/modal/useModalDataLoader';
import { useModalState } from '../features/modal/useModalState';
import { useImageCache } from '../features/imageCache/ImageCacheContext';

type ResolveSetImages = (
  set: PoseSet,
  buildIfMissing: boolean,
  options?: { suppressProgress?: boolean }
) => Promise<DriveImage[]>;

type UpdateFavoritesFromSource = (
  setId: string,
  images: DriveImage[],
  favoriteIds: string[],
  hiddenIds: string[],
  options?: { keepLength?: boolean }
) => void;

type LoadSlideshowBatch = (
  count: number,
  options?: { openModal?: boolean }
) => Promise<DriveImage[] | void>;

export type ModalDeps = {
  activeSet: PoseSet | null;
  setsById: Map<string, PoseSet>;
  viewerSort: 'random' | 'chronological';
  activeImages: DriveImage[];
  setActiveImages: Dispatch<SetStateAction<DriveImage[]>>;
  setImageLimit: Dispatch<SetStateAction<number>>;
  allPageSize: number;
  samplePageSize: number;
  favoriteImages: DriveImage[];
  setFavoriteImages: Dispatch<SetStateAction<DriveImage[]>>;
  setSampleImages: Dispatch<SetStateAction<DriveImage[]>>;
  setNonFavoriteImages: Dispatch<SetStateAction<DriveImage[]>>;
  setHiddenImages: Dispatch<SetStateAction<DriveImage[]>>;
  readImageListCache: (setId: string) => DriveImage[] | null;
  filterImagesByFavoriteStatus: (
    images: DriveImage[],
    favoriteIds: string[],
    mode: FavoriteFilterMode
  ) => DriveImage[];
  filterImagesByHiddenStatus: (
    images: DriveImage[],
    hiddenIds: string[],
    mode: 'hidden' | 'visible' | 'all'
  ) => DriveImage[];
  pickNext: {
    sample: (setId: string, images: DriveImage[], count: number) => DriveImage[];
    favorites: (setId: string, images: DriveImage[], count: number) => DriveImage[];
    nonFavorites: (setId: string, images: DriveImage[], count: number) => DriveImage[];
    hidden: (setId: string, images: DriveImage[], count: number) => DriveImage[];
  };
  resolveSetImages: ResolveSetImages;
  updateFavoriteImagesFromSource: UpdateFavoritesFromSource;
  handleLoadMoreImages: () => Promise<void>;
  isLoadingMore: boolean;
  toggleFavoriteImage: (setId: string, imageId: string) => void | Promise<void>;
  toggleHiddenImage: (setId: string, imageId: string) => void | Promise<void>;
  loadSlideshowBatch: LoadSlideshowBatch;
  slideshowImagesRef: MutableRefObject<DriveImage[]>;
  slideshowImageSetRef: MutableRefObject<Map<string, string>>;
  slideshowPageSize: number;
  prefetchThumbs: (images: DriveImage[]) => void;
  setError: (message: string) => void;
  rotateImage: (fileId: string, angle: 90 | -90) => Promise<void>;
};

export type ModalViewerState = {
  modalImage: DriveImage | null;
  modalItems: DriveImage[];
  modalIndex: number | null;
  modalContextLabel: string;
  modalContextSetId: string | null;
  modalSetId: string | null;
  modalSetName: string | null;
  isModalInfoOpen: boolean;
  viewerSort: 'random' | 'chronological';
  modalIsFavorite: boolean;
  modalIsHidden: boolean;
  modalIsLoading: boolean;
  modalLoadingCount: number;
  modalPulse: boolean;
  modalFavoritePulse: null | 'add' | 'remove';
  modalHiddenPulse: null | 'hide' | 'unhide';
  modalIsRotating: boolean;
  modalRotateStatus: null | {
    state: 'rotating' | 'done' | 'error';
    angle: 90 | -90;
    message?: string;
  };
  modalFullSrc: string | null;
  modalFullImageId: string | null;
  modalFullAnimate: boolean;
  modalZoom: number;
  modalPan: { x: number; y: number };
  modalControlsVisible: boolean;
  modalShake: boolean;
  modalSwipeAction: null | 'close' | 'favorite' | 'prev' | 'next';
  modalSwipeProgress: number;
  isMouseZoomMode: boolean;
  modalTimerMs: number;
  modalTimerProgress: number;
  isModalTimerOpen: boolean;
  modalTimerFade: boolean;
  modalTimerPulse: null | 'pause' | 'play';
  modalHasHistory: boolean;
  modalTimerOptions: Array<{ label: string; value: number }>;
  modalTotalImagesKnown?: number;
  totalImages: number;
  favoritesCount: number;
  hiddenCount: number;
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
  onToggleInfoMenu: () => void;
  onCloseInfoMenu: () => void;
  onOpenChronologicalContext: () => void;
  onRestoreModalContext: () => void;
  onToggleFavoriteFromModal: () => void;
  onToggleHiddenFromModal: () => void;
  onRotateModalImage: (angle: 90 | -90) => void;
  onPrevImage: () => void;
  onNextImage: (options?: { suppressControls?: boolean }) => void;
  onCloseModal: () => void;
};

export function useModalViewer({
  activeSet,
  setsById,
  viewerSort,
  activeImages,
  setActiveImages,
  setImageLimit,
  allPageSize,
  samplePageSize,
  favoriteImages,
  setFavoriteImages,
  setSampleImages,
  setNonFavoriteImages,
  setHiddenImages,
  readImageListCache,
  resolveSetImages,
  updateFavoriteImagesFromSource,
  handleLoadMoreImages,
  toggleFavoriteImage,
  toggleHiddenImage,
  loadSlideshowBatch,
  slideshowImagesRef,
  slideshowImageSetRef,
  slideshowPageSize,
  prefetchThumbs,
  setError,
  filterImagesByFavoriteStatus,
  filterImagesByHiddenStatus,
  pickNext,
  isLoadingMore,
  rotateImage,
}: ModalDeps) {
  const { cacheKey, bumpImageVersion, getImageVersion } = useImageCache();
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [modalImageId, setModalImageId] = useState<string | null>(null);
  const [modalItems, setModalItems] = useState<DriveImage[]>([]);
  const [modalContextLabel, setModalContextLabel] = useState('');
  const [modalContextSetId, setModalContextSetId] = useState<string | null>(null);
  const [modalPulse, setModalPulse] = useState(false);
  const [modalFavoritePulse, setModalFavoritePulse] = useState<null | 'add' | 'remove'>(null);
  const [modalHiddenPulse, setModalHiddenPulse] = useState<null | 'hide' | 'unhide'>(null);
  const [modalTimerPulse, setModalTimerPulse] = useState<null | 'pause' | 'play'>(null);
  const [modalLoadKey, setModalLoadKey] = useState(0);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
  const [modalControlsVisible, setModalControlsVisible] = useState(true);
  const [modalShake, setModalShake] = useState(false);
  const [isModalInfoOpen, setIsModalInfoOpen] = useState(false);
  const [isMouseZoomMode, setIsMouseZoomMode] = useState(false);
  const [rotateStatusById, setRotateStatusById] = useState<
    Record<string, { state: 'rotating' | 'done' | 'error'; angle: 90 | -90; message?: string }>
  >({});
  const freshRotateWindowMs = 30000;
  const rotatedAtRef = useRef<Map<string, number>>(new Map());
  const isFreshImage = useCallback(
    (imageId: string) => {
      const rotatedAt = rotatedAtRef.current.get(imageId);
      if (!rotatedAt) {
        return false;
      }
      if (Date.now() - rotatedAt > freshRotateWindowMs) {
        rotatedAtRef.current.delete(imageId);
        return false;
      }
      return true;
    },
    [freshRotateWindowMs]
  );

  const scheduleRotateStatusClear = useCallback((imageId: string, delayMs: number) => {
    const existing = rotateStatusTimeoutRef.current.get(imageId);
    if (existing) {
      window.clearTimeout(existing);
    }
    const timeout = window.setTimeout(() => {
      rotateStatusTimeoutRef.current.delete(imageId);
      setRotateStatusById((current) => {
        if (!current[imageId]) {
          return current;
        }
        const next = { ...current };
        delete next[imageId];
        return next;
      });
    }, delayMs);
    rotateStatusTimeoutRef.current.set(imageId, timeout);
  }, []);

  const modalPendingAdvanceRef = useRef(false);
  const modalItemsLengthRef = useRef(0);
  const modalPulseTimeout = useRef<number | null>(null);
  const modalFavoritePulseTimeout = useRef<number | null>(null);
  const modalHiddenPulseTimeout = useRef<number | null>(null);
  const modalTimerPulseTimeout = useRef<number | null>(null);
  const modalControlsTimeoutRef = useRef<number | null>(null);
  const modalShakeTimeoutRef = useRef<number | null>(null);
  const rotateStatusTimeoutRef = useRef<Map<string, number>>(new Map());
  const rotatingIdsRef = useRef<Set<string>>(new Set());
  const lastHiddenFromModalRef = useRef<{
    imageId: string;
    setId: string;
    contextLabel: string;
    contextSetId: string | null;
  } | null>(null);
  const pendingHiddenRestoreRef = useRef<{
    imageId: string;
    contextLabel: string;
    contextSetId: string | null;
  } | null>(null);
  const modalHistoryEntryRef = useRef(false);
  const ignoreNextPopRef = useRef(false);
  const ignoreNextFullscreenRef = useRef(false);
  const modalNavThrottleRef = useRef(0);
  const goNextImageRef = useRef<(options?: { suppressControls?: boolean }) => void>(() => {});
  const sampleHistoryRef = useRef<DriveImage[]>([]);
  const sampleHistorySetRef = useRef<string | null>(null);

  const {
    modalTimerMs,
    modalTimerProgress,
    isModalTimerOpen,
    modalTimerFade,
    isModalTimerPaused,
    modalTimerOptions,
    onSelectModalTimer,
    onResetModalTimer,
    onToggleTimerMenu,
    pauseModalTimer,
    toggleModalTimerPause,
    startLastModalTimer,
    scheduleModalTimerResume,
    resetModalTimerState,
  } = useModalTimer({
    modalImageId,
    goNextImageRef,
    setModalControlsVisible,
  });

  const {
    modalIsLoading,
    modalLoadingCount,
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
    cacheKey,
    isFreshImage,
    getImageVersion,
    prefetchThumbs,
    setError,
  });

  const modalImage =
    modalIndex !== null && modalIndex >= 0 && modalIndex < modalItems.length
      ? modalItems[modalIndex]
      : null;
  const modalRotateStatus = modalImage ? rotateStatusById[modalImage.id] ?? null : null;
  const modalIsRotating = modalRotateStatus?.state === 'rotating';

  const modalSetId =
    modalContextLabel === 'Set'
      ? modalContextSetId ?? activeSet?.id ?? null
      : modalImage && modalContextLabel === 'Slideshow'
        ? slideshowImageSetRef.current.get(modalImage.id) ?? null
        : activeSet?.id ?? null;

  const modalSet = modalSetId ? setsById.get(modalSetId) : activeSet;
  const modalIsFavorite =
    modalImage && modalSet ? (modalSet.favoriteImageIds ?? []).includes(modalImage.id) : false;
  const modalIsHidden =
    modalImage && modalSet ? (modalSet.hiddenImageIds ?? []).includes(modalImage.id) : false;

  const activeHiddenIds = activeSet?.hiddenImageIds ?? [];
  const cachedCount = activeSet ? readImageListCache(activeSet.id)?.length : undefined;
  const totalImagesKnownRaw = activeSet?.imageCount ?? cachedCount;
  const totalImagesKnown =
    totalImagesKnownRaw !== undefined
      ? Math.max(0, totalImagesKnownRaw - activeHiddenIds.length)
      : undefined;
  const totalImages = totalImagesKnown ?? activeImages.length;
  const modalTotalImagesKnown =
    modalContextLabel === 'Set' && modalContextSetId
      ? (() => {
          const contextSet = setsById.get(modalContextSetId);
          const contextHidden = contextSet?.hiddenImageIds?.length ?? 0;
          const contextTotalRaw =
            contextSet?.imageCount ?? readImageListCache(modalContextSetId)?.length;
          return contextTotalRaw !== undefined
            ? Math.max(0, contextTotalRaw - contextHidden)
            : undefined;
        })()
      : totalImagesKnown;
  const modalRemainingImages =
    modalTotalImagesKnown !== undefined
      ? Math.max(0, modalTotalImagesKnown - modalItems.length)
      : undefined;
  const hiddenCount = activeHiddenIds.length;
  const activeHiddenSet = new Set(activeHiddenIds);
  const favoritesCount = (activeSet?.favoriteImageIds ?? []).filter(
    (id) => !activeHiddenSet.has(id)
  ).length;
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
      (modalContextLabel === 'Hidden' && !!activeSet) ||
      modalContextLabel === 'Slideshow');

  const scheduleModalControlsHide = useCallback(
    (force = false) => {
      if (!force && (modalTimerMs > 0 || isModalTimerOpen || isModalInfoOpen)) {
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
    [isModalInfoOpen, isModalTimerOpen, modalTimerMs]
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

  useEffect(() => {
    if (!isModalInfoOpen) {
      return;
    }
    if (modalControlsTimeoutRef.current) {
      window.clearTimeout(modalControlsTimeoutRef.current);
      modalControlsTimeoutRef.current = null;
    }
    setModalControlsVisible(true);
  }, [isModalInfoOpen]);

  useEffect(() => {
    if (!modalIsRotating) {
      return;
    }
    if (modalControlsTimeoutRef.current) {
      window.clearTimeout(modalControlsTimeoutRef.current);
      modalControlsTimeoutRef.current = null;
    }
    setModalControlsVisible(true);
  }, [modalIsRotating]);

  useEffect(() => {
    if (modalIndex !== null) {
      return;
    }
    setIsMouseZoomMode(false);
  }, [modalIndex]);

  const closeInfoMenu = useCallback(() => {
    setIsModalInfoOpen(false);
  }, []);

  const toggleInfoMenu = useCallback(() => {
    setIsModalInfoOpen((current) => !current);
    scheduleModalControlsHide(true);
  }, [scheduleModalControlsHide]);

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

  const toggleViewerFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      ignoreNextFullscreenRef.current = true;
      exitViewerFullscreen();
      return;
    }
    requestViewerFullscreen();
  }, [exitViewerFullscreen, requestViewerFullscreen]);

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

  const triggerHiddenPulse = useCallback((mode: 'hide' | 'unhide') => {
    setModalHiddenPulse(null);
    if (modalHiddenPulseTimeout.current) {
      window.clearTimeout(modalHiddenPulseTimeout.current);
    }
    modalHiddenPulseTimeout.current = window.setTimeout(() => {
      setModalHiddenPulse(mode);
      modalHiddenPulseTimeout.current = window.setTimeout(() => {
        setModalHiddenPulse(null);
      }, 520);
    }, 10);
  }, []);

  const triggerTimerPulse = useCallback((mode: 'pause' | 'play') => {
    setModalTimerPulse(null);
    if (modalTimerPulseTimeout.current) {
      window.clearTimeout(modalTimerPulseTimeout.current);
    }
    modalTimerPulseTimeout.current = window.setTimeout(() => {
      setModalTimerPulse(mode);
      modalTimerPulseTimeout.current = window.setTimeout(() => {
        setModalTimerPulse(null);
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


  const {
    appendSample,
    appendFavorites,
    appendNonFavorites,
    appendHidden,
    appendSlideshow,
    resetInFlight,
  } = useModalDataLoader({
    activeSet,
    modalItems,
    samplePageSize,
    readImageListCache,
    resolveSetImages,
    setError,
    setModalImageAtIndex,
    updateModalItems,
    filterImagesByFavoriteStatus,
    filterImagesByHiddenStatus,
    pickNext,
    setSampleImages,
    setFavoriteImages,
    setNonFavoriteImages,
    setHiddenImages,
    sampleHistoryRef,
    sampleHistorySetRef,
    loadSlideshowBatch,
    slideshowImagesRef,
    slideshowPageSize,
  });

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
    viewerSort,
    slideshowImageSetRef,
    resolveSetImages,
    setActiveImages,
    setError,
    setImageLimit,
    prefetchThumbs,
    updateFavoriteImagesFromSource,
    applyModalContext,
  });

  const { openModal, closeModal } = useModalState({
    activeSet,
    scheduleModalControlsHide,
    requestViewerFullscreen,
    exitViewerFullscreen,
    updateModalItems,
    setModalContextLabel,
    setModalContextSetId,
    resetModalMediaState,
    stopModalLoading,
    clearModalMediaCache,
    setModalImageId,
    setModalIndex,
    triggerModalPulse,
    setModalPulse,
    setModalFavoritePulse,
    setModalHiddenPulse,
    setModalZoom,
    setModalPan,
    resetModalTimerState,
    resetModalHistory,
    sampleHistoryRef,
    sampleHistorySetRef,
    resetInFlight,
    modalPulseTimeoutRef: modalPulseTimeout,
    modalFavoritePulseTimeoutRef: modalFavoritePulseTimeout,
    modalHiddenPulseTimeoutRef: modalHiddenPulseTimeout,
    modalControlsTimeoutRef,
  });

  const modalContextItemsRef = useRef<DriveImage[] | null>(null);
  const modalContextItemsSetIdRef = useRef<string | null>(null);

  const openModalWithHistory = useCallback(
    (
      imageId: string,
      items: DriveImage[],
      label: string,
      index?: number,
      options?: ModalOpenOptions
    ) => {
      if (!modalHistoryEntryRef.current) {
        const nextState = { ...(window.history.state ?? {}), modal: true };
        window.history.pushState(nextState, '');
        modalHistoryEntryRef.current = true;
      }
      if (options?.contextItems && options?.contextSetId) {
        modalContextItemsRef.current = options.contextItems;
        modalContextItemsSetIdRef.current = options.contextSetId;
      } else {
        modalContextItemsRef.current = null;
        modalContextItemsSetIdRef.current = null;
      }
      const baseItems = options?.contextItems ?? items;
      const limitedItems =
        options?.initialLimit && options.initialLimit > 0
          ? baseItems.slice(0, Math.max(1, options.initialLimit))
          : baseItems;
      openModal(imageId, limitedItems, label, index, options);
    },
    [openModal]
  );

  const closeModalWithHistory = useCallback(
    (source: 'manual' | 'popstate' | 'fullscreen') => {
      const shouldIgnoreFullscreen = source !== 'fullscreen' && !!document.fullscreenElement;
      if (shouldIgnoreFullscreen) {
        ignoreNextFullscreenRef.current = true;
      }
      setIsModalInfoOpen(false);
      closeModal();
      modalContextItemsRef.current = null;
      modalContextItemsSetIdRef.current = null;
      if (modalHistoryEntryRef.current && source !== 'popstate') {
        ignoreNextPopRef.current = true;
        window.history.back();
      }
      modalHistoryEntryRef.current = false;
    },
    [closeModal]
  );

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

  const toggleHiddenFromModal = useCallback(() => {
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
    const isHidden = set?.hiddenImageIds?.includes(modalImage.id) ?? false;
    triggerHiddenPulse(isHidden ? 'unhide' : 'hide');
    if (!isHidden) {
      lastHiddenFromModalRef.current = {
        imageId: modalImage.id,
        setId,
        contextLabel: modalContextLabel,
        contextSetId: modalContextSetId ?? null,
      };
    } else {
      lastHiddenFromModalRef.current = null;
    }
    void toggleHiddenImage(setId, modalImage.id);
  }, [
    activeSet,
    modalContextLabel,
    modalContextSetId,
    modalImage,
    setsById,
    slideshowImageSetRef,
    toggleHiddenImage,
    triggerHiddenPulse,
  ]);

  const rotateModalImage = useCallback(
    async (angle: 90 | -90) => {
      if (!modalImage) {
        return;
      }
      if (rotatingIdsRef.current.has(modalImage.id)) {
        return;
      }
      rotatingIdsRef.current.add(modalImage.id);
      setRotateStatusById((current) => ({
        ...current,
        [modalImage.id]: { state: 'rotating', angle },
      }));
      try {
        await rotateImage(modalImage.id, angle);
        bumpImageVersion(modalImage.id);
        rotatedAtRef.current.set(modalImage.id, Date.now());
        if (modalImageId === modalImage.id) {
          resetModalMediaState();
          setModalLoadKey((key) => key + 1);
        }
        setRotateStatusById((current) => ({
          ...current,
          [modalImage.id]: { state: 'done', angle },
        }));
        scheduleRotateStatusClear(modalImage.id, 1200);
      } catch (error) {
        setError((error as Error).message);
        setRotateStatusById((current) => ({
          ...current,
          [modalImage.id]: { state: 'error', angle, message: (error as Error).message },
        }));
        scheduleRotateStatusClear(modalImage.id, 2400);
      } finally {
        rotatingIdsRef.current.delete(modalImage.id);
      }
    },
    [
      bumpImageVersion,
      modalImage,
      scheduleRotateStatusClear,
      modalImageId,
      resetModalMediaState,
      rotateImage,
      setError,
    ]
  );


  const resolveCurrentIndex = useCallback(() => {
    if (modalIndex !== null && modalItems[modalIndex]?.id === modalImageId) {
      return modalIndex;
    }
    if (!modalImageId) {
      return modalIndex;
    }
    const foundIndex = modalItems.findIndex((image) => image.id === modalImageId);
    return foundIndex === -1 ? null : foundIndex;
  }, [modalImageId, modalIndex, modalItems]);

  const goNextImage = (options?: { suppressControls?: boolean }) => {
    const now = performance.now();
    if (now - modalNavThrottleRef.current < 50) {
      return;
    }
    modalNavThrottleRef.current = now;
    if (modalItems.length === 0) {
      triggerModalShake();
      return;
    }
    if (options?.suppressControls) {
      setModalControlsVisible(false);
    }
    const currentIndex = resolveCurrentIndex();
    if (currentIndex === null || currentIndex === -1) {
      triggerModalShake();
      return;
    }
    const isLast = currentIndex + 1 >= modalItems.length;
    if (isLast) {
      if (modalContextLabel === 'Sample' && activeSet) {
        void appendSample({ suppressControls: options?.suppressControls });
        return;
      }
      if (modalContextLabel === 'Non favorites' && activeSet) {
        void appendNonFavorites({ suppressControls: options?.suppressControls });
        return;
      }
      if (modalContextLabel === 'Favorites' && activeSet) {
        void appendFavorites({ suppressControls: options?.suppressControls });
        return;
      }
      if (modalContextLabel === 'Hidden' && activeSet) {
        void appendHidden({ suppressControls: options?.suppressControls });
        return;
      }
      if (modalContextLabel === 'Slideshow') {
        void appendSlideshow({ suppressControls: options?.suppressControls });
        return;
      }
      if (modalContextLabel === 'Set' && modalRemainingImages !== undefined && modalRemainingImages > 0) {
        if (modalContextSetId && (modalHasHistory || activeSet?.id !== modalContextSetId)) {
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
            const contextItems =
              modalContextItemsSetIdRef.current === modalContextSetId
                ? modalContextItemsRef.current
                : null;
            const images = contextItems ?? (await resolveSetImages(contextSet, true));
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
        if (modalPendingAdvanceRef.current) {
          return;
        }
        if (!isLoadingMore && activeSet) {
          const cached = readImageListCache(activeSet.id);
          const maxAvailable = activeSet.imageCount ?? cached?.length ?? Infinity;
          const nextLimit = Math.min(activeImages.length + allPageSize, maxAvailable);
          if (nextLimit <= activeImages.length) {
            triggerModalShake();
            return;
          }
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
    const now = performance.now();
    if (now - modalNavThrottleRef.current < 50) {
      return;
    }
    modalNavThrottleRef.current = now;
    if (modalItems.length === 0) {
      triggerModalShake();
      return;
    }
    const currentIndex = resolveCurrentIndex();
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
    onCloseModal: () => closeModalWithHistory('manual'),
    mouseZoomMode: isMouseZoomMode,
  });

  useEffect(() => {
    goNextImageRef.current = goNextImage;
  }, [goNextImage]);

  useEffect(() => {
    const handlePop = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (modalIndex !== null) {
        closeModalWithHistory('popstate');
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => {
      window.removeEventListener('popstate', handlePop);
    };
  }, [closeModalWithHistory, modalIndex]);

  useEffect(() => {
    if (modalIndex === null) {
      return;
    }
    const handleFullscreenChange = () => {
      if (ignoreNextFullscreenRef.current) {
        ignoreNextFullscreenRef.current = false;
        return;
      }
      if (!document.fullscreenElement) {
        closeModalWithHistory('fullscreen');
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [closeModalWithHistory, modalIndex]);

  useEffect(() => {
    if (modalIndex === null) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === 'p' || event.key === ' ') {
        event.preventDefault();
        if (modalTimerMs > 0) {
          const mode = isModalTimerPaused ? 'play' : 'pause';
          toggleModalTimerPause();
          triggerTimerPulse(mode);
          return;
        }
        const started = startLastModalTimer();
        if (started) {
          triggerTimerPulse('play');
        }
        return;
      }
      if (normalizedKey === 'f') {
        if (event.shiftKey) {
          toggleViewerFullscreen();
        } else {
          toggleFavoriteFromModal();
        }
      }
      if (normalizedKey === 'h') {
        toggleHiddenFromModal();
      }
      if (normalizedKey === 't') {
        onToggleTimerMenu();
      }
      if (normalizedKey === 'i') {
        toggleInfoMenu();
      }
      if (normalizedKey === 'v') {
        setIsMouseZoomMode((current) => !current);
      }
      if (normalizedKey === 'z') {
        const lastHidden = lastHiddenFromModalRef.current;
        if (
          lastHidden &&
          lastHidden.contextLabel === modalContextLabel &&
          lastHidden.contextSetId === (modalContextSetId ?? null)
        ) {
          event.preventDefault();
          pendingHiddenRestoreRef.current = {
            imageId: lastHidden.imageId,
            contextLabel: lastHidden.contextLabel,
            contextSetId: lastHidden.contextSetId,
          };
          triggerHiddenPulse('unhide');
          lastHiddenFromModalRef.current = null;
          void toggleHiddenImage(lastHidden.setId, lastHidden.imageId);
        }
      }
      if (normalizedKey === 'c') {
        if (modalContextLabel === 'Set') {
          if (modalHasHistory) {
            restoreModalContext();
          } else if (viewerSort === 'random') {
            void openModalChronologicalContext();
          }
        } else if (
          modalContextLabel === 'Favorites' ||
          modalContextLabel === 'Non favorites' ||
          modalContextLabel === 'Hidden' ||
          modalContextLabel === 'Slideshow'
        ) {
          void openModalChronologicalContext();
        }
      }
      if (event.key === 'Escape') {
        closeModalWithHistory('manual');
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
    closeModalWithHistory,
    goNextImage,
    goPrevImage,
    modalContextLabel,
    modalHasHistory,
    modalIndex,
    openModalChronologicalContext,
    onToggleTimerMenu,
    restoreModalContext,
    toggleInfoMenu,
    toggleFavoriteFromModal,
    toggleViewerFullscreen,
    toggleModalTimerPause,
    startLastModalTimer,
    toggleHiddenFromModal,
    toggleHiddenImage,
    modalTimerMs,
    isModalTimerPaused,
    triggerTimerPulse,
    viewerSort,
    modalContextSetId,
  ]);

  useEffect(() => {
    return () => {
      if (modalPulseTimeout.current) {
        window.clearTimeout(modalPulseTimeout.current);
      }
      if (modalFavoritePulseTimeout.current) {
        window.clearTimeout(modalFavoritePulseTimeout.current);
      }
      if (modalHiddenPulseTimeout.current) {
        window.clearTimeout(modalHiddenPulseTimeout.current);
      }
      if (modalTimerPulseTimeout.current) {
        window.clearTimeout(modalTimerPulseTimeout.current);
      }
      if (modalControlsTimeoutRef.current) {
        window.clearTimeout(modalControlsTimeoutRef.current);
      }
      if (modalShakeTimeoutRef.current) {
        window.clearTimeout(modalShakeTimeoutRef.current);
      }
      rotateStatusTimeoutRef.current.forEach((timeout) => {
        window.clearTimeout(timeout);
      });
      rotateStatusTimeoutRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const pending = pendingHiddenRestoreRef.current;
    if (!pending) {
      return;
    }
    if (
      pending.contextLabel !== modalContextLabel ||
      pending.contextSetId !== (modalContextSetId ?? null)
    ) {
      pendingHiddenRestoreRef.current = null;
      return;
    }
    const index = modalItems.findIndex((image) => image.id === pending.imageId);
    if (index === -1) {
      return;
    }
    setModalImageAtIndex(modalItems, index);
    pendingHiddenRestoreRef.current = null;
  }, [modalContextLabel, modalContextSetId, modalItems, setModalImageAtIndex]);

  useEffect(() => {
    lastHiddenFromModalRef.current = null;
    pendingHiddenRestoreRef.current = null;
  }, [activeSet?.id, modalContextLabel, modalContextSetId]);

  useEffect(() => {
    if (modalContextLabel !== 'Set') {
      return;
    }
    if (modalPendingAdvanceRef.current) {
      return;
    }
    if (modalHasHistory) {
      return;
    }
    if (
      modalContextItemsRef.current &&
      modalContextItemsSetIdRef.current === modalContextSetId
    ) {
      return;
    }
    if (modalContextSetId && activeSet?.id !== modalContextSetId) {
      return;
    }
    if (activeImages.length === 0) {
      if (modalItems.length > 0) {
        updateModalItems([]);
        setModalIndex(null);
        setModalImageId(null);
      }
      return;
    }
    if (!modalImageId) {
      updateModalItems(activeImages);
      setModalIndex(0);
      setModalImageId(activeImages[0]?.id ?? null);
      return;
    }
    const nextIndex = activeImages.findIndex((image) => image.id === modalImageId);
    updateModalItems(activeImages);
    if (nextIndex === -1) {
      const fallbackIndex =
        modalIndex !== null ? Math.min(modalIndex, activeImages.length - 1) : 0;
      setModalIndex(fallbackIndex);
      setModalImageId(activeImages[fallbackIndex]?.id ?? null);
      return;
    }
    if (nextIndex !== modalIndex) {
      setModalIndex(nextIndex);
    }
  }, [
    activeImages,
    activeSet?.id,
    modalContextLabel,
    modalContextSetId,
    modalHasHistory,
    modalImageId,
    modalIndex,
    modalItems.length,
    setModalImageId,
    setModalIndex,
    updateModalItems,
  ]);

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
    modalSetName: modalSet?.name ?? null,
    isModalInfoOpen,
    viewerSort,
    modalIsFavorite,
    modalIsHidden,
    modalIsLoading,
    modalLoadingCount,
    modalPulse,
    modalFavoritePulse,
    modalHiddenPulse,
    modalIsRotating,
    modalRotateStatus,
    modalFullSrc,
    modalFullImageId,
    modalFullAnimate,
    modalZoom,
    modalPan,
    modalControlsVisible,
    modalShake,
    modalSwipeAction,
    modalSwipeProgress,
    isMouseZoomMode,
    modalTimerMs,
    modalTimerProgress,
    isModalTimerOpen,
    modalTimerFade,
    modalTimerPulse,
    modalHasHistory,
    modalTimerOptions,
    modalTotalImagesKnown,
    totalImages,
    favoritesCount,
    hiddenCount,
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
    onToggleInfoMenu: toggleInfoMenu,
    onCloseInfoMenu: closeInfoMenu,
    onOpenChronologicalContext: openModalChronologicalContext,
    onRestoreModalContext: restoreModalContext,
    onToggleFavoriteFromModal: toggleFavoriteFromModal,
    onToggleHiddenFromModal: toggleHiddenFromModal,
    onRotateModalImage: rotateModalImage,
    onPrevImage: goPrevImage,
    onNextImage: goNextImage,
    onCloseModal: () => closeModalWithHistory('manual'),
  };

  return {
    modalState,
    openModal: openModalWithHistory,
    closeModal: () => closeModalWithHistory('manual'),
  };
}
