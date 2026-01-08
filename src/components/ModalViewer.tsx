import {
  IconArrowLeft,
  IconArrowRight,
  IconClock,
  IconHeart,
  IconHeartFilled,
  IconLoader2,
  IconRefresh,
  IconTimeline,
  IconX,
} from '@tabler/icons-react';
import { createProxyThumbUrl } from '../utils/driveUrls';
import type { ModalViewerState } from '../hooks/useModalViewer';

type ModalViewerProps = ModalViewerState & { thumbSize: number };

export function ModalViewer({
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
  onModalWheel,
  onModalPointerDown,
  onModalPointerMove,
  onModalPointerUp,
  onModalMouseMove,
  onModalTouchStart,
  onModalTouchMove,
  onModalTouchEnd,
  onSelectModalTimer,
  onResetModalTimer,
  onToggleTimerMenu,
  onOpenChronologicalContext,
  onRestoreModalContext,
  onToggleFavoriteFromModal,
  onPrevImage,
  onNextImage,
  onCloseModal,
  thumbSize,
}: ModalViewerProps) {
  if (!modalImage) {
    return null;
  }

  return (
    <div className="modal" onClick={onCloseModal}>
      <div
        className={`modal-content ${modalControlsVisible ? '' : 'is-controls-hidden'}`}
        onClick={(event) => event.stopPropagation()}
        onWheel={onModalWheel}
        onPointerDown={onModalPointerDown}
        onPointerMove={onModalPointerMove}
        onPointerUp={onModalPointerUp}
        onPointerCancel={onModalPointerUp}
        onMouseMove={onModalMouseMove}
        onTouchStartCapture={onModalTouchStart}
        onTouchMoveCapture={onModalTouchMove}
        onTouchEndCapture={onModalTouchEnd}
        onTouchCancelCapture={onModalTouchEnd}
      >
        <div className="modal-controls-right">
          {modalHasHistory && modalContextLabel === 'Set' ? (
            <button
              type="button"
              className="modal-context"
              onClick={onRestoreModalContext}
              aria-label="Back to previous list"
            >
              <IconArrowLeft size={18} />
            </button>
          ) : modalSetId ? (
            <button
              type="button"
              className="modal-context"
              onClick={onOpenChronologicalContext}
              aria-label="View in chronological order"
            >
              <IconTimeline size={18} />
            </button>
          ) : null}
          <div className="modal-timer">
            <button
              type="button"
              className="modal-timer-button"
              onClick={onToggleTimerMenu}
              aria-label="Set auto-advance timer"
              aria-pressed={isModalTimerOpen}
            >
              <IconClock size={18} />
            </button>
            {isModalTimerOpen ? (
              <div className="modal-timer-menu">
                {modalTimerOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`modal-timer-option ${
                      option.value === modalTimerMs ? 'is-active' : ''
                    }`}
                    onClick={() => onSelectModalTimer(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="modal-timer-reset"
                  onClick={onResetModalTimer}
                  aria-label="Reset timer for this image"
                  disabled={modalTimerMs <= 0}
                >
                  <IconRefresh size={16} />
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="modal-close" onClick={onCloseModal} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        {modalSetId ? (
          <button
            type="button"
            className={`modal-favorite ${modalIsFavorite ? 'is-active' : ''}`}
            onClick={onToggleFavoriteFromModal}
            aria-pressed={modalIsFavorite}
            aria-label={modalIsFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {modalIsFavorite ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
          </button>
        ) : null}
        {modalFavoritePulse ? (
          <div
            className={`modal-favorite-pop ${modalFavoritePulse === 'add' ? 'is-add' : 'is-remove'}`}
          >
            {modalFavoritePulse === 'add' ? <IconHeartFilled size={1} /> : <IconHeart size={1} />}
          </div>
        ) : null}
        <div
          className={`modal-media ${modalZoom > 1 ? 'is-zoomed' : ''} ${
            modalShake ? 'is-shake' : ''
          }`}
          ref={modalMediaRef}
          style={{
            transform: `translate(${modalPan.x}px, ${modalPan.y}px) scale(${modalZoom})`,
            opacity:
              (modalSwipeAction === 'close' ? 1 - modalSwipeProgress * 0.8 : 1) *
              (modalTimerFade ? 0 : 1),
            ['--modal-pan-x' as string]: `${modalPan.x}px`,
            ['--modal-pan-y' as string]: `${modalPan.y}px`,
            ['--modal-zoom' as string]: String(modalZoom),
          }}
        >
          <img
            className="modal-thumb"
            key={`thumb-${modalImage.id}`}
            src={createProxyThumbUrl(modalImage.id, thumbSize)}
            alt={modalImage.name}
          />
          <img
            className={`modal-full ${modalFullImageId === modalImage.id ? 'is-loaded' : ''} ${
              modalFullAnimate ? 'is-animate' : ''
            }`}
            key={`full-${modalImage.id}`}
            src={modalFullSrc ?? undefined}
            alt={modalImage.name}
            onLoad={onModalFullLoad}
          />
        </div>
        <div className={`modal-status ${modalIsLoading ? 'is-visible' : ''}`}>
          <div className={`modal-status-inner ${modalPulse ? 'pulse' : ''}`}>
            <IconLoader2 size={20} />
            <span>Loading image</span>
          </div>
        </div>
        {modalContextLabel && modalIndex !== null ? (
          <div className="modal-counter">
            {modalContextLabel} {modalIndex + 1}/{modalItems.length}
            {modalContextLabel === 'Set'
              ? ` [${modalTotalImagesKnown ?? totalImages}]`
              : modalContextLabel === 'Sample'
                ? ` [${totalImages}]`
                : modalContextLabel === 'Favorites'
                  ? ` [${favoritesCount}]`
                  : modalContextLabel === 'Non favorites' && nonFavoritesCount !== undefined
                    ? ` [${nonFavoritesCount}]`
                    : ''}
          </div>
        ) : null}
        {modalTimerMs > 0 ? (
          <div className="modal-timer-bar" aria-hidden="true">
            <div
              className="modal-timer-bar-fill"
              style={{ width: `${Math.min(100, modalTimerProgress * 100)}%` }}
            />
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
            className="modal-swipe-heart"
            style={{
              opacity: 0.2 + modalSwipeProgress * 0.8,
              transform: `translate(-50%, calc(-50% + ${(1 - modalSwipeProgress) * 48}px))`,
              color: modalIsFavorite
                ? 'rgba(255, 255, 255, 0.85)'
                : 'rgba(209, 86, 71, 0.95)',
            }}
          >
            {modalIsFavorite ? <IconHeart size={1} /> : <IconHeartFilled size={1} />}
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
        <button
          type="button"
          className="modal-nav modal-nav--prev"
          onClick={(event) => {
            event.stopPropagation();
            onPrevImage();
          }}
          disabled={!canGoPrevModal}
          aria-label="Previous image"
        />
        <button
          type="button"
          className="modal-nav modal-nav--next"
          onClick={(event) => {
            event.stopPropagation();
            onNextImage();
          }}
          disabled={!canGoNextModal}
          aria-label="Next image"
        />
      </div>
    </div>
  );
}
