import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { DriveImage } from '../../drive/types';
import { createProxyMediaUrl } from '../../utils/driveUrls';

type UseModalMediaOptions = {
  modalImageId: string | null;
  modalIndex: number | null;
  modalItems: DriveImage[];
  modalLoadKey: number;
  cacheKey: number;
  prefetchThumbs: (images: DriveImage[]) => void;
  setError: (message: string) => void;
};

export function useModalMedia({
  modalImageId,
  modalIndex,
  modalItems,
  modalLoadKey,
  cacheKey,
  prefetchThumbs,
  setError,
}: UseModalMediaOptions) {
  const modalFullDelayMs = 140;
  const [modalIsLoading, setModalIsLoading] = useState(false);
  const [modalPrefetchCount, setModalPrefetchCount] = useState(0);
  const [modalLoadingCount, setModalLoadingCount] = useState(0);
  const [modalFullSrc, setModalFullSrc] = useState<string | null>(null);
  const [modalFullImageId, setModalFullImageId] = useState<string | null>(null);
  const [modalFullAnimate, setModalFullAnimate] = useState(false);
  const modalFullAbortRef = useRef<AbortController | null>(null);
  const modalFullDelayRef = useRef<number | null>(null);
  const modalFullUrlRef = useRef<string | null>(null);
  const modalPrefetchAbortRef = useRef<Map<string, AbortController>>(new Map());
  const modalPrefetchCacheRef = useRef<Map<string, string>>(new Map());
  const modalFullCacheRef = useRef<Map<string, string>>(new Map());
  const modalIdlePrefetchRef = useRef<number | null>(null);
  const modalFullCacheMax = 20;
  const modalImageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const modalImageSizeCacheRef = useRef<Map<string, { width: number; height: number }>>(
    new Map()
  );

  const cancelPrefetches = useCallback(() => {
    modalPrefetchAbortRef.current.forEach((controller) => controller.abort());
    modalPrefetchAbortRef.current.clear();
    setModalPrefetchCount(0);
  }, []);

  const cancelIdlePrefetch = useCallback(() => {
    if (modalIdlePrefetchRef.current === null) {
      return;
    }
    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(modalIdlePrefetchRef.current);
    } else {
      window.clearTimeout(modalIdlePrefetchRef.current);
    }
    modalIdlePrefetchRef.current = null;
  }, []);

  const resetModalMediaState = useCallback(() => {
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
  }, []);

  const stopModalLoading = useCallback(() => {
    setModalIsLoading(false);
  }, []);

  const clearModalMediaCache = useCallback(() => {
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
      modalFullAbortRef.current = null;
    }
    if (modalFullDelayRef.current) {
      window.clearTimeout(modalFullDelayRef.current);
      modalFullDelayRef.current = null;
    }
    if (modalFullUrlRef.current) {
      const cached = Array.from(modalFullCacheRef.current.values()).includes(
        modalFullUrlRef.current
      );
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
    setModalPrefetchCount(0);
  }, []);

  useEffect(() => {
    setModalLoadingCount((modalIsLoading ? 1 : 0) + modalPrefetchCount);
  }, [modalIsLoading, modalPrefetchCount]);

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

  const waitForRetry = useCallback((ms: number, signal: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timeout = window.setTimeout(() => {
        signal.removeEventListener('abort', handleAbort);
        resolve();
      }, ms);
      const handleAbort = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', handleAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }, []);

  const fetchImageBlob = useCallback(async (url: string, signal: AbortSignal) => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, { signal, cache: 'force-cache' });
      if (response.status === 429) {
        lastStatus = response.status;
        if (attempt < 2) {
          await waitForRetry(200 * 2 ** attempt, signal);
          continue;
        }
      }
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
    }
    throw new Error(`Image load failed: ${lastStatus || 429}`);
  }, [waitForRetry]);

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
      setModalPrefetchCount(modalPrefetchAbortRef.current.size);
      const url = createProxyMediaUrl(imageId, cacheKey);
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
          setModalPrefetchCount(modalPrefetchAbortRef.current.size);
        });
    },
    [fetchImageBlob, setError]
  );

  const onModalFullLoad = useCallback(
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

  useEffect(() => {
    if (!modalImageId) {
      setModalIsLoading(false);
      return;
    }
    setModalFullAnimate(false);
    cancelPrefetches();
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
    }
    if (modalFullDelayRef.current) {
      window.clearTimeout(modalFullDelayRef.current);
      modalFullDelayRef.current = null;
    }
    cancelIdlePrefetch();
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
    setModalFullImageId(null);
    setModalFullSrc(null);
    modalFullDelayRef.current = window.setTimeout(() => {
      setModalIsLoading(true);
      cancelPrefetches();
      const controller = new AbortController();
      modalFullAbortRef.current = controller;
      const url = createProxyMediaUrl(modalImageId, cacheKey);
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
      modalFullDelayRef.current = null;
    }, modalFullDelayMs);
  }, [
    cancelPrefetches,
    fetchImageBlob,
    modalImageId,
    modalLoadKey,
    cacheKey,
    setError,
    storeModalFullCache,
  ]);

  useEffect(() => {
    if (
      modalIndex === null ||
      modalIndex < 0 ||
      modalItems.length === 0 ||
      modalFullImageId !== modalImageId ||
      modalIsLoading
    ) {
      return;
    }
    const range = 1;
    const nextIds: string[] = [];
    for (let offset = 1; offset <= range; offset += 1) {
      const prev = modalItems[modalIndex - offset]?.id;
      const next = modalItems[modalIndex + offset]?.id;
      if (prev) {
        nextIds.push(prev);
      }
      if (next) {
        nextIds.push(next);
      }
    }
    const allowed = new Set(nextIds);
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
    setModalPrefetchCount(modalPrefetchAbortRef.current.size);
    cancelIdlePrefetch();
    const currentImageId = modalImageId;
    const schedule =
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback
        : (callback: () => void) => window.setTimeout(callback, 250);
    modalIdlePrefetchRef.current = schedule(() => {
      modalIdlePrefetchRef.current = null;
      if (modalImageId !== currentImageId) {
        return;
      }
      nextIds.forEach((id) => prefetchModalImage(id));
    });
  }, [
    cancelIdlePrefetch,
    modalFullImageId,
    modalImageId,
    modalIndex,
    modalIsLoading,
    modalItems,
    prefetchModalImage,
  ]);

  useEffect(() => {
    if (!modalImageId || modalIndex === null || modalItems.length === 0) {
      return;
    }
    const range = 1;
    const start = Math.max(0, modalIndex - range);
    const end = Math.min(modalItems.length, modalIndex + range + 1);
    prefetchThumbs(modalItems.slice(start, end));
  }, [modalImageId, modalIndex, modalItems, prefetchThumbs]);

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    modalImageSizeRef.current = modalImageSizeCacheRef.current.get(modalImageId) ?? null;
    const previousOverflow = document.body.style.overflow;
    document.body.dataset.modalOpen = 'true';
    window.dispatchEvent(new CustomEvent('poseviewer-modal', { detail: { open: true } }));
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.dataset.modalOpen = 'false';
      window.dispatchEvent(new CustomEvent('poseviewer-modal', { detail: { open: false } }));
      document.body.style.overflow = previousOverflow;
    };
  }, [modalImageId]);

  useEffect(() => {
    return () => {
      cancelIdlePrefetch();
      clearModalMediaCache();
    };
  }, [cancelIdlePrefetch, clearModalMediaCache]);

  return {
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
  };
}
