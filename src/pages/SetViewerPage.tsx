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
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { ImageGrid } from '../components/ImageGrid';
import { GridLoadButtons } from '../components/GridLoadButtons';
import { useSetViewer } from '../features/setViewer/SetViewerContext';
import type { ViewerTabKey } from '../features/setViewer/viewerMetrics';

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
    allPageSize,
    viewerTabMetrics,
    onLoadMoreActiveTab,
    onLoadAllActiveTab,
    onDeleteHiddenImages,
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
  const lastHiddenRef = useRef<{
    setId: string;
    imageId: string;
    tab: ViewerTabKey;
    sort: 'random' | 'chronological';
    sortOrder: 'asc' | 'desc';
  } | null>(null);
  const undoScrollTargetRef = useRef<{
    imageId: string;
    tab: ViewerTabKey;
  } | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const placeholderCount =
    activeImages.length === 0 &&
    (isLoadingImages || viewerIndexProgress) &&
    typeof totalImagesKnown === 'number'
      ? Math.min(totalImagesKnown, allPageSize)
      : 0;
  const viewerStatus =
    isLoadingImages || viewerIndexProgress ? viewerIndexProgress || 'Loading images…' : '';
  const activeGridTotals = viewerTabMetrics[setViewerTab];

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    const node = loadMoreSentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const loadingByTab: Record<ViewerTabKey, boolean> = {
      all: isLoadingImages || isLoadingMore,
      favorites: isLoadingFavorites,
      nonfavorites: isLoadingNonFavorites,
      hidden: isLoadingHidden,
    };
    const activeTabState = {
      remaining: viewerTabMetrics[setViewerTab].remaining,
      isLoading: loadingByTab[setViewerTab],
    };
    if (!activeTabState.remaining || activeTabState.remaining <= 0) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        if (!activeTabState.remaining || activeTabState.remaining <= 0) {
          return;
        }
        if (activeTabState.isLoading) {
          return;
        }
        void onLoadMoreActiveTab();
      },
      { rootMargin: '600px 0px', threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    activeSet,
    isLoadingFavorites,
    isLoadingHidden,
    isLoadingImages,
    isLoadingMore,
    isLoadingNonFavorites,
    onLoadMoreActiveTab,
    setViewerTab,
    viewerTabMetrics,
  ]);

  useEffect(() => {
    const nextPos = activeSet?.thumbnailPos ?? 50;
    setThumbPos(nextPos);
    thumbPosRef.current = nextPos;
  }, [activeSet?.id, activeSet?.thumbnailFileId, activeSet?.thumbnailPos]);

  useEffect(() => {
    hasScrolledRef.current = false;
    setHighlightedImageId(null);
    if (activeSet) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [activeSet?.id]);

  useEffect(() => {
    lastHiddenRef.current = null;
    undoScrollTargetRef.current = null;
  }, [activeSet?.id, modalImageId, setViewerTab, viewerSort, viewerSortOrder]);

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
    if (modalImageId) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key.toLowerCase() !== 'z') {
        return;
      }
      const lastHidden = lastHiddenRef.current;
      if (
        !lastHidden ||
        !activeSet ||
        lastHidden.setId !== activeSet.id ||
        lastHidden.tab !== setViewerTab ||
        lastHidden.sort !== viewerSort ||
        lastHidden.sortOrder !== viewerSortOrder
      ) {
        return;
      }
      event.preventDefault();
      undoScrollTargetRef.current = { imageId: lastHidden.imageId, tab: lastHidden.tab };
      lastHiddenRef.current = null;
      void onToggleHiddenImage(lastHidden.setId, lastHidden.imageId);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    activeSet,
    modalImageId,
    onToggleHiddenImage,
    setViewerTab,
    viewerSort,
    viewerSortOrder,
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
  const favoriteAction = activeSet
    ? {
        isActive: (image: DriveImage) => favoriteIds.includes(image.id),
        onToggle: (image: DriveImage) => onToggleFavoriteImage(activeSet.id, image.id),
      }
    : undefined;
  const hideAction = activeSet
    ? {
        isActive: (image: DriveImage) => hiddenIds.includes(image.id),
        onToggle: (image: DriveImage) => {
          const wasHidden = hiddenIds.includes(image.id);
          if (!wasHidden) {
            lastHiddenRef.current = {
              setId: activeSet.id,
              imageId: image.id,
              tab: setViewerTab,
              sort: viewerSort,
              sortOrder: viewerSortOrder,
            };
          } else {
            lastHiddenRef.current = null;
          }
          undoScrollTargetRef.current = null;
          onToggleHiddenImage(activeSet.id, image.id);
        },
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
  type FilteredTabKey = 'favorites' | 'nonfavorites' | 'hidden';
  type TabConfig = {
    key: ViewerTabKey;
    label: string;
    count?: number;
    hideCountWhenUndefined?: boolean;
    images: DriveImage[];
    gridRef: RefObject<HTMLDivElement>;
    isLoading: boolean;
    loadingLabel: string;
    emptyLabel: string;
    modalLabel: string;
    gridClassName: string;
    showHiddenAction?: boolean;
  };
  const tabConfig: Record<ViewerTabKey, TabConfig> = useMemo(
    () => ({
      all: {
        key: 'all',
        label: 'All Images',
        count: allImagesCount,
        images: activeImages,
        gridRef: allGridRef,
        isLoading: isLoadingImages,
        loadingLabel: 'Loading images…',
        emptyLabel: 'No images loaded yet.',
        modalLabel: 'Set',
        gridClassName: 'image-grid image-grid--zoom',
      },
      favorites: {
        key: 'favorites',
        label: 'Favorites',
        count: favoritesCount,
        images: favoriteImages,
        gridRef: favoritesGridRef,
        isLoading: isLoadingFavorites,
        loadingLabel: 'Loading favorites…',
        emptyLabel: 'No favorites yet.',
        modalLabel: 'Favorites',
        gridClassName: 'image-grid image-grid--zoom image-grid--filled',
      },
      nonfavorites: {
        key: 'nonfavorites',
        label: 'Non-Favorites',
        count: nonFavoritesCount,
        hideCountWhenUndefined: true,
        images: nonFavoriteImages,
        gridRef: nonFavoritesGridRef,
        isLoading: isLoadingNonFavorites,
        loadingLabel: 'Loading images…',
        emptyLabel: 'No non-favorites yet.',
        modalLabel: 'Non favorites',
        gridClassName: 'image-grid image-grid--zoom',
      },
      hidden: {
        key: 'hidden',
        label: 'Hidden',
        count: hiddenCount,
        images: hiddenImages,
        gridRef: hiddenGridRef,
        isLoading: isLoadingHidden,
        loadingLabel: 'Loading hidden…',
        emptyLabel: 'No hidden images yet.',
        modalLabel: 'Hidden',
        gridClassName: 'image-grid image-grid--zoom image-grid--filled',
        showHiddenAction: true,
      },
    }),
    [
      activeImages,
      allGridRef,
      allImagesCount,
      favoriteImages,
      favoritesCount,
      favoritesGridRef,
      hiddenCount,
      hiddenImages,
      hiddenGridRef,
      isLoadingFavorites,
      isLoadingHidden,
      isLoadingImages,
      isLoadingNonFavorites,
      nonFavoriteImages,
      nonFavoritesCount,
      nonFavoritesGridRef,
    ]
  );
  const tabOrder: Array<'all' | 'favorites' | 'nonfavorites' | 'hidden'> = [
    'all',
    'favorites',
    'nonfavorites',
    'hidden',
  ];

  const renderFilteredTabBody = (tabKey: FilteredTabKey) => {
    const tab = tabConfig[tabKey];
    const metrics = viewerTabMetrics[tabKey];
    const variant = tabKey;
    const showAutoLoadSentinel =
      typeof metrics.remaining === 'number' && metrics.remaining > 0;
    return (
      <>
        {tab.isLoading ? (
          <div className="stack">
            <p className="empty">{tab.loadingLabel}</p>
            {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
          </div>
        ) : viewerIndexProgress ? (
          <p className="muted">{viewerIndexProgress}</p>
        ) : tab.images.length > 0 ? (
          <ImageGrid
            images={tab.images}
            isConnected={isConnected}
            thumbSize={thumbSize}
            alt={activeSet?.name ?? ''}
            modalLabel={tab.modalLabel}
            gridClassName={tab.gridClassName}
            gridRef={tab.gridRef}
            virtualize
            favoriteAction={favoriteAction}
            hideAction={hideAction}
            showHiddenAction={tab.showHiddenAction}
            thumbnailAction={thumbnailAction}
            highlightedImageId={highlightedImageId}
          />
        ) : (
          <p className="empty">{tab.emptyLabel}</p>
        )}
        {variant === 'favorites' || variant === 'hidden' ? (
          <GridLoadButtons
            variant={variant}
            isLoading={tab.isLoading}
            currentCount={tab.images.length}
            pendingCount={metrics.pending}
            totalCount={tab.count ?? 0}
            remainingCount={metrics.remaining ?? 0}
            showLoadMore={metrics.showLoadMore}
            showLoadAll={metrics.showLoadAll}
            onLoadMore={onLoadMoreActiveTab}
            onLoadAll={onLoadAllActiveTab}
          />
        ) : (
          <GridLoadButtons
            variant="nonfavorites"
            isLoading={tab.isLoading}
            currentCount={tab.images.length}
            pendingCount={metrics.pending}
            totalCount={tab.count}
            showLoadMore={metrics.showLoadMore}
            showLoadAll={metrics.showLoadAll}
            onLoadMore={onLoadMoreActiveTab}
            onLoadAll={onLoadAllActiveTab}
          />
        )}
        {showAutoLoadSentinel ? (
          <div className="load-more-sentinel" ref={loadMoreSentinelRef} />
        ) : null}
      </>
    );
  };

  const modalLabelToTab: Record<string, ViewerTabKey> = useMemo(
    () => ({
      Set: 'all',
      Favorites: 'favorites',
      'Non favorites': 'nonfavorites',
      Hidden: 'hidden',
    }),
    []
  );

  useEffect(() => {
    const modalTargetId = modalImageId;
    const undoTarget = modalTargetId ? null : undoScrollTargetRef.current;
    const targetId = modalTargetId ?? undoTarget?.imageId ?? null;
    if (!targetId) {
      return;
    }
    const tabForLabel = modalTargetId
      ? modalLabelToTab[modalContextLabel] ?? null
      : undoTarget?.tab ?? null;
    if (!tabForLabel || tabForLabel !== setViewerTab) {
      return;
    }
    const gridContext = tabConfig[tabForLabel];
    if (!gridContext) {
      return;
    }
    const attemptScroll = () => {
      const selector = `[data-image-id="${CSS.escape(targetId)}"]`;
      const element = document.querySelector(selector);
      if (!element || !(element instanceof HTMLElement)) {
        if (gridContext.gridRef?.current) {
          const index = gridContext.images.findIndex((image) => image.id === targetId);
          if (index >= 0) {
            const grid = gridContext.gridRef.current;
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
            setHighlightedImageId(targetId);
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
      setHighlightedImageId(targetId);
      return true;
    };
    if (attemptScroll()) {
      modalScrollAttemptsRef.current = 0;
      if (undoTarget) {
        undoScrollTargetRef.current = null;
      }
      return;
    }
    if (modalScrollAttemptsRef.current >= 8) {
      modalScrollAttemptsRef.current = 0;
      if (undoTarget) {
        undoScrollTargetRef.current = null;
      }
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
    favoriteImages,
    hiddenImages,
    modalContextLabel,
    modalImageId,
    modalLabelToTab,
    nonFavoriteImages,
    setViewerTab,
    tabConfig,
  ]);
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
              {tabOrder.map((tabKey) => {
                const meta = tabConfig[tabKey];
                const countLabel = meta.hideCountWhenUndefined && meta.count === undefined
                  ? ''
                  : ` (${meta.count ?? 0})`;
                return (
                  <button
                    key={tabKey}
                    type="button"
                    className={`subtab ${setViewerTab === tabKey ? 'is-active' : ''}`}
                    onClick={() => onSetViewerTab(tabKey)}
                  >
                    {meta.label}
                    {countLabel}
                  </button>
                );
              })}
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
            {setViewerTab === 'favorites' ||
            setViewerTab === 'nonfavorites' ||
            setViewerTab === 'hidden' ? (
              <div className="preview">
                {setViewerTab === 'hidden' ? (
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
                ) : null}
                {renderFilteredTabBody(setViewerTab)}
              </div>
            ) : null}
            {setViewerTab === 'all' ? (
              <div className="stack">
                <div
                  className={`viewer-status${viewerStatus ? '' : ' is-empty'}`}
                  aria-live="polite"
                >
                  {viewerStatus}
                </div>
                <ImageGrid
                  images={activeImages}
                  isConnected={isConnected}
                  thumbSize={thumbSize}
                  alt={activeSet.name}
                  modalLabel="Set"
                  placeholderCount={placeholderCount}
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
                {viewerTabMetrics.all.showLoadMore || viewerTabMetrics.all.showLoadAll ? (
                  <GridLoadButtons
                    variant="all"
                    isLoading={isLoadingMore}
                    currentCount={activeImages.length}
                    pendingCount={viewerTabMetrics.all.pending}
                    totalCount={viewerTabMetrics.all.total}
                    remainingCount={viewerTabMetrics.all.remaining}
                    showLoadMore={viewerTabMetrics.all.showLoadMore}
                    showLoadAll={viewerTabMetrics.all.showLoadAll}
                    onLoadMore={onLoadMoreActiveTab}
                    onLoadAll={onLoadAllActiveTab}
                  />
                ) : null}
                {typeof viewerTabMetrics.all.remaining === 'number' &&
                viewerTabMetrics.all.remaining > 0 ? (
                  <div className="load-more-sentinel" ref={loadMoreSentinelRef} />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="empty">Select a set above to view images.</p>
        )}
      </div>
      {activeSet ? (
        <div className="viewer-load-overlay" aria-live="polite">
          {typeof activeGridTotals.total === 'number'
            ? `Loaded ${activeGridTotals.loaded} / ${activeGridTotals.total}`
            : `Loaded ${activeGridTotals.loaded}`}
        </div>
      ) : null}
    </section>
  );
}
