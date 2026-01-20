import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsShuffle,
  IconDotsVertical,
  IconFolder,
  IconPhoto,
  IconHeart,
  IconRotateClockwise,
} from '@tabler/icons-react';
import type { DriveImage } from '../drive/types';
import { ImageThumb } from '../components/ImageThumb';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { ImageGrid } from '../components/ImageGrid';
import { GridLoadButtons } from '../components/GridLoadButtons';
import { useSetViewer } from '../features/setViewer/SetViewerContext';

const SCROLL_TARGET_KEY = 'poseviewer-scroll-target';

export function SetViewerPage() {
  const {
    activeSet,
    isConnected,
    isSaving,
    isRefreshingSet,
    isDeletingHidden,
    hiddenDeleteProgress,
    setViewerTab,
    onSetViewerTab,
    viewerSort,
    viewerSortOrder,
    onViewerSortChange,
    onShuffleViewerSort,
    onToggleViewerSortOrder,
    viewerQuickTags,
    onToggleActiveSetTag,
    favoriteIds,
    hiddenIds,
    favoritesCount,
    hiddenCount,
    nonFavoritesCount,
    allImagesCount,
    sampleImages,
    favoriteImages,
    nonFavoriteImages,
    hiddenImages,
    activeImages,
    viewerIndexProgress,
    isLoadingFavorites,
    isLoadingNonFavorites,
    isLoadingHidden,
    isLoadingImages,
    isLoadingMore,
    totalImagesKnown,
    nonFavoritesPendingExtra,
    favoritesPendingExtra,
    hiddenPendingExtra,
    pendingExtra,
    remainingImages,
    onLoadMoreNonFavorites,
    onLoadAllNonFavorites,
    onLoadMoreFavorites,
    onLoadAllFavorites,
    onLoadMoreHidden,
    onLoadAllHidden,
    onDeleteHiddenImages,
    onLoadMoreImages,
    onLoadAllPreloaded,
    onEnsureImageInView,
    onToggleFavoriteImage,
    onToggleHiddenImage,
    onSetThumbnail,
    onSetThumbnailPosition,
    onUpdateSetName,
    onRefreshSet,
    onDeleteSet,
    onRotateSet,
    isRotatingSet,
    rotateSetProgress,
    modalImageId,
    modalContextLabel,
    thumbSize,
    viewerThumbSize,
    sampleGridRef,
    allGridRef,
  } = useSetViewer();
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const favoritesGridRef = useRef<HTMLDivElement | null>(null);
  const hiddenGridRef = useRef<HTMLDivElement | null>(null);
  const nonFavoritesGridRef = useRef<HTMLDivElement | null>(null);
  const [thumbPos, setThumbPos] = useState(activeSet?.thumbnailPos ?? 50);
  const thumbPosRef = useRef(thumbPos);
  const isDraggingRef = useRef(false);
  const scrollTargetRef = useRef<{ setId: string; imageId: string } | null>(null);
  const hasScrolledRef = useRef(false);
  const [highlightedImageId, setHighlightedImageId] = useState<string | null>(null);
  const modalScrollAttemptsRef = useRef(0);
  const modalScrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const nextPos = activeSet?.thumbnailPos ?? 50;
    setThumbPos(nextPos);
    thumbPosRef.current = nextPos;
  }, [activeSet?.id, activeSet?.thumbnailFileId, activeSet?.thumbnailPos]);

  useEffect(() => {
    hasScrolledRef.current = false;
    setHighlightedImageId(null);
  }, [activeSet?.id]);

  useEffect(() => {
    if (!scrollTargetRef.current) {
      const raw = sessionStorage.getItem(SCROLL_TARGET_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { setId?: string; imageId?: string };
          if (parsed?.setId && parsed?.imageId) {
            scrollTargetRef.current = { setId: parsed.setId, imageId: parsed.imageId };
          }
        } catch {
          // Ignore malformed storage entries.
        }
      }
    }
    const target = scrollTargetRef.current;
    if (!target || !activeSet || activeSet.id !== target.setId) {
      return;
    }
    if (setViewerTab !== 'all') {
      onSetViewerTab('all');
      return;
    }
    if (viewerSort !== 'chronological') {
      onViewerSortChange('chronological');
      return;
    }
    if (hasScrolledRef.current) {
      return;
    }
    if (!isLoadingImages && !isLoadingMore) {
      void onEnsureImageInView(target.imageId);
    }
    const selector = `[data-image-id="${CSS.escape(target.imageId)}"]`;
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightedImageId(target.imageId);
      hasScrolledRef.current = true;
      scrollTargetRef.current = null;
      sessionStorage.removeItem(SCROLL_TARGET_KEY);
    }
  }, [
    activeImages,
    activeSet,
    isLoadingImages,
    isLoadingMore,
    onEnsureImageInView,
    onSetViewerTab,
    onViewerSortChange,
    setViewerTab,
    viewerSort,
  ]);

  useEffect(() => {
    if (!highlightedImageId) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHighlightedImageId(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [highlightedImageId]);

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    const tabForLabel =
      modalContextLabel === 'Set'
        ? 'all'
        : modalContextLabel === 'Favorites'
          ? 'favorites'
          : modalContextLabel === 'Non favorites'
            ? 'nonfavorites'
            : modalContextLabel === 'Hidden'
              ? 'hidden'
              : modalContextLabel === 'Sample'
                ? 'samples'
                : null;
    if (!tabForLabel || tabForLabel !== setViewerTab) {
      return;
    }
    const getGridContext = () => {
      switch (tabForLabel) {
        case 'all':
          return { images: activeImages, grid: allGridRef.current };
        case 'favorites':
          return { images: favoriteImages, grid: favoritesGridRef.current };
        case 'nonfavorites':
          return { images: nonFavoriteImages, grid: nonFavoritesGridRef.current ?? sampleGridRef.current };
        case 'hidden':
          return { images: hiddenImages, grid: hiddenGridRef.current };
        case 'samples':
          return { images: sampleImages, grid: sampleGridRef.current };
        default:
          return { images: [], grid: null };
      }
    };
    const gridContext = getGridContext();
    const attemptScroll = () => {
      const selector = `[data-image-id="${CSS.escape(modalImageId)}"]`;
      const element = document.querySelector(selector);
      if (!element || !(element instanceof HTMLElement)) {
        if (gridContext.grid) {
          const index = gridContext.images.findIndex((image) => image.id === modalImageId);
          if (index >= 0) {
            const grid = gridContext.grid;
            const rect = grid.getBoundingClientRect();
            const width = rect.width;
            const gap = 4;
            const minColWidth = 160;
            const columns = Math.max(
              1,
              Math.floor((width + gap) / (minColWidth + gap))
            );
            const itemWidth = Math.max(
              minColWidth,
              Math.floor((width - gap * (columns - 1)) / columns)
            );
            const rowStride = itemWidth + gap;
            const row = Math.floor(index / columns);
            const targetTop =
              rect.top + window.scrollY + row * rowStride - window.innerHeight * 0.5 + itemWidth * 0.5;
            window.scrollTo({ top: Math.max(0, targetTop) });
            setHighlightedImageId(modalImageId);
            return true;
          }
        }
        return false;
      }
      const rect = element.getBoundingClientRect();
      const needsScroll = rect.top < 40 || rect.bottom > window.innerHeight - 40;
      if (needsScroll) {
        element.scrollIntoView({ block: 'center' });
      }
      setHighlightedImageId(modalImageId);
      return true;
    };
    if (attemptScroll()) {
      modalScrollAttemptsRef.current = 0;
      return;
    }
    if (modalScrollAttemptsRef.current >= 8) {
      modalScrollAttemptsRef.current = 0;
      return;
    }
    modalScrollAttemptsRef.current += 1;
    if (modalScrollTimeoutRef.current) {
      window.clearTimeout(modalScrollTimeoutRef.current);
    }
    modalScrollTimeoutRef.current = window.setTimeout(() => {
      modalScrollTimeoutRef.current = null;
      attemptScroll();
    }, 120);
  }, [
    activeImages,
    allGridRef,
    favoriteImages,
    hiddenImages,
    modalContextLabel,
    modalImageId,
    nonFavoriteImages,
    sampleGridRef,
    sampleImages,
    setViewerTab,
  ]);

  useEffect(() => {
    return () => {
      if (modalScrollTimeoutRef.current) {
        window.clearTimeout(modalScrollTimeoutRef.current);
        modalScrollTimeoutRef.current = null;
      }
    };
  }, []);

  const computeThumbPos = useCallback((clientX: number, clientY: number) => {
    const bounds = thumbRef.current?.getBoundingClientRect();
    if (!bounds) {
      return thumbPosRef.current;
    }
    const axis = thumbRef.current?.dataset.thumbAxis === 'x' ? 'x' : 'y';
    const raw =
      axis === 'x'
        ? (clientX - bounds.left) / bounds.width
        : (clientY - bounds.top) / bounds.height;
    const clamped = Math.min(1, Math.max(0, raw));
    const start = 0.2;
    const end = 0.8;
    if (clamped <= start) {
      return 0;
    }
    if (clamped >= end) {
      return 100;
    }
    return ((clamped - start) / (end - start)) * 100;
  }, []);

  const handleThumbPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!activeSet?.thumbnailFileId) {
        return;
      }
      event.preventDefault();
      isDraggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const nextPos = computeThumbPos(event.clientX, event.clientY);
      thumbPosRef.current = nextPos;
      setThumbPos(nextPos);
    },
    [activeSet?.thumbnailFileId, computeThumbPos]
  );

  const handleThumbPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) {
        return;
      }
      event.preventDefault();
      const nextPos = computeThumbPos(event.clientX, event.clientY);
      thumbPosRef.current = nextPos;
      setThumbPos(nextPos);
    },
    [computeThumbPos]
  );

  const handleThumbPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) {
        return;
      }
      event.preventDefault();
      isDraggingRef.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (activeSet) {
        onSetThumbnailPosition(activeSet.id, thumbPosRef.current);
      }
    },
    [activeSet, onSetThumbnailPosition]
  );

  const handleThumbPointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) {
        return;
      }
      isDraggingRef.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    []
  );
  const favoritesRemaining = Math.max(0, favoritesCount - favoriteImages.length);
  const hiddenRemaining = Math.max(0, hiddenCount - hiddenImages.length);
  const nonFavoritesRemaining =
    nonFavoritesCount !== undefined
      ? Math.max(0, nonFavoritesCount - nonFavoriteImages.length)
      : undefined;
  const showNonFavoritesLoadButtons =
    nonFavoritesRemaining !== undefined ? nonFavoritesRemaining > 0 : true;
  const favoriteAction = activeSet
    ? {
        isActive: (image: DriveImage) => favoriteIds.includes(image.id),
        onToggle: (image: DriveImage) => onToggleFavoriteImage(activeSet.id, image.id),
      }
    : undefined;
  const hideAction = activeSet
    ? {
        isActive: (image: DriveImage) => hiddenIds.includes(image.id),
        onToggle: (image: DriveImage) => onToggleHiddenImage(activeSet.id, image.id),
      }
    : undefined;
  const thumbnailAction = activeSet
    ? {
        isActive: (image: DriveImage) => activeSet.thumbnailFileId === image.id,
        onSet: (image: DriveImage) => onSetThumbnail(activeSet.id, image.id),
        disabled: (image: DriveImage) =>
          isSaving || activeSet.thumbnailFileId === image.id,
      }
    : undefined;
  return (
    <section className="panel">
      <div className="panel-header panel-header--row panel-header--viewer">
        <div className="viewer-title">
          {activeSet ? (
            <div className="viewer-title-row">
              <div className="viewer-thumb">
                {activeSet.thumbnailFileId ? (
                  <ImageThumb
                    isConnected={isConnected}
                    fileId={activeSet.thumbnailFileId}
                    alt={activeSet.name}
                    size={viewerThumbSize}
                    thumbPos={thumbPos}
                    hoverScroll={false}
                    eager
                    containerRef={thumbRef}
                    onPointerDown={handleThumbPointerDown}
                    onPointerMove={handleThumbPointerMove}
                    onPointerUp={handleThumbPointerUp}
                    onPointerCancel={handleThumbPointerCancel}
                  />
                ) : (
                  <div className="thumb thumb--empty">No thumbnail</div>
                )}
                <span
                  className="tag ghost tag--icon viewer-thumb-meta viewer-thumb-meta--left"
                  aria-label="Image count"
                >
                  <IconPhoto size={14} />
                  <span>
                    {typeof activeSet.imageCount === 'number'
                      ? activeSet.imageCount
                      : activeImages.length}
                  </span>
                </span>
                <span
                  className="tag ghost tag--icon viewer-thumb-meta viewer-thumb-meta--right"
                  aria-label="Favorite count"
                >
                  <IconHeart size={14} />
                  <span>{favoritesCount}</span>
                </span>
              </div>
              <div className="viewer-title-stack">
                <div className="viewer-title-bar">
                  <input
                    className="viewer-title-input"
                    type="text"
                    key={activeSet.id}
                    defaultValue={activeSet.name}
                    onBlur={(event) => onUpdateSetName(event.target.value)}
                  />
                  <div className="viewer-actions">
                    <div className="viewer-menu">
                      <button
                        type="button"
                        className="ghost viewer-menu-trigger"
                        aria-label="Set actions"
                      >
                        <IconDotsVertical size={18} />
                      </button>
                      <div className="viewer-menu-panel">
                        <button
                          className="ghost"
                          onClick={() => onRefreshSet(activeSet)}
                          disabled={isRefreshingSet}
                        >
                          {isRefreshingSet ? 'Refreshing…' : 'Refresh data'}
                        </button>
                        <button
                          className="ghost"
                          onClick={() => onRotateSet(activeSet, 90)}
                          disabled={isRotatingSet}
                        >
                          <IconRotateClockwise size={16} />
                          Rotate set clockwise
                        </button>
                        <button
                          className="ghost"
                          onClick={() => onRotateSet(activeSet, -90)}
                          disabled={isRotatingSet}
                        >
                          <IconRotateClockwise
                            size={16}
                            className="viewer-menu-icon viewer-menu-icon--ccw"
                          />
                          Rotate set counter clockwise
                        </button>
                        {rotateSetProgress ? (
                          <div className="viewer-menu-progress">
                            {rotateSetProgress.total > 0
                              ? `Rotating ${rotateSetProgress.completed}/${rotateSetProgress.total}…`
                              : 'Preparing rotation…'}
                          </div>
                        ) : null}
                        <button
                          className="ghost ghost--danger"
                          onClick={() => onDeleteSet(activeSet)}
                          disabled={isSaving}
                        >
                          Delete set
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="viewer-meta-inline">
                  <IconFolder size={16} />
                  <a
                    className="link viewer-path"
                    href={`https://drive.google.com/drive/folders/${activeSet.rootFolderId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {activeSet.rootPath}
                  </a>
                </div>
                <div key={activeSet.id} className="field-group field-group--viewer">
                  {viewerQuickTags.active.length > 0 || viewerQuickTags.inactive.length > 0 ? (
                    <div className="tag-split">
                      {viewerQuickTags.active.length > 0 ? (
                        <div className="tag-row tag-row--inline tag-row--active">
                          {viewerQuickTags.active.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className="tag-button is-active"
                              onClick={() => onToggleActiveSetTag(tag)}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {viewerQuickTags.inactive.length > 0 ? (
                        <div className="tag-row tag-row--inline tag-row--inactive">
                          {viewerQuickTags.inactive.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className="tag-button"
                              onClick={() => onToggleActiveSetTag(tag)}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <h2>Set viewer</h2>
          )}
        </div>
      </div>
      <div className="panel-body">
        {activeSet ? (
          <div className="stack">
            <div className="subtabs">
              <button
                type="button"
                className={`subtab ${setViewerTab === 'all' ? 'is-active' : ''}`}
                onClick={() => onSetViewerTab('all')}
              >
                All Images ({allImagesCount})
              </button>
              <button
                type="button"
                className={`subtab ${setViewerTab === 'favorites' ? 'is-active' : ''}`}
                onClick={() => onSetViewerTab('favorites')}
              >
                Favorites ({favoritesCount})
              </button>
              <button
                type="button"
                className={`subtab ${setViewerTab === 'nonfavorites' ? 'is-active' : ''}`}
                onClick={() => onSetViewerTab('nonfavorites')}
              >
                Non-Favorites{nonFavoritesCount !== undefined ? ` (${nonFavoritesCount})` : ''}
              </button>
              <button
                type="button"
                className={`subtab ${setViewerTab === 'hidden' ? 'is-active' : ''}`}
                onClick={() => onSetViewerTab('hidden')}
              >
                Hidden ({hiddenCount})
              </button>
              <div className="subtabs-spacer" aria-hidden="true" />
              <div className="viewer-sort-toggle" role="group" aria-label="Image order">
                <span className="muted">Order</span>
                <button
                  type="button"
                  className={`viewer-sort-button ${viewerSort === 'random' ? 'is-active' : ''}`}
                  onClick={() =>
                    viewerSort === 'random'
                      ? onShuffleViewerSort()
                      : onViewerSortChange('random')
                  }
                >
                  <IconArrowsShuffle size={14} />
                  Random
                </button>
                <button
                  type="button"
                  className={`viewer-sort-button ${viewerSort === 'chronological' ? 'is-active' : ''}`}
                  onClick={() =>
                    viewerSort === 'chronological'
                      ? onToggleViewerSortOrder()
                      : onViewerSortChange('chronological')
                  }
                >
                  {viewerSortOrder === 'desc' ? (
                    <IconArrowDown size={14} />
                  ) : (
                    <IconArrowUp size={14} />
                  )}
                  Chronological
                </button>
              </div>
            </div>
            {setViewerTab === 'nonfavorites' ? (
              <div className="preview">
                {isLoadingNonFavorites ? (
                  <div className="stack">
                    <p className="empty">Loading images…</p>
                    {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
                  </div>
                ) : viewerIndexProgress ? (
                  <p className="muted">{viewerIndexProgress}</p>
                ) : nonFavoriteImages.length > 0 ? (
                  <ImageGrid
                    images={nonFavoriteImages}
                    isConnected={isConnected}
                    thumbSize={thumbSize}
                    alt={activeSet.name}
                    modalLabel="Non favorites"
                    gridClassName="image-grid image-grid--zoom"
                    gridRef={nonFavoritesGridRef}
                    virtualize
                    favoriteAction={favoriteAction}
                    hideAction={hideAction}
                    thumbnailAction={thumbnailAction}
                    highlightedImageId={highlightedImageId}
                  />
                ) : (
                  <p className="empty">No non-favorites yet.</p>
                )}
                <GridLoadButtons
                  variant="nonfavorites"
                  isLoading={isLoadingNonFavorites}
                  currentCount={nonFavoriteImages.length}
                  pendingCount={nonFavoritesPendingExtra}
                  totalCount={nonFavoritesCount}
                  showLoadMore={showNonFavoritesLoadButtons}
                  showLoadAll={showNonFavoritesLoadButtons}
                  onLoadMore={onLoadMoreNonFavorites}
                  onLoadAll={onLoadAllNonFavorites}
                />
              </div>
            ) : null}
            {setViewerTab === 'favorites' ? (
              <div className="preview">
                {isLoadingFavorites ? (
                  <div className="stack">
                    <p className="empty">Loading favorites…</p>
                    {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
                  </div>
                ) : viewerIndexProgress ? (
                  <p className="muted">{viewerIndexProgress}</p>
                ) : favoriteImages.length > 0 ? (
                  <ImageGrid
                    images={favoriteImages}
                    isConnected={isConnected}
                    thumbSize={thumbSize}
                    alt={activeSet.name}
                    modalLabel="Favorites"
                    gridClassName="image-grid image-grid--zoom image-grid--filled"
                    gridRef={favoritesGridRef}
                    virtualize
                    favoriteAction={favoriteAction}
                    hideAction={hideAction}
                    thumbnailAction={thumbnailAction}
                    highlightedImageId={highlightedImageId}
                  />
                ) : (
                  <p className="empty">No favorites yet.</p>
                )}
                <GridLoadButtons
                  variant="favorites"
                  isLoading={isLoadingFavorites}
                  currentCount={favoriteImages.length}
                  pendingCount={favoritesPendingExtra}
                  totalCount={favoritesCount}
                  remainingCount={favoritesRemaining}
                  showLoadMore={favoritesRemaining > 0}
                  showLoadAll={favoritesRemaining > 0}
                  onLoadMore={onLoadMoreFavorites}
                  onLoadAll={onLoadAllFavorites}
                />
              </div>
            ) : null}
            {setViewerTab === 'hidden' ? (
              <div className="preview">
                <div className="viewer-hidden-actions">
                  <button
                    type="button"
                    className="primary primary--danger"
                    onClick={onDeleteHiddenImages}
                    disabled={!isConnected || hiddenCount === 0 || isDeletingHidden}
                  >
                    {isDeletingHidden
                      ? `Deleting ${hiddenDeleteProgress?.completed ?? 0}/${
                          hiddenDeleteProgress?.total ?? hiddenCount
                        }…`
                      : `Delete hidden from Drive (${hiddenCount})`}
                  </button>
                </div>
                {isLoadingHidden ? (
                  <div className="stack">
                    <p className="empty">Loading hidden…</p>
                    {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
                  </div>
                ) : hiddenImages.length > 0 ? (
                  <ImageGrid
                    images={hiddenImages}
                    isConnected={isConnected}
                    thumbSize={thumbSize}
                    alt={activeSet.name}
                    modalLabel="Hidden"
                    gridClassName="image-grid image-grid--zoom image-grid--filled"
                    gridRef={hiddenGridRef}
                    virtualize
                    favoriteAction={favoriteAction}
                    hideAction={hideAction}
                    showHiddenAction
                    thumbnailAction={thumbnailAction}
                    highlightedImageId={highlightedImageId}
                  />
                ) : (
                  <p className="empty">No hidden images yet.</p>
                )}
                <GridLoadButtons
                  variant="hidden"
                  isLoading={isLoadingHidden}
                  currentCount={hiddenImages.length}
                  pendingCount={hiddenPendingExtra}
                  totalCount={hiddenCount}
                  remainingCount={hiddenRemaining}
                  showLoadMore={hiddenRemaining > 0}
                  showLoadAll={hiddenRemaining > 0}
                  onLoadMore={onLoadMoreHidden}
                  onLoadAll={onLoadAllHidden}
                />
              </div>
            ) : null}
            {setViewerTab === 'all' ? (
              <div className="stack">
                {isLoadingImages || viewerIndexProgress ? (
                  <p className="empty">
                    {viewerIndexProgress || 'Loading images…'}
                  </p>
                ) : null}
                <ImageGrid
                  images={activeImages}
                  isConnected={isConnected}
                  thumbSize={thumbSize}
                  alt={activeSet.name}
                  modalLabel="Set"
                  gridClassName="image-grid image-grid--zoom"
                  gridRef={allGridRef}
                  virtualize
                  favoriteAction={favoriteAction}
                  hideAction={hideAction}
                  thumbnailAction={thumbnailAction}
                  highlightedImageId={highlightedImageId}
                />
                {!isLoadingImages && activeImages.length === 0 ? (
                  totalImagesKnown === 0 ? (
                    <p className="empty">No images found in this set.</p>
                  ) : (
                    <p className="empty">No images loaded yet. Use the load buttons below.</p>
                  )
                ) : null}
                {pendingExtra > 0 || (remainingImages !== undefined && remainingImages > 0) ? (
                  <GridLoadButtons
                    variant="all"
                    isLoading={isLoadingMore}
                    currentCount={activeImages.length}
                    pendingCount={pendingExtra}
                    totalCount={totalImagesKnown}
                    remainingCount={remainingImages}
                    showLoadMore={pendingExtra > 0}
                    showLoadAll={remainingImages !== undefined && remainingImages > 0}
                    onLoadMore={onLoadMoreImages}
                    onLoadAll={onLoadAllPreloaded}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="empty">Select a set above to view images.</p>
        )}
      </div>
    </section>
  );
}
