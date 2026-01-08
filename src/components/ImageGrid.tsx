import { IconHeart, IconHeartFilled, IconPhotoStar } from '@tabler/icons-react';
import type { RefObject } from 'react';
import type { DriveImage } from '../drive/types';
import { ImageThumb } from './ImageThumb';
import { useModal } from '../features/modal/ModalContext';

type FavoriteAction = {
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
  favoriteAction?: FavoriteAction;
  thumbnailAction?: ThumbnailAction;
};

export function ImageGrid({
  images,
  isConnected,
  thumbSize,
  alt,
  modalLabel,
  gridClassName = 'image-grid',
  gridRef,
  favoriteAction,
  thumbnailAction,
}: ImageGridProps) {
  const { openModal } = useModal();
  const resolveAlt = (image: DriveImage) => (typeof alt === 'string' ? alt : alt(image));

  return (
    <div className={gridClassName} ref={gridRef}>
      {images.map((image) => {
        const isFavorite = favoriteAction?.isActive(image) ?? false;
        const canToggleFavorite = favoriteAction ? !favoriteAction.disabled?.(image) : false;
        const isThumbnail = thumbnailAction?.isActive(image) ?? false;
        const canSetThumbnail = thumbnailAction ? !thumbnailAction.disabled?.(image) : false;
        return (
          <div key={image.id} className="image-tile">
            <button
              type="button"
              className="image-button"
              onClick={() => openModal(image.id, images, modalLabel)}
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
    </div>
  );
}
