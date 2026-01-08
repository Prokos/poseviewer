import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction, SyntheticEvent } from 'react';
import type { PoseSet } from '../metadata';
import type { DriveImage } from '../drive/types';
import { createProxyMediaUrl } from '../utils/driveUrls';
import { appendUniqueImages } from '../utils/imageSampling';

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
  slideshowImagesRef: React.MutableRefObject<DriveImage[]>;
  slideshowImageSetRef: React.MutableRefObject<Map<string, string>>;
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
  onModalWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onModalPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onModalPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onModalPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onModalMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
  onModalTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
  onModalTouchMove: (event: React.TouchEvent<HTMLDivElement>) => void;
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
  const [modalIsLoading, setModalIsLoading] = useState(false);
  const [modalPulse, setModalPulse] = useState(false);
  const [modalFavoritePulse, setModalFavoritePulse] = useState<null | 'add' | 'remove'>(null);
  const [modalFullSrc, setModalFullSrc] = useState<string | null>(null);
  const [modalFullImageId, setModalFullImageId] = useState<string | null>(null);
  const [modalFullAnimate, setModalFullAnimate] = useState(false);
  const [modalLoadKey, setModalLoadKey] = useState(0);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
  const [modalControlsVisible, setModalControlsVisible] = useState(true);
  const [modalShake, setModalShake] = useState(false);
  const [modalSwipeAction, setModalSwipeAction] = useState<
    null | 'close' | 'favorite' | 'prev' | 'next'
  >(null);
  const [modalSwipeProgress, setModalSwipeProgress] = useState(0);
  const [modalTimerMs, setModalTimerMs] = useState(0);
  const [modalTimerProgress, setModalTimerProgress] = useState(0);
  const [isModalTimerOpen, setIsModalTimerOpen] = useState(false);
  const [modalTimerFade, setModalTimerFade] = useState(false);
  const [modalHasHistory, setModalHasHistory] = useState(false);

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });
  const modalPendingAdvanceRef = useRef(false);
  const modalItemsLengthRef = useRef(0);
  const modalPulseTimeout = useRef<number | null>(null);
  const modalFavoritePulseTimeout = useRef<number | null>(null);
  const modalControlsTimeoutRef = useRef<number | null>(null);
  const modalShakeTimeoutRef = useRef<number | null>(null);
  const modalFullAbortRef = useRef<AbortController | null>(null);
  const modalFullUrlRef = useRef<string | null>(null);
  const modalPrefetchAbortRef = useRef<Map<string, AbortController>>(new Map());
  const modalPrefetchCacheRef = useRef<Map<string, string>>(new Map());
  const modalFullCacheRef = useRef<Map<string, string>>(new Map());
  const modalFullCacheMax = 6;
  const modalMediaRef = useRef<HTMLDivElement | null>(null);
  const modalImageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const modalImageSizeCacheRef = useRef<Map<string, { width: number; height: number }>>(
    new Map()
  );
  const modalTimerFrameRef = useRef<number | null>(null);
  const modalTimerIntervalRef = useRef<number | null>(null);
  const modalTimerStartRef = useRef(0);
  const modalTimerElapsedRef = useRef(0);
  const modalTimerPausedRef = useRef(false);
  const modalTimerResumeTimeoutRef = useRef<number | null>(null);
  const modalTimerFadeRef = useRef(false);
  const modalSwipeLockRef = useRef<null | 'close' | 'favorite' | 'prev' | 'next'>(null);
  const modalSwipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeFallbackRef = useRef<HTMLVideoElement | null>(null);
  const modalAutoAdvanceRef = useRef(false);
  const goNextImageRef = useRef<() => void>(() => {});
  const modalHistoryRef = useRef<{
    items: DriveImage[];
    label: string;
    imageId: string | null;
    index: number | null;
    contextSetId?: string | null;
  } | null>(null);
  const sampleHistoryRef = useRef<DriveImage[]>([]);
  const sampleHistorySetRef = useRef<string | null>(null);
  const sampleAppendInFlightRef = useRef(false);
  const favoriteAppendInFlightRef = useRef(false);
  const nonFavoriteAppendInFlightRef = useRef(false);
  const slideshowAppendInFlightRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchLastRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    zoom: number;
    pointerX: number;
    pointerY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const oneHandZoomRef = useRef<{
    startY: number;
    zoom: number;
    pointerX: number;
    pointerY: number;
    worldX: number;
    worldY: number;
  } | null>(null);
  const oneHandZoomMovedRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastDoubleTapRef = useRef(0);
  const touchMovedRef = useRef(false);

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

  const pauseModalTimer = useCallback(() => {
    if (modalTimerMs <= 0 || modalTimerPausedRef.current) {
      return;
    }
    modalTimerPausedRef.current = true;
    modalTimerElapsedRef.current += performance.now() - modalTimerStartRef.current;
    if (modalTimerFadeRef.current) {
      modalTimerFadeRef.current = false;
      setModalTimerFade(false);
    }
  }, [modalTimerMs]);

  const resumeModalTimer = useCallback(() => {
    if (modalTimerMs <= 0 || !modalTimerPausedRef.current) {
      return;
    }
    modalTimerPausedRef.current = false;
    modalTimerStartRef.current = performance.now();
  }, [modalTimerMs]);

  const scheduleModalTimerResume = useCallback(() => {
    if (modalTimerResumeTimeoutRef.current) {
      window.clearTimeout(modalTimerResumeTimeoutRef.current);
    }
    if (isModalTimerOpen) {
      return;
    }
    modalTimerResumeTimeoutRef.current = window.setTimeout(() => {
      modalTimerResumeTimeoutRef.current = null;
      resumeModalTimer();
    }, 300);
  }, [isModalTimerOpen, resumeModalTimer]);

  const startWakeFallback = useCallback(() => {
    if (wakeFallbackRef.current) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, 1, 1);
    }
    const stream = canvas.captureStream(1);
    const video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.srcObject = stream;
    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.left = '0';
    video.style.top = '0';
    document.body.appendChild(video);
    wakeFallbackRef.current = video;
    void video.play().catch(() => undefined);
  }, []);

  const stopWakeFallback = useCallback(() => {
    const video = wakeFallbackRef.current;
    if (!video) {
      return;
    }
    video.pause();
    video.remove();
    wakeFallbackRef.current = null;
  }, []);

  const handleSelectModalTimer = useCallback(
    (value: number) => {
      setModalTimerMs(value);
      setIsModalTimerOpen(false);
      if (value > 0) {
        startWakeFallback();
      } else {
        stopWakeFallback();
      }
    },
    [startWakeFallback, stopWakeFallback]
  );

  const resetModalTimer = useCallback(() => {
    if (modalTimerMs <= 0) {
      return;
    }
    modalTimerElapsedRef.current = 0;
    modalTimerPausedRef.current = false;
    modalTimerStartRef.current = performance.now();
    setModalTimerProgress(0);
    setModalTimerFade(false);
    setIsModalTimerOpen(false);
  }, [modalTimerMs]);

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

  const getModalMaxZoom = useCallback(() => {
    const media = modalMediaRef.current;
    const bounds = media ? { width: media.clientWidth, height: media.clientHeight } : null;
    const size = modalImageSizeRef.current;
    if (!bounds || !size) {
      return 1.5;
    }
    if (size.width <= 0 || size.height <= 0) {
      return 1.5;
    }
    const baseScale = Math.min(bounds.width / size.width, bounds.height / size.height);
    if (!Number.isFinite(baseScale) || baseScale <= 0) {
      return 1.5;
    }
    return Math.max(1, 1.5 / baseScale);
  }, []);

  const clampModalPan = useCallback((pan: { x: number; y: number }, zoom: number) => {
    const media = modalMediaRef.current;
    const bounds = media ? { width: media.clientWidth, height: media.clientHeight } : null;
    const size = modalImageSizeRef.current;
    if (!bounds || !size) {
      return pan;
    }
    if (size.width <= 0 || size.height <= 0) {
      return pan;
    }
    const baseScale = Math.min(bounds.width / size.width, bounds.height / size.height);
    if (!Number.isFinite(baseScale) || baseScale <= 0) {
      return pan;
    }
    const imageWidth = size.width * baseScale * zoom;
    const imageHeight = size.height * baseScale * zoom;
    const minVisible = 0.1;
    const minVisibleWidth = imageWidth * minVisible;
    const minVisibleHeight = imageHeight * minVisible;
    const viewLeft = -bounds.width / 2;
    const viewRight = bounds.width / 2;
    const viewTop = -bounds.height / 2;
    const viewBottom = bounds.height / 2;
    const minPanX = viewLeft + minVisibleWidth - imageWidth / 2;
    const maxPanX = viewRight - minVisibleWidth + imageWidth / 2;
    const minPanY = viewTop + minVisibleHeight - imageHeight / 2;
    const maxPanY = viewBottom - minVisibleHeight + imageHeight / 2;
    return {
      x: Math.min(maxPanX, Math.max(minPanX, pan.x)),
      y: Math.min(maxPanY, Math.max(minPanY, pan.y)),
    };
  }, []);

  const handleModalFullLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      if (!img.naturalWidth || !img.naturalHeight || !modalImageId) {
        return;
      }
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      modalImageSizeRef.current = size;
      modalImageSizeCacheRef.current.set(modalImageId, size);
    },
    [modalImageId]
  );

  const modalTimerOptions = useMemo(
    () => [
      { label: 'none', value: 0 },
      { label: '10s', value: 10_000 },
      { label: '30s', value: 30_000 },
      { label: '1min', value: 60_000 },
      { label: '2min', value: 120_000 },
      { label: '5min', value: 300_000 },
      { label: '10min', value: 600_000 },
    ],
    []
  );

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

  const applyModalContext = useCallback(
    (snapshot: {
      items: DriveImage[];
      label: string;
      imageId: string | null;
      index: number | null;
      contextSetId?: string | null;
    }) => {
      setModalItems(snapshot.items);
      modalItemsLengthRef.current = snapshot.items.length;
      setModalContextLabel(snapshot.label);
      setModalContextSetId(snapshot.contextSetId ?? null);
      setModalImageId(snapshot.imageId);
      setModalIndex(snapshot.index);
      setModalFullSrc(null);
      setModalFullImageId(null);
      setModalFullAnimate(false);
      setModalLoadKey((key) => key + 1);
      triggerModalPulse();
    },
    []
  );

  const openModalChronologicalContext = useCallback(async () => {
    if (!modalImageId || modalContextLabel === 'Set') {
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
    updateFavoriteImagesFromSource,
  ]);

  const restoreModalContext = useCallback(() => {
    if (!modalHistoryRef.current) {
      return;
    }
    const current = {
      items: modalItems,
      label: modalContextLabel,
      imageId: modalImageId,
      index: modalIndex,
      contextSetId: modalContextSetId,
    };
    const previous = modalHistoryRef.current;
    modalHistoryRef.current = current;
    setModalHasHistory(true);
    applyModalContext(previous);
  }, [applyModalContext, modalContextLabel, modalContextSetId, modalImageId, modalIndex, modalItems]);

  const openModal = useCallback(
    (imageId: string, items: DriveImage[], label: string) => {
      requestViewerFullscreen();
      scheduleModalControlsHide(true);
      const index = items.findIndex((image) => image.id === imageId);
      setModalItems(items);
      modalItemsLengthRef.current = items.length;
      setModalContextLabel(label);
      setModalContextSetId(label === 'Set' && activeSet ? activeSet.id : null);
      setModalFullSrc(null);
      setModalFullImageId(null);
      setModalFullAnimate(false);
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
    [activeSet, scheduleModalControlsHide]
  );

  const closeModal = () => {
    setModalIndex(null);
    setModalImageId(null);
    setModalItems([]);
    modalItemsLengthRef.current = 0;
    setModalContextLabel('');
    setModalContextSetId(null);
    setModalIsLoading(false);
    setModalPulse(false);
    setModalFavoritePulse(null);
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
    setModalTimerMs(0);
    setModalTimerProgress(0);
    setModalTimerFade(false);
    setIsModalTimerOpen(false);
    modalHistoryRef.current = null;
    setModalHasHistory(false);
    sampleHistoryRef.current = [];
    sampleHistorySetRef.current = null;
    sampleAppendInFlightRef.current = false;
    if (modalPulseTimeout.current) {
      window.clearTimeout(modalPulseTimeout.current);
      modalPulseTimeout.current = null;
    }
    if (modalFavoritePulseTimeout.current) {
      window.clearTimeout(modalFavoritePulseTimeout.current);
      modalFavoritePulseTimeout.current = null;
    }
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
      modalFullAbortRef.current = null;
    }
    if (modalFullUrlRef.current) {
      const cached = Array.from(modalFullCacheRef.current.values()).includes(modalFullUrlRef.current);
      if (!cached) {
        URL.revokeObjectURL(modalFullUrlRef.current);
      }
      modalFullUrlRef.current = null;
    }
    modalPrefetchAbortRef.current.forEach((controller) => controller.abort());
    modalPrefetchAbortRef.current.clear();
    modalPrefetchCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    modalPrefetchCacheRef.current.clear();
    modalFullCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    modalFullCacheRef.current.clear();
    if (modalTimerFrameRef.current) {
      window.cancelAnimationFrame(modalTimerFrameRef.current);
      modalTimerFrameRef.current = null;
    }
    if (modalTimerIntervalRef.current) {
      window.clearInterval(modalTimerIntervalRef.current);
      modalTimerIntervalRef.current = null;
    }
    if (modalTimerResumeTimeoutRef.current) {
      window.clearTimeout(modalTimerResumeTimeoutRef.current);
      modalTimerResumeTimeoutRef.current = null;
    }
    if (modalControlsTimeoutRef.current) {
      window.clearTimeout(modalControlsTimeoutRef.current);
      modalControlsTimeoutRef.current = null;
    }
    if (wakeLockRef.current) {
      void wakeLockRef.current.release().catch(() => undefined);
      wakeLockRef.current = null;
    }
    stopWakeFallback();
    exitViewerFullscreen();
  };

  const storeModalFullCache = useCallback((imageId: string, url: string) => {
    const cache = modalFullCacheRef.current;
    const existing = cache.get(imageId);
    if (existing && existing !== url) {
      URL.revokeObjectURL(existing);
    }
    cache.delete(imageId);
    cache.set(imageId, url);
    while (cache.size > modalFullCacheMax) {
      const oldest = cache.entries().next().value as [string, string] | undefined;
      if (!oldest) {
        break;
      }
      cache.delete(oldest[0]);
      URL.revokeObjectURL(oldest[1]);
    }
  }, []);

  const fetchImageBlob = useCallback(async (url: string, signal: AbortSignal) => {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Image load failed: ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    const blob = await response.blob();
    if (contentLength) {
      const expected = Number(contentLength);
      if (Number.isFinite(expected) && expected > 0 && blob.size !== expected) {
        throw new Error('Image load incomplete');
      }
    }
    return blob;
  }, []);

  const prefetchModalImage = useCallback(
    (imageId?: string) => {
      if (!imageId) {
        return;
      }
      if (modalPrefetchCacheRef.current.has(imageId)) {
        return;
      }
      if (modalPrefetchAbortRef.current.has(imageId)) {
        return;
      }
      const controller = new AbortController();
      modalPrefetchAbortRef.current.set(imageId, controller);
      const url = createProxyMediaUrl(imageId);
      fetchImageBlob(url, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) {
            return;
          }
          const objectUrl = URL.createObjectURL(blob);
          modalPrefetchCacheRef.current.set(imageId, objectUrl);
        })
        .catch((prefetchError) => {
          if ((prefetchError as Error).name === 'AbortError') {
            return;
          }
          setError((prefetchError as Error).message);
        })
        .finally(() => {
          modalPrefetchAbortRef.current.delete(imageId);
        });
    },
    [fetchImageBlob, setError]
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
        if (sampleAppendInFlightRef.current) {
          return;
        }
        sampleAppendInFlightRef.current = true;
        const setId = activeSet.id;
        (async () => {
          const source = readImageListCache(activeSet.id) ?? (await resolveSetImages(activeSet, true));
          if (!source || source.length === 0) {
            return;
          }
          const nextSample = pickNextSample(activeSet.id, source, samplePageSize);
          if (nextSample.length === 0) {
            return;
          }
          const existingIds = new Set(modalItems.map((item) => item.id));
          const deduped = nextSample.filter((item) => !existingIds.has(item.id));
          if (deduped.length === 0) {
            return;
          }
          if (sampleHistorySetRef.current && sampleHistorySetRef.current !== setId) {
            return;
          }
          const updated = [...modalItems, ...deduped];
          sampleHistoryRef.current = updated;
          sampleHistorySetRef.current = setId;
          setModalItems(updated);
          modalItemsLengthRef.current = updated.length;
          setSampleImages((current) => appendUniqueImages(current, deduped));
          const nextIndex = updated.length - deduped.length;
          setModalFullSrc(null);
          setModalFullImageId(null);
          setModalFullAnimate(false);
          setModalImageId(updated[nextIndex]?.id ?? null);
          setModalIndex(updated[nextIndex]?.id ? nextIndex : null);
          if (options?.suppressControls) {
            setModalPulse(false);
          } else {
            triggerModalPulse();
          }
        })()
          .catch((error) => {
            setError((error as Error).message);
          })
          .finally(() => {
            sampleAppendInFlightRef.current = false;
          });
        return;
      }
      if (modalContextLabel === 'Non favorites' && activeSet) {
        if (nonFavoriteAppendInFlightRef.current) {
          return;
        }
        nonFavoriteAppendInFlightRef.current = true;
        (async () => {
          const source = readImageListCache(activeSet.id) ?? (await resolveSetImages(activeSet, true));
          if (!source || source.length === 0) {
            return;
          }
          const nonFavorites = filterNonFavorites(source, activeSet.favoriteImageIds ?? []);
          if (nonFavorites.length === 0) {
            return;
          }
          const nextBatch = pickNextNonFavorites(activeSet.id, nonFavorites, samplePageSize);
          if (nextBatch.length === 0) {
            return;
          }
          const existingIds = new Set(modalItems.map((item) => item.id));
          const deduped = nextBatch.filter((item) => !existingIds.has(item.id));
          if (deduped.length === 0) {
            return;
          }
          const updated = [...modalItems, ...deduped];
          setModalItems(updated);
          modalItemsLengthRef.current = updated.length;
          setNonFavoriteImages((current) => appendUniqueImages(current, deduped));
          const nextIndex = updated.length - deduped.length;
          setModalFullSrc(null);
          setModalFullImageId(null);
          setModalFullAnimate(false);
          setModalImageId(updated[nextIndex]?.id ?? null);
          setModalIndex(updated[nextIndex]?.id ? nextIndex : null);
          if (options?.suppressControls) {
            setModalPulse(false);
          } else {
            triggerModalPulse();
          }
        })()
          .catch((error) => {
            setError((error as Error).message);
          })
          .finally(() => {
            nonFavoriteAppendInFlightRef.current = false;
          });
        return;
      }
      if (modalContextLabel === 'Favorites' && activeSet) {
        if (favoriteAppendInFlightRef.current) {
          return;
        }
        favoriteAppendInFlightRef.current = true;
        (async () => {
          const source = readImageListCache(activeSet.id) ?? (await resolveSetImages(activeSet, true));
          if (!source || source.length === 0) {
            return;
          }
          const favorites = filterFavorites(source, activeSet.favoriteImageIds ?? []);
          if (favorites.length === 0) {
            return;
          }
          const nextBatch = pickNextFavorites(activeSet.id, favorites, samplePageSize);
          if (nextBatch.length === 0) {
            return;
          }
          const existingIds = new Set(modalItems.map((item) => item.id));
          const deduped = nextBatch.filter((item) => !existingIds.has(item.id));
          if (deduped.length === 0) {
            return;
          }
          const updated = [...modalItems, ...deduped];
          setModalItems(updated);
          modalItemsLengthRef.current = updated.length;
          setFavoriteImages((current) => appendUniqueImages(current, deduped));
          const nextIndex = updated.length - deduped.length;
          setModalFullSrc(null);
          setModalFullImageId(null);
          setModalFullAnimate(false);
          setModalImageId(updated[nextIndex]?.id ?? null);
          setModalIndex(updated[nextIndex]?.id ? nextIndex : null);
          if (options?.suppressControls) {
            setModalPulse(false);
          } else {
            triggerModalPulse();
          }
        })()
          .catch((error) => {
            setError((error as Error).message);
          })
          .finally(() => {
            favoriteAppendInFlightRef.current = false;
          });
        return;
      }
      if (modalContextLabel === 'Slideshow') {
        if (slideshowAppendInFlightRef.current) {
          return;
        }
        slideshowAppendInFlightRef.current = true;
        (async () => {
          const updated =
            (await loadSlideshowBatch(slideshowPageSize)) ?? slideshowImagesRef.current;
          const nextIndex = modalItems.length;
          const nextImage = updated[nextIndex];
          if (!nextImage) {
            return;
          }
          setModalItems(updated);
          modalItemsLengthRef.current = updated.length;
          setModalFullSrc(null);
          setModalFullImageId(null);
          setModalFullAnimate(false);
          setModalImageId(nextImage.id);
          setModalIndex(nextIndex);
          if (options?.suppressControls) {
            setModalPulse(false);
          } else {
            triggerModalPulse();
          }
        })()
          .catch((error) => {
            setError((error as Error).message);
          })
          .finally(() => {
            slideshowAppendInFlightRef.current = false;
          });
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
            setModalItems(nextItems);
            modalItemsLengthRef.current = nextItems.length;
            setModalFullSrc(null);
            setModalFullImageId(null);
            setModalFullAnimate(false);
            setModalImageId(nextItems[nextIndex]?.id ?? null);
            setModalIndex(nextItems[nextIndex]?.id ? nextIndex : null);
            if (options?.suppressControls) {
              setModalPulse(false);
            } else {
              triggerModalPulse();
            }
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
    const nextImage = modalItems[nextIndex];
    if (!nextImage) {
      return;
    }
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    setModalImageId(nextImage.id);
    setModalIndex(nextIndex);
    if (options?.suppressControls) {
      setModalPulse(false);
    } else {
      triggerModalPulse();
    }
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
    const nextImage = modalItems[nextIndex];
    if (!nextImage) {
      return;
    }
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    setModalImageId(nextImage.id);
    setModalIndex(nextIndex);
    triggerModalPulse();
  };

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
    if (!modalImageId) {
      return;
    }
    if (modalTimerMs > 0 || modalAutoAdvanceRef.current) {
      setModalControlsVisible(false);
      modalAutoAdvanceRef.current = false;
    }
  }, [modalImageId, modalTimerMs]);

  useEffect(() => {
    if (!modalImageId || modalTimerMs <= 0) {
      if (modalTimerFrameRef.current) {
        window.cancelAnimationFrame(modalTimerFrameRef.current);
        modalTimerFrameRef.current = null;
      }
      if (modalTimerIntervalRef.current) {
        window.clearInterval(modalTimerIntervalRef.current);
        modalTimerIntervalRef.current = null;
      }
      setModalTimerProgress(0);
      setModalTimerFade(false);
      stopWakeFallback();
      return;
    }
    let isActive = true;
    modalTimerElapsedRef.current = 0;
    modalTimerPausedRef.current = false;
    modalTimerStartRef.current = performance.now();
    setModalTimerProgress(0);
    setModalTimerFade(false);
    const tick = (now: number) => {
      if (!isActive) {
        return;
      }
      const elapsed =
        modalTimerElapsedRef.current +
        (modalTimerPausedRef.current ? 0 : now - modalTimerStartRef.current);
      const remaining = Math.max(0, modalTimerMs - elapsed);
      const shouldFade = remaining <= 500 && !modalTimerPausedRef.current;
      if (modalTimerFadeRef.current !== shouldFade) {
        modalTimerFadeRef.current = shouldFade;
        setModalTimerFade(shouldFade);
      }
      const progress = Math.min(1, elapsed / modalTimerMs);
      setModalTimerProgress(progress);
      if (progress >= 1) {
        isActive = false;
        setModalTimerProgress(0);
        modalTimerElapsedRef.current = 0;
        modalTimerStartRef.current = performance.now();
        setModalControlsVisible(false);
        modalAutoAdvanceRef.current = true;
        goNextImageRef.current({ suppressControls: true });
        return;
      }
    };
    modalTimerIntervalRef.current = window.setInterval(() => {
      tick(performance.now());
    }, 50);
    return () => {
      isActive = false;
      if (modalTimerIntervalRef.current) {
        window.clearInterval(modalTimerIntervalRef.current);
        modalTimerIntervalRef.current = null;
      }
    };
  }, [modalImageId, modalTimerMs, stopWakeFallback]);

  useEffect(() => {
    if (!modalImageId || modalTimerMs <= 0 || typeof navigator === 'undefined') {
      return;
    }
    if (!('wakeLock' in navigator)) {
      startWakeFallback();
      return;
    }
    let isActive = true;
    const requestLock = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!isActive) {
          await lock.release();
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener('release', () => {
          if (wakeLockRef.current === lock) {
            wakeLockRef.current = null;
          }
        });
      } catch {
        startWakeFallback();
      }
    };
    requestLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => undefined);
        wakeLockRef.current = null;
      }
      stopWakeFallback();
    };
  }, [modalImageId, modalTimerMs, startWakeFallback, stopWakeFallback]);

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
      modalPrefetchAbortRef.current.forEach((controller) => controller.abort());
      modalPrefetchAbortRef.current.clear();
      modalPrefetchCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      modalPrefetchCacheRef.current.clear();
      modalFullCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      modalFullCacheRef.current.clear();
      if (modalFullUrlRef.current) {
        URL.revokeObjectURL(modalFullUrlRef.current);
        modalFullUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (modalImageId) {
      setModalZoom(1);
      setModalPan({ x: 0, y: 0 });
    }
  }, [modalImageId, storeModalFullCache]);

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    setModalIsLoading(true);
    setModalFullAnimate(false);
    setModalFullImageId(null);
    setModalFullSrc(null);
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
    }
    modalFullUrlRef.current = null;
    const cacheHit = modalFullCacheRef.current.get(modalImageId);
    if (cacheHit) {
      modalFullCacheRef.current.delete(modalImageId);
      modalFullCacheRef.current.set(modalImageId, cacheHit);
      modalFullUrlRef.current = cacheHit;
      setModalFullSrc(cacheHit);
      setModalFullImageId(modalImageId);
      setModalFullAnimate(false);
      setModalIsLoading(false);
      return;
    }
    const cachedUrl = modalPrefetchCacheRef.current.get(modalImageId);
    if (cachedUrl) {
      modalPrefetchCacheRef.current.delete(modalImageId);
      modalFullUrlRef.current = cachedUrl;
      setModalFullSrc(cachedUrl);
      setModalFullImageId(modalImageId);
      setModalFullAnimate(false);
      storeModalFullCache(modalImageId, cachedUrl);
      setModalIsLoading(false);
      return;
    }
    const controller = new AbortController();
    modalFullAbortRef.current = controller;
    const url = createProxyMediaUrl(modalImageId);
    fetchImageBlob(url, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        modalFullUrlRef.current = objectUrl;
        setModalFullSrc(objectUrl);
        setModalFullImageId(modalImageId);
        setModalFullAnimate(true);
        storeModalFullCache(modalImageId, objectUrl);
        setModalIsLoading(false);
      })
      .catch((loadError) => {
        if ((loadError as Error).name === 'AbortError') {
          return;
        }
        setError((loadError as Error).message);
        setModalIsLoading(false);
      });
  }, [fetchImageBlob, modalImageId, modalLoadKey, setError, storeModalFullCache]);

  useEffect(() => {
    if (modalIndex === null || modalIndex < 0 || modalItems.length === 0) {
      return;
    }
    const prev = modalItems[modalIndex - 1]?.id;
    const next = modalItems[modalIndex + 1]?.id;
    const allowed = new Set([prev, next].filter(Boolean) as string[]);
    modalPrefetchAbortRef.current.forEach((controller, id) => {
      if (!allowed.has(id)) {
        controller.abort();
        modalPrefetchAbortRef.current.delete(id);
      }
    });
    modalPrefetchCacheRef.current.forEach((url, id) => {
      if (!allowed.has(id)) {
        URL.revokeObjectURL(url);
        modalPrefetchCacheRef.current.delete(id);
      }
    });
    prefetchModalImage(prev);
    prefetchModalImage(next);
  }, [modalIndex, modalItems, prefetchModalImage]);

  useEffect(() => {
    if (modalIndex === null || modalItems.length === 0) {
      return;
    }
    const start = Math.max(0, modalIndex - 5);
    const end = Math.min(modalItems.length, modalIndex + 6);
    prefetchThumbs(modalItems.slice(start, end));
  }, [modalIndex, modalItems, prefetchThumbs]);

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    modalImageSizeRef.current = modalImageSizeCacheRef.current.get(modalImageId) ?? null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalImageId]);

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
    setModalItems(activeImages);
    modalItemsLengthRef.current = activeImages.length;
    modalPendingAdvanceRef.current = false;
    setModalImageId(nextImage.id);
    setModalIndex(previousLength);
    triggerModalPulse();
  }, [activeImages, activeSet?.id, modalContextLabel, modalContextSetId, modalItems.length]);

  const handleModalWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    scheduleModalControlsHide(true);
    pauseModalTimer();
    scheduleModalTimerResume();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(getModalMaxZoom(), Math.max(1, modalZoom * zoomFactor));
    if (nextZoom === modalZoom) {
      return;
    }
    if (nextZoom === 1) {
      setModalZoom(1);
      setModalPan({ x: 0, y: 0 });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pointerX = event.clientX - centerX;
    const pointerY = event.clientY - centerY;
    const worldX = (pointerX - modalPan.x) / modalZoom;
    const worldY = (pointerY - modalPan.y) / modalZoom;
    const nextPanX = pointerX - worldX * nextZoom;
    const nextPanY = pointerY - worldY * nextZoom;
    setModalZoom(nextZoom);
    setModalPan(clampModalPan({ x: nextPanX, y: nextPanY }, nextZoom));
  };

  const handleModalPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    if (event.button !== 0 || modalZoom <= 1) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button') && !target.closest('.modal-nav')) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    isPanningRef.current = true;
    pauseModalTimer();
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: modalPan.x,
      originY: modalPan.y,
    };
  };

  const handleModalPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    if (!isPanningRef.current) {
      return;
    }
    pauseModalTimer();
    scheduleModalTimerResume();
    const deltaX = event.clientX - panStartRef.current.x;
    const deltaY = event.clientY - panStartRef.current.y;
    const nextPan = {
      x: panStartRef.current.originX + deltaX,
      y: panStartRef.current.originY + deltaY,
    };
    setModalPan(clampModalPan(nextPan, modalZoom));
  };

  const handleModalPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    isPanningRef.current = false;
    scheduleModalTimerResume();
  };

  const handleModalMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.movementX === 0 && event.movementY === 0) {
      return;
    }
    scheduleModalControlsHide(true);
  };

  const handleModalTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    setModalSwipeAction(null);
    setModalSwipeProgress(0);
    modalSwipeLockRef.current = null;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button') && !target.closest('.modal-nav')) {
      return;
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      modalSwipeOriginRef.current = { x: touch.clientX, y: touch.clientY };
      const now = Date.now();
      const lastTap = lastTapRef.current;
      if (lastTap) {
        const dt = now - lastTap.time;
        if (dt < 300) {
          event.preventDefault();
          lastDoubleTapRef.current = now;
          const rect = event.currentTarget.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const pointerX = touch.clientX - centerX;
          const pointerY = touch.clientY - centerY;
          const worldX = (pointerX - modalPan.x) / modalZoom;
          const worldY = (pointerY - modalPan.y) / modalZoom;
          oneHandZoomRef.current = {
            startY: touch.clientY,
            zoom: modalZoom,
            pointerX,
            pointerY,
            worldX,
            worldY,
          };
          oneHandZoomMovedRef.current = false;
          touchStartRef.current = null;
          touchLastRef.current = null;
          lastTapRef.current = null;
          return;
        }
      }
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchLastRef.current = { x: touch.clientX, y: touch.clientY };
      pinchStartRef.current = null;
      touchMovedRef.current = false;
    } else if (event.touches.length === 2) {
      const [first, second] = Array.from(event.touches);
      if (!first || !second) {
        return;
      }
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const midX = (first.clientX + second.clientX) / 2;
      const midY = (first.clientY + second.clientY) / 2;
      pinchStartRef.current = {
        distance: Math.hypot(dx, dy),
        zoom: modalZoom,
        pointerX: midX - centerX,
        pointerY: midY - centerY,
        panX: modalPan.x,
        panY: modalPan.y,
      };
      touchStartRef.current = null;
      touchLastRef.current = null;
    }
  };

  const handleModalTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    scheduleModalControlsHide(true);
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) {
      return;
    }
    if (event.touches.length === 1 && oneHandZoomRef.current) {
      event.preventDefault();
      pauseModalTimer();
      scheduleModalTimerResume();
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const deltaY = touch.clientY - oneHandZoomRef.current.startY;
      if (Math.abs(deltaY) > 2) {
        oneHandZoomMovedRef.current = true;
      }
      const zoomFactor = Math.exp(deltaY / 200);
      const nextZoom = Math.min(
        getModalMaxZoom(),
        Math.max(1, oneHandZoomRef.current.zoom * zoomFactor)
      );
      if (nextZoom === 1) {
        setModalPan({ x: 0, y: 0 });
        setModalZoom(1);
        return;
      }
      const start = oneHandZoomRef.current;
      const nextPanX = start.pointerX - start.worldX * nextZoom;
      const nextPanY = start.pointerY - start.worldY * nextZoom;
      setModalZoom(nextZoom);
      setModalPan(clampModalPan({ x: nextPanX, y: nextPanY }, nextZoom));
      return;
    }

    if (event.touches.length === 2 && pinchStartRef.current) {
      event.preventDefault();
      pauseModalTimer();
      scheduleModalTimerResume();
      const [first, second] = Array.from(event.touches);
      if (!first || !second) {
        return;
      }
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      const distance = Math.hypot(dx, dy);
      const nextZoom = Math.min(
        getModalMaxZoom(),
        Math.max(1, (distance / pinchStartRef.current.distance) * pinchStartRef.current.zoom)
      );
      if (nextZoom === 1) {
        setModalPan({ x: 0, y: 0 });
        setModalZoom(1);
        return;
      }
      const start = pinchStartRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const midX = (first.clientX + second.clientX) / 2 - centerX;
      const midY = (first.clientY + second.clientY) / 2 - centerY;
      const worldX = (start.pointerX - start.panX) / start.zoom;
      const worldY = (start.pointerY - start.panY) / start.zoom;
      const nextPanX = midX - worldX * nextZoom;
      const nextPanY = midY - worldY * nextZoom;
      setModalZoom(nextZoom);
      setModalPan(clampModalPan({ x: nextPanX, y: nextPanY }, nextZoom));
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (touchStartRef.current) {
        const origin = modalSwipeOriginRef.current ?? touchStartRef.current;
        const dx = touch.clientX - origin.x;
        const dy = touch.clientY - origin.y;
        if (modalZoom <= 1.05) {
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const hintThreshold = 20;
          const commitThreshold = 80;
          if (modalSwipeAction) {
            if (modalSwipeAction === 'favorite' || modalSwipeAction === 'close') {
              if (absY < hintThreshold) {
                setModalSwipeAction(null);
                setModalSwipeProgress(0);
                modalSwipeOriginRef.current = { x: touch.clientX, y: touch.clientY };
              } else {
                setModalSwipeProgress(Math.min(1, absY / commitThreshold));
                if (absY > commitThreshold) {
                  const shift = absY - commitThreshold;
                  const direction = dy >= 0 ? 1 : -1;
                  modalSwipeOriginRef.current = {
                    x: origin.x,
                    y: origin.y + shift * direction,
                  };
                }
              }
            } else {
              if (absX < hintThreshold) {
                setModalSwipeAction(null);
                setModalSwipeProgress(0);
                modalSwipeOriginRef.current = { x: touch.clientX, y: touch.clientY };
              } else {
                setModalSwipeProgress(Math.min(1, absX / commitThreshold));
                if (absX > commitThreshold) {
                  const shift = absX - commitThreshold;
                  const direction = dx >= 0 ? 1 : -1;
                  modalSwipeOriginRef.current = {
                    x: origin.x + shift * direction,
                    y: origin.y,
                  };
                }
              }
            }
          } else if (modalSwipeLockRef.current) {
            const locked = modalSwipeLockRef.current;
            if (locked === 'favorite' || locked === 'close') {
              const matchesDirection =
                (locked === 'favorite' && dy < 0) || (locked === 'close' && dy > 0);
              if (matchesDirection && absY > hintThreshold) {
                setModalSwipeAction(locked);
                setModalSwipeProgress(Math.min(1, absY / commitThreshold));
              } else {
                setModalSwipeProgress(0);
              }
            } else {
              const matchesDirection =
                (locked === 'prev' && dx > 0) || (locked === 'next' && dx < 0);
              if (matchesDirection && absX > hintThreshold) {
                setModalSwipeAction(locked);
                setModalSwipeProgress(Math.min(1, absX / commitThreshold));
              } else {
                setModalSwipeProgress(0);
              }
            }
          } else if (absY > absX && absY > hintThreshold) {
            const action = dy < 0 ? 'favorite' : 'close';
            if (modalSwipeLockRef.current && modalSwipeLockRef.current !== action) {
              setModalSwipeProgress(0);
              return;
            }
            setModalSwipeAction(action);
            setModalSwipeProgress(Math.min(1, absY / commitThreshold));
            modalSwipeLockRef.current = action;
          } else if (absX > absY && absX > hintThreshold) {
            const action = dx > 0 ? 'prev' : 'next';
            if (modalSwipeLockRef.current && modalSwipeLockRef.current !== action) {
              setModalSwipeProgress(0);
              return;
            }
            setModalSwipeAction(action);
            setModalSwipeProgress(Math.min(1, absX / commitThreshold));
            modalSwipeLockRef.current = action;
          }
        }
        if (Math.hypot(dx, dy) > 10) {
          touchMovedRef.current = true;
        }
      }
      if (modalZoom > 1 && touchLastRef.current) {
        event.preventDefault();
        pauseModalTimer();
        scheduleModalTimerResume();
        const deltaX = touch.clientX - touchLastRef.current.x;
        const deltaY = touch.clientY - touchLastRef.current.y;
        setModalPan((current) =>
          clampModalPan({ x: current.x + deltaX, y: current.y + deltaY }, modalZoom)
        );
      }
      touchLastRef.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleModalTouchEnd = () => {
    if (pinchStartRef.current) {
      pinchStartRef.current = null;
      scheduleModalTimerResume();
      return;
    }
    if (oneHandZoomRef.current) {
      const shouldReset = !oneHandZoomMovedRef.current;
      oneHandZoomRef.current = null;
      oneHandZoomMovedRef.current = false;
      if (shouldReset) {
        setModalZoom(1);
        setModalPan({ x: 0, y: 0 });
      }
      scheduleModalTimerResume();
      return;
    }
    if (!touchStartRef.current || !touchLastRef.current) {
      touchStartRef.current = null;
      touchLastRef.current = null;
      modalSwipeOriginRef.current = null;
      return;
    }
    const tapDx = touchLastRef.current.x - touchStartRef.current.x;
    const tapDy = touchLastRef.current.y - touchStartRef.current.y;
    const origin = modalSwipeOriginRef.current ?? touchStartRef.current;
    const dx = touchLastRef.current.x - origin.x;
    const dy = touchLastRef.current.y - origin.y;
    const rawAbsX = Math.abs(tapDx);
    const rawAbsY = Math.abs(tapDy);
    const swipeThreshold = 60;
    const verticalThreshold = 80;

    if (modalSwipeLockRef.current) {
      if (
        modalSwipeAction &&
        modalSwipeAction === modalSwipeLockRef.current &&
        modalSwipeProgress >= 1 &&
        modalZoom <= 1.05
      ) {
        if (modalSwipeAction === 'next') {
          goNextImage();
        } else if (modalSwipeAction === 'prev') {
          goPrevImage();
        } else if (modalSwipeAction === 'favorite') {
          toggleFavoriteFromModal();
        } else if (modalSwipeAction === 'close') {
          closeModal();
        }
      }
    } else if (
      !modalSwipeAction &&
      rawAbsX > rawAbsY &&
      rawAbsX > swipeThreshold &&
      modalZoom <= 1.05
    ) {
      if (tapDx < 0) {
        goNextImage();
      } else {
        goPrevImage();
      }
    } else if (!modalSwipeAction && tapDy < -verticalThreshold && modalZoom <= 1.05) {
      toggleFavoriteFromModal();
    } else if (!modalSwipeAction && tapDy > verticalThreshold && modalZoom <= 1.05) {
      closeModal();
    }

    if (!touchMovedRef.current && Math.abs(tapDx) < 6 && Math.abs(tapDy) < 6) {
      const zoneWidth = 88;
      const startX = touchStartRef.current.x;
      const viewportWidth = window.innerWidth;
      if (startX <= zoneWidth) {
        goPrevImage();
        touchStartRef.current = null;
        touchLastRef.current = null;
        touchMovedRef.current = false;
        setModalSwipeAction(null);
        setModalSwipeProgress(0);
        return;
      }
      if (startX >= viewportWidth - zoneWidth) {
        goNextImage();
        touchStartRef.current = null;
        touchLastRef.current = null;
        touchMovedRef.current = false;
        setModalSwipeAction(null);
        setModalSwipeProgress(0);
        return;
      }
      lastTapRef.current = { time: Date.now(), x: touchStartRef.current.x, y: touchStartRef.current.y };
    }
    setModalSwipeAction(null);
    setModalSwipeProgress(0);
    modalSwipeLockRef.current = null;
    modalSwipeOriginRef.current = null;
    touchStartRef.current = null;
    touchLastRef.current = null;
    touchMovedRef.current = false;
  };

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
    onModalFullLoad: handleModalFullLoad,
    onModalWheel: handleModalWheel,
    onModalPointerDown: handleModalPointerDown,
    onModalPointerMove: handleModalPointerMove,
    onModalPointerUp: handleModalPointerUp,
    onModalMouseMove: handleModalMouseMove,
    onModalTouchStart: handleModalTouchStart,
    onModalTouchMove: handleModalTouchMove,
    onModalTouchEnd: handleModalTouchEnd,
    onSelectModalTimer: handleSelectModalTimer,
    onResetModalTimer: resetModalTimer,
    onToggleTimerMenu: () => {
      setModalControlsVisible(true);
      setIsModalTimerOpen((current) => !current);
    },
    onOpenChronologicalContext: openModalChronologicalContext,
    onRestoreModalContext: restoreModalContext,
    onToggleFavoriteFromModal: toggleFavoriteFromModal,
    onPrevImage: goPrevImage,
    onNextImage: goNextImage,
    onCloseModal: closeModal,
  };

  return { modalState, openModal, closeModal };
}
