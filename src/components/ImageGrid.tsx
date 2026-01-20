import { IconEye, IconEyeOff, IconHeart, IconHeartFilled, IconPhotoStar } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DriveImage } from '../drive/types';
import { ImageThumb } from './ImageThumb';
import { useModalActions } from '../features/modal/ModalContext';

type FavoriteAction = {
  isActive: (image: DriveImage) => boolean;
  onToggle: (image: DriveImage) => void;
  disabled?: (image: DriveImage) => boolean;
};

type HideAction = {
  isActive: (image: DriveImage) => boolean;
  onToggle: (image: DriveImage) => void;
  disabled?: (image: DriveImage) => boolean;
};

type ThumbnailAction = {
  isActive: (image: DriveImage) => boolean;
  onSet: (image: DriveImage) => void;
  disabled?: (image: DriveImage) => boolean;
};

type ImageGridProps = {
  images: DriveImage[];
  isConnected: boolean;
  thumbSize: number;
  alt: string | ((image: DriveImage) => string);
  modalLabel: string;
  gridClassName?: string;
  gridRef?: RefObject<HTMLDivElement>;
  virtualize?: boolean;
  favoriteAction?: FavoriteAction;
  hideAction?: HideAction;
  showHiddenAction?: boolean;
  thumbnailAction?: ThumbnailAction;
  highlightedImageId?: string | null;
};

export function ImageGrid({
  images,
  isConnected,
  thumbSize,
  alt,
  modalLabel,
  gridClassName = 'image-grid',
  gridRef,
  virtualize = false,
  favoriteAction,
  hideAction,
  showHiddenAction = false,
  thumbnailAction,
  highlightedImageId,
}: ImageGridProps) {
  const { openModal } = useModalActions();
  const resolveAlt = (image: DriveImage) => (typeof alt === 'string' ? alt : alt(image));
  const localGridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [gridTop, setGridTop] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rafRef = useRef<number | null>(null);
  const minColWidth = 160;
  const gap = 4;

  const setMergedRef = (node: HTMLDivElement | null) => {
    localGridRef.current = node;
    if (gridRef) {
      gridRef.current = node;
    }
  };

  useEffect(() => {
    const node = localGridRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setGridWidth(rect.width);
      setGridTop(rect.top + window.scrollY);
      setViewportHeight(window.innerHeight);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => measure());
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current !== null) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollY(window.scrollY);
      });
    };
    setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const gridMetrics = useMemo(() => {
    if (!virtualize || gridWidth <= 0) {
      return null;
    }
    const columns = Math.max(1, Math.floor((gridWidth + gap) / (minColWidth + gap)));
    const itemWidth = Math.max(
      minColWidth,
      Math.floor((gridWidth - gap * (columns - 1)) / columns)
    );
    const rowStride = itemWidth + gap;
    return { columns, itemWidth, rowStride };
  }, [gridWidth, virtualize]);

  const { startIndex, endIndex, spacerBefore, spacerAfter } = useMemo(() => {
    if (!gridMetrics || images.length === 0) {
      return { startIndex: 0, endIndex: images.length, spacerBefore: 0, spacerAfter: 0 };
    }
    const { columns, rowStride } = gridMetrics;
    const totalRows = Math.ceil(images.length / columns);
    const rawStartRow = Math.floor((scrollY - gridTop) / rowStride);
    const rawEndRow = Math.floor((scrollY + viewportHeight - gridTop) / rowStride);
    const overscan = 2;
    const startRow = Math.max(0, rawStartRow - overscan);
    const endRow = Math.min(totalRows - 1, rawEndRow + overscan);
    const startIndex = Math.max(0, startRow * columns);
    const endIndex = Math.min(images.length, (endRow + 1) * columns);
    const spacerBefore = Math.max(0, startRow * rowStride - gap);
    const remainingRows = Math.max(0, totalRows - endRow - 1);
    const spacerAfter = Math.max(0, remainingRows * rowStride - gap);
    return { startIndex, endIndex, spacerBefore, spacerAfter };
  }, [gridMetrics, gridTop, images.length, scrollY, viewportHeight]);

  const visibleImages =
    gridMetrics && virtualize ? images.slice(startIndex, endIndex) : images;
  const baseIndex = gridMetrics && virtualize ? startIndex : 0;

  return (
    <div className={gridClassName} ref={setMergedRef}>
      {gridMetrics && virtualize && spacerBefore > 0 ? (
        <div className="image-grid-spacer" style={{ height: spacerBefore }} />
      ) : null}
      {visibleImages.map((image, index) => {
        const absoluteIndex = baseIndex + index;
        const isFavorite = favoriteAction?.isActive(image) ?? false;
        const canToggleFavorite = favoriteAction ? !favoriteAction.disabled?.(image) : false;
        const isHidden = hideAction?.isActive(image) ?? false;
        const canToggleHidden = hideAction ? !hideAction.disabled?.(image) : false;
        const isThumbnail = thumbnailAction?.isActive(image) ?? false;
        const canSetThumbnail = thumbnailAction ? !thumbnailAction.disabled?.(image) : false;
        const isHighlighted = highlightedImageId === image.id;
        return (
          <div
            key={image.id}
            className={`image-tile${isHighlighted ? ' is-scroll-target' : ''}`}
            data-image-id={image.id}
          >
            <button
              type="button"
              className="image-button"
              onClick={() => openModal(image.id, images, modalLabel, absoluteIndex)}
            >
              <ImageThumb
                isConnected={isConnected}
                fileId={image.id}
                alt={resolveAlt(image)}
                size={thumbSize}
              />
            </button>
            {favoriteAction ? (
              <button
                type="button"
                className={`thumb-action thumb-action--favorite ${isFavorite ? 'is-active' : ''}`}
                onClick={() => favoriteAction.onToggle(image)}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                disabled={!canToggleFavorite}
              >
                {isFavorite ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
              </button>
            ) : null}
            {hideAction && (!isHidden || showHiddenAction) ? (
              <button
                type="button"
                className="thumb-action thumb-action--hide"
                onClick={() => hideAction.onToggle(image)}
                aria-pressed={isHidden}
                aria-label={isHidden ? 'Unhide image' : 'Hide image'}
                disabled={!canToggleHidden}
              >
                {isHidden ? <IconEye size={16} /> : <IconEyeOff size={16} />}
              </button>
            ) : null}
            {thumbnailAction ? (
              <button
                type="button"
                className={`thumb-action ${isThumbnail ? 'is-active' : ''}`}
                onClick={() => thumbnailAction.onSet(image)}
                disabled={!canSetThumbnail}
                aria-label="Use as thumbnail"
              >
                <IconPhotoStar size={16} />
              </button>
            ) : null}
          </div>
        );
      })}
      {gridMetrics && virtualize && spacerAfter > 0 ? (
        <div className="image-grid-spacer" style={{ height: spacerAfter }} />
      ) : null}
    </div>
  );
}
