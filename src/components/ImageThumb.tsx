import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEventHandler } from 'react';
import { createProxyThumbUrl } from '../utils/driveUrls';
import { useImageCache } from '../features/imageCache/ImageCacheContext';

type ImageThumbProps = {
  isConnected: boolean;
  fileId: string;
  alt: string;
  size: number;
  thumbPos?: number;
  hoverScroll?: boolean;
  eager?: boolean;
  containerRef?: MutableRefObject<HTMLDivElement | null>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
};

export function ImageThumb({
  isConnected,
  fileId,
  alt,
  size,
  thumbPos,
  hoverScroll = true,
  eager = false,
  containerRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: ImageThumbProps) {
  const { cacheKey } = useImageCache();
  const localRef = useRef<HTMLDivElement | null>(null);
  const [observerNode, setObserverNode] = useState<HTMLDivElement | null>(null);
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const loadDelayRef = useRef<number | null>(null);
  const resolvedRef = containerRef ?? localRef;
  const resolvedPos = thumbPos ?? 50;
  const loadDelayMs = 120;
  const setRef = (node: HTMLDivElement | null) => {
    localRef.current = node;
    setObserverNode(node);
    if (containerRef) {
      containerRef.current = node;
    }
  };

  useEffect(() => {
    if (eager) {
      setIsInView(true);
      setIsLoaded(false);
      setHasError(false);
      return;
    }
    setIsInView(false);
    setIsLoaded(false);
    setHasError(false);
  }, [eager, fileId]);

  useEffect(() => {
    if (eager || isInView || isModalOpen) {
      return;
    }
    const node = observerNode;
    if (!node) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }
    const margin = Math.max(0, Math.round(window.innerHeight * 0.33));
    try {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              if (loadDelayRef.current !== null) {
                return;
              }
              loadDelayRef.current = window.setTimeout(() => {
                setIsInView(true);
                observer.disconnect();
                loadDelayRef.current = null;
              }, loadDelayMs);
              return;
            }
            if (loadDelayRef.current !== null) {
              window.clearTimeout(loadDelayRef.current);
              loadDelayRef.current = null;
            }
          }
        },
        { rootMargin: `${margin}px 0px`, threshold: 0.01 }
      );
      observer.observe(node);
      return () => {
        observer.disconnect();
        if (loadDelayRef.current !== null) {
          window.clearTimeout(loadDelayRef.current);
          loadDelayRef.current = null;
        }
      };
    } catch {
      setIsInView(true);
      return;
    }
  }, [eager, isInView, isModalOpen, observerNode]);

  useEffect(() => {
    const readModalState = () => document.body.dataset.modalOpen === 'true';
    setIsModalOpen(readModalState());
    const handleModalToggle = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.open === 'boolean') {
        setIsModalOpen(event.detail.open);
      } else {
        setIsModalOpen(readModalState());
      }
    };
    window.addEventListener('poseviewer-modal', handleModalToggle);
    return () => {
      window.removeEventListener('poseviewer-modal', handleModalToggle);
    };
  }, []);
  if (!fileId) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  if (!isConnected) {
    return <div className="thumb thumb--empty">Connect to load</div>;
  }

  const shouldLoad = eager || (isInView && (!isModalOpen || isLoaded));

  return (
    <div
      className={`thumb${isLoaded && !hasError ? ' is-loaded' : ''}${
        hasError ? ' is-error' : ''
      }`}
      ref={setRef}
      style={{ ['--thumb-pos' as string]: `${resolvedPos}%` }}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseMove={
        hoverScroll
          ? (event) => {
              const bounds = resolvedRef.current?.getBoundingClientRect();
              if (!bounds) {
                return;
              }
              const y = event.clientY - bounds.top;
              const raw = y / bounds.height;
              const clamped = Math.min(1, Math.max(0, raw));
              const start = 0.2;
              const end = 0.8;
              let percent = 0;
              if (clamped <= start) {
                percent = 0;
              } else if (clamped >= end) {
                percent = 100;
              } else {
                percent = ((clamped - start) / (end - start)) * 100;
              }
              resolvedRef.current?.style.setProperty('--thumb-pos', `${percent}%`);
            }
          : undefined
      }
      onMouseLeave={
        hoverScroll
          ? () => {
              resolvedRef.current?.style.setProperty('--thumb-pos', `${resolvedPos}%`);
            }
          : undefined
      }
    >
      {shouldLoad && !hasError ? (
        <img
          src={createProxyThumbUrl(fileId, size, cacheKey)}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      ) : null}
    </div>
  );
}
