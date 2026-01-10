import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { DriveImage } from '../../drive/types';
import { createProxyMediaUrl } from '../../utils/driveUrls';

type UseModalMediaOptions = {
  modalImageId: string | null;
  modalIndex: number | null;
  modalItems: DriveImage[];
  modalLoadKey: number;
  prefetchThumbs: (images: DriveImage[]) => void;
  setError: (message: string) => void;
};

export function useModalMedia({
  modalImageId,
  modalIndex,
  modalItems,
  modalLoadKey,
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
  const modalFullCacheMax = 20;
  const modalImageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const modalImageSizeCacheRef = useRef<Map<string, { width: number; height: number }>>(
    new Map()
  );

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
    setModalLoadingCount(modalIsLoading ? 1 : modalPrefetchCount);
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

  const fetchImageBlob = useCallback(async (url: string, signal: AbortSignal) => {
    const response = await fetch(url, { signal, cache: 'force-cache' });
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
      setModalPrefetchCount(modalPrefetchAbortRef.current.size);
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
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
    }
    if (modalFullDelayRef.current) {
      window.clearTimeout(modalFullDelayRef.current);
      modalFullDelayRef.current = null;
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
    setModalFullImageId(null);
    setModalFullSrc(null);
    modalFullDelayRef.current = window.setTimeout(() => {
      setModalIsLoading(true);
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
      modalFullDelayRef.current = null;
    }, modalFullDelayMs);
  }, [fetchImageBlob, modalImageId, modalLoadKey, setError, storeModalFullCache]);

  useEffect(() => {
    if (modalIndex === null || modalIndex < 0 || modalItems.length === 0) {
      return;
    }
    const range = 3;
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
    nextIds.forEach((id) => prefetchModalImage(id));
  }, [modalIndex, modalItems, prefetchModalImage]);

  useEffect(() => {
    if (modalIndex === null || modalItems.length === 0) {
      return;
    }
    const range = 6;
    const start = Math.max(0, modalIndex - range);
    const end = Math.min(modalItems.length, modalIndex + range + 1);
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
    return () => {
      clearModalMediaCache();
    };
  }, [clearModalMediaCache]);

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
