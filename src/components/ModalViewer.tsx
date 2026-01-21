import {
  IconArrowLeft,
  IconArrowRight,
  IconClock,
  IconEye,
  IconEyeOff,
  IconHeart,
  IconHeartFilled,
  IconInfoCircle,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRefresh,
  IconRotateClockwise,
  IconTimeline,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { createProxyThumbUrl } from '../utils/driveUrls';
import { useModalState } from '../features/modal/ModalContext';
import { useImageCache } from '../features/imageCache/ImageCacheContext';

export function ModalViewer() {
  const { cacheKey, getImageVersion } = useImageCache();
  const {
    modalImage,
    modalItems,
    modalIndex,
    modalContextLabel,
    modalSetId,
    modalSetName,
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
    onToggleInfoMenu,
    onCloseInfoMenu,
    onOpenChronologicalContext,
    onRestoreModalContext,
    onToggleFavoriteFromModal,
    onToggleHiddenFromModal,
    onRotateModalImage,
    onPrevImage,
    onNextImage,
    onCloseModal,
    thumbSize,
  } = useModalState();
  if (!modalImage) {
    return null;
  }
  const maxCustomTimerSeconds = 86400;
  const [customTimerInput, setCustomTimerInput] = useState('');
  const parsedCustomTimer = Number(customTimerInput);
  const customTimerSeconds = Number.isFinite(parsedCustomTimer)
    ? Math.floor(parsedCustomTimer)
    : NaN;
  const customTimerValid =
    Number.isFinite(customTimerSeconds) &&
    customTimerSeconds > 0 &&
    customTimerSeconds <= maxCustomTimerSeconds;
  const handleCustomTimerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customTimerValid) {
      return;
    }
    onSelectModalTimer(customTimerSeconds * 1000);
  };
  useEffect(() => {
    onCloseInfoMenu();
  }, [modalImage.id, onCloseInfoMenu]);
  const showLoading = modalLoadingCount > 0;
  const loadingLabel = `Loading ${modalLoadingCount} image${
    modalLoadingCount === 1 ? '' : 's'
  }`;
  const thumbCacheRef = useRef<Map<string, string>>(new Map());
  const thumbInFlightRef = useRef<Set<string>>(new Set());
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const thumbCacheMax = 80;
  const thumbPrefetchRange = 6;

  const storeThumb = useCallback((id: string, url: string) => {
    const cache = thumbCacheRef.current;
    if (cache.has(id)) {
      return;
    }
    cache.set(id, url);
    if (cache.size > thumbCacheMax) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest) {
        const existing = cache.get(oldest);
        if (existing) {
          URL.revokeObjectURL(existing);
        }
        cache.delete(oldest);
      }
    }
  }, []);
  const resolveThumbCacheId = useCallback(
    (id: string) => {
      const version = getImageVersion(id);
      return version > 0 ? `${id}|${version}` : id;
    },
    [getImageVersion]
  );

  useEffect(() => {
    thumbCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    thumbCacheRef.current.clear();
    thumbInFlightRef.current.clear();
    setThumbSrc(null);
  }, [cacheKey, thumbSize]);

  useEffect(() => {
    const cacheId = resolveThumbCacheId(modalImage.id);
    const cached = thumbCacheRef.current.get(cacheId);
    if (cached) {
      setThumbSrc(cached);
      return;
    }
    setThumbSrc(null);
    if (thumbInFlightRef.current.has(cacheId)) {
      return;
    }
    const controller = new AbortController();
    const url = createProxyThumbUrl(modalImage.id, thumbSize, cacheKey, {
      version: getImageVersion(modalImage.id),
    });
    thumbInFlightRef.current.add(cacheId);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Thumb fetch failed: ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        storeThumb(cacheId, objectUrl);
        setThumbSrc(objectUrl);
      })
      .catch(() => {
        // Ignore thumb fetch errors; fallback to direct URL.
      })
      .finally(() => {
        thumbInFlightRef.current.delete(cacheId);
      });
    return () => {
      controller.abort();
    };
  }, [cacheKey, getImageVersion, modalImage.id, resolveThumbCacheId, storeThumb, thumbSize]);

  useEffect(() => {
    if (modalIndex === null || modalItems.length === 0) {
      return;
    }
    const start = Math.max(0, modalIndex - thumbPrefetchRange);
    const end = Math.min(modalItems.length - 1, modalIndex + thumbPrefetchRange);
    for (let i = start; i <= end; i += 1) {
      const id = modalItems[i]?.id;
      if (!id || id === modalImage.id) {
        continue;
      }
      const cacheId = resolveThumbCacheId(id);
      if (thumbCacheRef.current.has(cacheId) || thumbInFlightRef.current.has(cacheId)) {
        continue;
      }
      const controller = new AbortController();
      const url = createProxyThumbUrl(id, thumbSize, cacheKey, { version: getImageVersion(id) });
      thumbInFlightRef.current.add(cacheId);
      fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Thumb fetch failed: ${response.status}`);
          }
          return response.blob();
        })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        storeThumb(cacheId, objectUrl);
      })
        .catch(() => {
          // Ignore prefetch failures.
        })
      .finally(() => {
        thumbInFlightRef.current.delete(cacheId);
      });
    }
  }, [
    cacheKey,
    getImageVersion,
    modalImage.id,
    modalIndex,
    modalItems,
    resolveThumbCacheId,
    storeThumb,
    thumbSize,
  ]);
  const driveFileUrl = `https://drive.google.com/file/d/${encodeURIComponent(
    modalImage.id
  )}/view`;
  const setLinkHref = modalSetId ? `/set/${encodeURIComponent(modalSetId)}` : '';
  const handleOpenSet = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!modalSetId) {
      return;
    }
    sessionStorage.setItem(
      'poseviewer-scroll-target',
      JSON.stringify({ setId: modalSetId, imageId: modalImage.id })
    );
    window.history.pushState(null, '', setLinkHref);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="modal" onClick={onCloseModal}>
      <div
        className={`modal-content ${modalControlsVisible ? '' : 'is-controls-hidden'}${
          isMouseZoomMode ? ' is-mouse-zoom' : ''
        }`}
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
          <button type="button" className="modal-close" onClick={onCloseModal} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="modal-controls-bottom-left">
          <div className="modal-info">
            <button
              type="button"
              className="modal-info-button"
              onClick={onToggleInfoMenu}
              aria-label="Image info"
              aria-pressed={isModalInfoOpen}
            >
              <IconInfoCircle size={18} />
            </button>
            {isModalInfoOpen ? (
              <div className="modal-info-panel">
                <div className="modal-info-row">
                  <span className="modal-info-label">Filename</span>
                  <a href={driveFileUrl} target="_blank" rel="noreferrer">
                    {modalImage.name}
                  </a>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Set</span>
                  {modalSetId && modalSetName ? (
                    <a href={setLinkHref} onClick={handleOpenSet}>
                      {modalSetName}
                    </a>
                  ) : (
                    <span className="muted">Unavailable</span>
                  )}
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">Rotate</span>
                  <div className="modal-info-actions">
                    <button
                      type="button"
                      className="modal-info-action"
                      onClick={() => onRotateModalImage(90)}
                      disabled={modalIsRotating}
                    >
                      <IconRotateClockwise size={16} className="modal-info-icon" />
                      <span>Clockwise</span>
                    </button>
                    <button
                      type="button"
                      className="modal-info-action"
                      onClick={() => onRotateModalImage(-90)}
                      disabled={modalIsRotating}
                    >
                      <IconRotateClockwise
                        size={16}
                        className="modal-info-icon modal-info-icon--ccw"
                      />
                      <span>Counter</span>
                    </button>
                    {modalRotateStatus ? (
                      <span className="modal-info-status">
                        {modalRotateStatus.state === 'done'
                          ? 'Done'
                          : modalRotateStatus.state === 'error'
                            ? 'Failed'
                            : 'Rotating…'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modal-controls-bottom-right">
          {modalHasHistory && modalContextLabel === 'Set' ? (
            <button
              type="button"
              className="modal-context"
              onClick={onRestoreModalContext}
              aria-label="Back to previous list"
            >
              <IconArrowLeft size={18} />
            </button>
          ) : modalSetId &&
            modalContextLabel !== 'Preview' &&
            modalContextLabel !== 'Sample' &&
            (modalContextLabel !== 'Set' || viewerSort === 'random') ? (
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
                <form className="modal-timer-custom" onSubmit={handleCustomTimerSubmit}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxCustomTimerSeconds}
                    step={1}
                    className="modal-timer-input"
                    placeholder="seconds"
                    value={customTimerInput}
                    onChange={(event) => setCustomTimerInput(event.target.value)}
                    aria-label="Custom timer seconds"
                  />
                  <button
                    type="submit"
                    className="modal-timer-apply"
                    disabled={!customTimerValid}
                  >
                    Set
                  </button>
                </form>
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
        {modalSetId ? (
          <button
            type="button"
            className={`modal-hide ${modalIsHidden ? 'is-active' : ''}`}
            onClick={onToggleHiddenFromModal}
            aria-pressed={modalIsHidden}
            aria-label={modalIsHidden ? 'Unhide image' : 'Hide image'}
          >
            {modalIsHidden ? <IconEye size={18} /> : <IconEyeOff size={18} />}
          </button>
        ) : null}
        {modalFavoritePulse ? (
          <div
            className={`modal-favorite-pop ${modalFavoritePulse === 'add' ? 'is-add' : 'is-remove'}`}
          >
            {modalFavoritePulse === 'add' ? <IconHeartFilled size={1} /> : <IconHeart size={1} />}
          </div>
        ) : null}
        {modalHiddenPulse ? (
          <div
            className={`modal-hide-pop ${modalHiddenPulse === 'hide' ? 'is-hide' : 'is-unhide'}`}
          >
            {modalHiddenPulse === 'hide' ? <IconEyeOff size={1} /> : <IconEye size={1} />}
          </div>
        ) : null}
        {modalTimerPulse ? (
          <div className={`modal-timer-pop ${modalTimerPulse === 'pause' ? 'is-pause' : 'is-play'}`}>
            {modalTimerPulse === 'pause' ? (
              <IconPlayerPauseFilled size={1} />
            ) : (
              <IconPlayerPlayFilled size={1} />
            )}
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
            src={
              thumbSrc ??
              createProxyThumbUrl(modalImage.id, thumbSize, cacheKey, {
                version: getImageVersion(modalImage.id),
              })
            }
            alt={modalImage.name}
            loading="eager"
            decoding="async"
            fetchpriority="high"
          />
          <img
            className={`modal-full ${modalFullImageId === modalImage.id ? 'is-loaded' : ''} ${
              modalFullAnimate ? 'is-animate' : ''
            }`}
            key={`full-${modalImage.id}`}
            src={modalFullSrc ?? undefined}
            alt={modalImage.name}
            decoding="async"
            onLoad={onModalFullLoad}
          />
        </div>
        {/* <div className={`modal-status ${showLoading ? 'is-visible' : ''}`}>
          <div className={`modal-status-inner ${modalPulse ? 'pulse' : ''}`}>
            <IconLoader2 size={20} />
            <span>{loadingLabel}</span>
          </div>
        </div> */}
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
                    : modalContextLabel === 'Hidden'
                      ? ` [${hiddenCount}]`
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
