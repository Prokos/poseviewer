import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUpRight,
  IconDownload,
  IconEyeOff,
  IconLoader2,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { SourceImage } from '../sources/types';
import { useModalGestures } from '../features/modal/useModalGestures';

type SourceModalViewerProps = {
  isOpen: boolean;
  images: SourceImage[];
  index: number;
  label: string;
  downloadImageIdSet?: Set<string>;
  downloadedImageIdSet?: Set<string>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRequestFull: (
    image: SourceImage
  ) => Promise<void | { url: string; width?: number; height?: number } | null>;
  onDownload: (image: SourceImage) => void;
  onHide: (image: SourceImage) => void;
  onOpenSet?: (image: SourceImage) => void;
  isDownloading?: boolean;
};

export function SourceModalViewer({
  isOpen,
  images,
  index,
  label,
  onClose,
  onPrev,
  onNext,
  onRequestFull,
  onDownload,
  onHide,
  onOpenSet,
  downloadImageIdSet,
  downloadedImageIdSet,
}: SourceModalViewerProps) {
  const image = images[index];
  const isDownloadingCurrent = Boolean(image?.id && downloadImageIdSet?.has(image.id));
  const isDownloadedCurrent = Boolean(image?.id && downloadedImageIdSet?.has(image.id));
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
  const modalImageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const ignoreNextFullscreenRef = useRef(false);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Ignore fullscreen exit failures.
      });
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {
      // Ignore fullscreen failures (unsupported or user gesture blocked).
    });
  };
  const noop = useCallback(() => {}, []);
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
    modalImageId: image?.id ?? null,
    modalZoom,
    modalPan,
    setModalZoom,
    setModalPan,
    modalImageSizeRef,
    scheduleModalControlsHide: noop,
    pauseModalTimer: noop,
    scheduleModalTimerResume: noop,
    goPrevImage: onPrev,
    goNextImage: () => onNext(),
    onToggleFavoriteFromModal: () => {
      if (image && !isDownloadingCurrent && !isDownloadedCurrent) {
        onDownload(image);
      }
    },
    onCloseModal: onClose,
    mouseZoomMode: false,
  });
  const handleImageSize = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    if (target.naturalWidth && target.naturalHeight) {
      modalImageSizeRef.current = {
        width: target.naturalWidth,
        height: target.naturalHeight,
      };
    }
  }, []);

  useEffect(() => {
    document.body.dataset.modalOpen = isOpen ? 'true' : 'false';
    const event = new CustomEvent('poseviewer-modal', { detail: { open: isOpen } });
    window.dispatchEvent(event);
    if (isOpen) {
      document.documentElement.requestFullscreen().catch(() => {
        // Ignore fullscreen failures (unsupported or user gesture blocked).
      });
    } else if (document.fullscreenElement) {
      ignoreNextFullscreenRef.current = true;
      document.exitFullscreen().catch(() => {
        // Ignore fullscreen exit failures.
      });
    }
    return () => {
      document.body.dataset.modalOpen = 'false';
      window.dispatchEvent(new CustomEvent('poseviewer-modal', { detail: { open: false } }));
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleFullscreenChange = () => {
      if (ignoreNextFullscreenRef.current) {
        ignoreNextFullscreenRef.current = false;
        return;
      }
      if (!document.fullscreenElement) {
        onClose();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !image || (image.fullUrl && image.fullUrl !== image.thumbUrl)) {
      return;
    }
    setIsLoadingFull(true);
    setIsImageLoaded(false);
    onRequestFull(image)
      .catch(() => {
        // Ignore errors; fallback to thumb.
      })
      .finally(() => setIsLoadingFull(false));
  }, [image, isOpen, onRequestFull]);

  useEffect(() => {
    setIsImageLoaded(false);
    setDisplaySrc(image?.fullUrl ?? null);
  }, [image?.id]);

  useEffect(() => {
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
  }, [image?.id]);

  useEffect(() => {
    if (!image?.fullUrl) {
      return;
    }
    setIsImageLoaded(false);
    setIsLoadingFull(true);
    setDisplaySrc(image.fullUrl);
  }, [image?.fullUrl]);

  useEffect(() => {
    if (!image) {
      return;
    }
    if (image.fullUrl && displaySrc === image.thumbUrl) {
      setIsImageLoaded(false);
      setIsLoadingFull(true);
      setDisplaySrc(image.fullUrl);
    }
  }, [displaySrc, image]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        onPrev();
      } else if (event.key === 'ArrowRight') {
        onNext();
      } else if (event.key.toLowerCase() === 'f' && event.shiftKey) {
        toggleFullscreen();
      } else if (event.key.toLowerCase() === 'h') {
        onHide(image);
      } else if (event.key.toLowerCase() === 'd') {
        onDownload(image);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [image, isOpen, onClose, onDownload, onHide, onNext, onPrev, toggleFullscreen]);

  if (!isOpen || !image) {
    return null;
  }

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const fullSrc = displaySrc;
  const showLoader = isLoadingFull || !isImageLoaded;

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(event) => event.stopPropagation()}
        onWheel={handleModalWheel}
        onPointerDown={handleModalPointerDown}
        onPointerMove={handleModalPointerMove}
        onPointerUp={handleModalPointerUp}
        onPointerCancel={handleModalPointerUp}
        onMouseMove={handleModalMouseMove}
        onTouchStartCapture={handleModalTouchStart}
        onTouchMoveCapture={handleModalTouchMove}
        onTouchEndCapture={handleModalTouchEnd}
        onTouchCancelCapture={handleModalTouchEnd}
      >
        <button
          type="button"
          className="modal-close modal-close--source"
          onClick={onClose}
          aria-label="Close"
        >
          <IconX size={22} />
        </button>
        <div
          className={`modal-media ${modalZoom > 1 ? 'is-zoomed' : ''}`}
          ref={modalMediaRef}
          style={{
            transform: `translate(${modalPan.x}px, ${modalPan.y}px) scale(${modalZoom})`,
            ['--modal-pan-x' as string]: `${modalPan.x}px`,
            ['--modal-pan-y' as string]: `${modalPan.y}px`,
            ['--modal-zoom' as string]: String(modalZoom),
          }}
        >
          {image.thumbUrl ? (
            <img
              className="modal-thumb"
              src={image.thumbUrl}
              alt={label}
              referrerPolicy="no-referrer"
              onLoad={handleImageSize}
            />
          ) : null}
          {fullSrc ? (
            <img
              className={`modal-full ${isImageLoaded ? 'is-loaded' : ''}`}
              src={fullSrc}
              alt={label}
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                setIsLoadingFull(false);
                setIsImageLoaded(true);
                handleImageSize(event);
              }}
              onError={() => {
                setIsLoadingFull(false);
              }}
            />
          ) : null}
          {showLoader ? (
            <div className="modal-status is-visible">
              <div className="modal-status-inner pulse">
                <IconLoader2 size={18} />
                <span>Loading full size…</span>
              </div>
            </div>
          ) : null}
          {modalSwipeAction === 'close' ? (
            <div
              className="modal-swipe-close"
              style={{
                opacity: 0.2 + modalSwipeProgress * 0.8,
                transform: `translate(-50%, calc(-50% - ${(1 - modalSwipeProgress) * 48}px))`,
              }}
            >
              <IconX size={36} />
            </div>
          ) : null}
          {modalSwipeAction === 'favorite' ? (
            <div
              className="modal-swipe-download"
              style={{
                opacity: 0.2 + modalSwipeProgress * 0.8,
                transform: `translate(-50%, calc(-50% + ${(1 - modalSwipeProgress) * 48}px))`,
              }}
            >
              <IconDownload size={1} />
            </div>
          ) : null}
          {modalSwipeAction === 'prev' || modalSwipeAction === 'next' ? (
            <div
              className={`modal-swipe-arrow ${modalSwipeAction === 'prev' ? 'is-prev' : 'is-next'}`}
              style={{
                opacity: 0.2 + modalSwipeProgress * 0.8,
                transform:
                  modalSwipeAction === 'prev'
                    ? `translate(${(1 - modalSwipeProgress) * -48}px, -50%)`
                    : `translate(${(1 - modalSwipeProgress) * 48}px, -50%)`,
              }}
            >
              {modalSwipeAction === 'prev' ? (
                <IconArrowLeft size={28} />
              ) : (
                <IconArrowRight size={28} />
              )}
            </div>
          ) : null}
        </div>
        {isDownloadingCurrent ? (
          <div className="modal-download-pulse" aria-hidden="true">
            <IconDownload size={1} />
          </div>
        ) : null}
        <div className="modal-source-actions">
          <div className="modal-source-context">{label}</div>
          <div className="modal-source-buttons">
            {onOpenSet ? (
              <button type="button" className="ghost" onClick={() => onOpenSet(image)}>
                <IconArrowUpRight size={16} />
                Open set
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={() => onHide(image)}>
              <IconEyeOff size={16} />
              Hide
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onDownload(image)}
              disabled={isDownloadingCurrent || isDownloadedCurrent}
            >
              <IconDownload size={16} />
              {isDownloadingCurrent
                ? 'Downloading…'
                : isDownloadedCurrent
                  ? 'Downloaded'
                  : 'Download'}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="modal-nav modal-nav--prev"
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Previous image"
        >
          <IconArrowLeft size={22} />
        </button>
        <button
          type="button"
          className="modal-nav modal-nav--next"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next image"
        >
          <IconArrowRight size={22} />
        </button>
      </div>
    </div>
  );
}
