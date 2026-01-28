import {
  IconArrowsShuffle,
  IconHeart,
  IconPhoto,
  IconPlayerPlayFilled,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PoseSet } from '../metadata';
import { ImageThumb } from '../components/ImageThumb';

type OverviewPageProps = {
  isConnected: boolean;
  setFilter: string;
  onSetFilterChange: (value: string) => void;
  setSort: string;
  onSetSortChange: (value: string) => void;
  onShuffleSets: () => void;
  selectedTags: string[];
  sortedTags: string[];
  tagCounts: Record<string, number>;
  onToggleFilterTag: (tag: string) => void;
  onClearFilters: () => void;
  filteredSets: PoseSet[];
  totalSets: number;
  onOpenSet: (set: PoseSet) => void;
  onQuickPlaySet: (set: PoseSet) => Promise<void>;
  cardThumbSize: number;
};

export function OverviewPage({
  isConnected,
  setFilter,
  onSetFilterChange,
  setSort,
  onSetSortChange,
  onShuffleSets,
  selectedTags,
  sortedTags,
  tagCounts,
  onToggleFilterTag,
  onClearFilters,
  filteredSets,
  totalSets,
  onOpenSet,
  onQuickPlaySet,
  cardThumbSize,
}: OverviewPageProps) {
  const [loadingSetId, setLoadingSetId] = useState<string | null>(null);
  const [titleMetrics, setTitleMetrics] = useState<
    Record<string, { overflow: boolean; distance: number }>
  >({});
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridTop, setGridTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [gridMetrics, setGridMetrics] = useState<
    | {
        columns: number;
        rowStride: number;
        gap: number;
      }
    | null
  >(null);
  const scrollRafRef = useRef<number | null>(null);
  const titleRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const marqueeGap = 24;
  const activeFilterCount = selectedTags.length;
  const trimmedFilter = setFilter.trim();
  const hasFilters = activeFilterCount > 0 || trimmedFilter.length > 0;

  const handleTitleRef = useCallback((setId: string, node: HTMLDivElement | null) => {
    titleRefs.current.set(setId, node);
  }, []);

  const measureTitles = useCallback(() => {
    const next: Record<string, { overflow: boolean; distance: number }> = {};
    titleRefs.current.forEach((node, setId) => {
      if (!node) {
        return;
      }
      const text = node.querySelector<HTMLElement>('.card-title-text');
      if (!text) {
        return;
      }
      const containerWidth = node.clientWidth;
      const textWidth = text.scrollWidth;
      const overflow = textWidth > containerWidth + 1;
      next[setId] = {
        overflow,
        distance: Math.ceil(textWidth + marqueeGap),
      };
    });

    setTitleMetrics((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) {
        return next;
      }
      for (const key of nextKeys) {
        const prevEntry = prev[key];
        const nextEntry = next[key];
        if (
          !prevEntry ||
          prevEntry.overflow !== nextEntry.overflow ||
          prevEntry.distance !== nextEntry.distance
        ) {
          return next;
        }
      }
      return prev;
    });
  }, [marqueeGap]);

  useEffect(() => {
    const node = gridRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const styles = window.getComputedStyle(node);
      const template = styles.gridTemplateColumns.split(' ').filter(Boolean);
      const columns = Math.max(1, template.length || 1);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
      const columnWidth =
        template.length > 0 ? Number.parseFloat(template[0]) : rect.width / columns;
      const rowStride = columnWidth + gap;
      setGridTop(rect.top + window.scrollY);
      setViewportHeight(window.innerHeight);
      setGridMetrics({ columns, rowStride, gap });
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
      if (scrollRafRef.current !== null) {
        return;
      }
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setScrollY(window.scrollY);
      });
    };
    setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  const { startIndex, endIndex, spacerBefore, spacerAfter } = useMemo(() => {
    if (!gridMetrics || filteredSets.length === 0) {
      return { startIndex: 0, endIndex: filteredSets.length, spacerBefore: 0, spacerAfter: 0 };
    }
    const { columns, rowStride, gap } = gridMetrics;
    const totalRows = Math.ceil(filteredSets.length / columns);
    const rawStartRow = Math.floor((scrollY - gridTop) / rowStride);
    const rawEndRow = Math.floor((scrollY + viewportHeight - gridTop) / rowStride);
    const overscan = 2;
    const startRow = Math.max(0, rawStartRow - overscan);
    const endRow = Math.min(totalRows - 1, rawEndRow + overscan);
    const startIndex = Math.max(0, startRow * columns);
    const endIndex = Math.min(filteredSets.length, (endRow + 1) * columns);
    const spacerBefore = Math.max(0, startRow * rowStride - gap);
    const remainingRows = Math.max(0, totalRows - endRow - 1);
    const spacerAfter = Math.max(0, remainingRows * rowStride - gap);
    return { startIndex, endIndex, spacerBefore, spacerAfter };
  }, [filteredSets.length, gridMetrics, gridTop, scrollY, viewportHeight]);

  const visibleSets = useMemo(() => {
    if (gridMetrics) {
      return filteredSets.slice(startIndex, endIndex);
    }
    const fallbackCount = 24;
    return filteredSets.slice(0, fallbackCount);
  }, [filteredSets, gridMetrics, startIndex, endIndex]);

  useEffect(() => {
    let frame = window.requestAnimationFrame(measureTitles);
    const handleResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measureTitles);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, [measureTitles]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureTitles);
    return () => window.cancelAnimationFrame(frame);
  }, [measureTitles, visibleSets]);
  return (
    <section className="panel">
      <div className="panel-header panel-header--row panel-header--overview">
        <div className="overview-title">
          <div className="overview-title-row">
            <h2>Sets</h2>
          </div>
        </div>
      </div>
      <div className="panel-header panel-header--row panel-header--overview">
        <div className="overview-controls">
          <label className="field field--inline">
            <span>Filter sets</span>
            <input
              type="search"
              value={setFilter}
              onChange={(event) => onSetFilterChange(event.target.value)}
              placeholder="Search by name or tag"
            />
          </label>
          <label className="field field--inline">
            <span>Sort sets</span>
            <div className="overview-sort-row">
              <select value={setSort} onChange={(event) => onSetSortChange(event.target.value)}>
                <option value="random">Random</option>
                <option value="added_desc">Added (newest)</option>
                <option value="added_asc">Added (oldest)</option>
                <option value="images_desc">Images (high to low)</option>
                <option value="images_asc">Images (low to high)</option>
                <option value="favs_desc">Favorites (high to low)</option>
                <option value="favs_asc">Favorites (low to high)</option>
              </select>
              {setSort === 'random' ? (
                <button type="button" className="ghost overview-shuffle" onClick={onShuffleSets}>
                  <IconArrowsShuffle size={16} />
                  Shuffle
                </button>
              ) : null}
            </div>
          </label>
        </div>
      </div>
      <div className="panel-body">
        {sortedTags.length > 0 ? (
          <div className="tag-suggestions">
            <p className="muted">Filter tags</p>
            <div className="tag-row">
              {hasFilters ? (
                <button
                  type="button"
                  className="tag-button tag-button--clear"
                  onClick={onClearFilters}
                >
                  Clear filters
                </button>
              ) : null}
              {sortedTags.map((tag) => {
                const isActive = selectedTags.includes(tag);
                const count = tagCounts[tag] ?? 0;
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-button ${isActive ? 'is-active' : ''}`}
                    onClick={() => onToggleFilterTag(tag)}
                  >
                    {tag} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <span>
          Listing {filteredSets.length} out of {totalSets} sets
        </span>
        <div className="card-grid" ref={gridRef}>
          {gridMetrics && spacerBefore > 0 ? (
            <div className="card-grid-spacer" style={{ height: spacerBefore }} />
          ) : null}
          {visibleSets.map((set) => (
            <div key={set.id} className="card">
              <button
                type="button"
                className="card--clickable card-hit"
                onClick={() => onOpenSet(set)}
              >
                <div className="card-thumb">
                  {set.thumbnailFileId ? (
                    <ImageThumb
                      hoverScroll={false}
                      isConnected={isConnected}
                      fileId={set.thumbnailFileId}
                      alt={set.name}
                      size={cardThumbSize}
                      thumbPos={set.thumbnailPos}
                    />
                  ) : (
                    <div className="thumb thumb--empty">No thumbnail</div>
                  )}
                  {typeof set.imageCount === 'number' ? (
                    <span
                      className="tag ghost tag--icon card-thumb-meta card-thumb-meta--left"
                      aria-label={`${set.imageCount} images`}
                      title={`${set.imageCount} images`}
                    >
                      <IconPhoto size={14} />
                      <span>{set.imageCount}</span>
                    </span>
                  ) : null}
                  <span
                    className="tag ghost tag--icon card-thumb-meta card-thumb-meta--right"
                    aria-label={`${(set.favoriteImageIds ?? []).length} favorites`}
                    title={`${(set.favoriteImageIds ?? []).length} favorites`}
                  >
                    <IconHeart size={14} />
                    <span>{(set.favoriteImageIds ?? []).length}</span>
                  </span>
                </div>
              </button>
              <div className="card-overlay" aria-hidden="true">
                <span
                  className={`card-overlay-title ${
                    titleMetrics[set.id]?.overflow ? 'is-marquee' : ''
                  }`}
                  ref={(node) => handleTitleRef(set.id, node)}
                  style={
                    titleMetrics[set.id]?.overflow
                      ? ({
                          '--marquee-distance': `${titleMetrics[set.id]?.distance ?? 0}px`,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  <span className="card-title-track">
                    <span className="card-title-text">{set.name}</span>
                    <span className="card-title-text card-title-duplicate" aria-hidden="true">
                      {set.name}
                    </span>
                  </span>
                </span>
              </div>
              <button
                type="button"
                className={`card-play ${loadingSetId === set.id ? 'is-loading' : ''}`}
                aria-label={`Play ${set.name}`}
                disabled={loadingSetId === set.id}
                onClick={async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setLoadingSetId(set.id);
                  try {
                    await onQuickPlaySet(set);
                  } finally {
                    setLoadingSetId((current) => (current === set.id ? null : current));
                  }
                }}
              >
                <IconPlayerPlayFilled size={16} />
              </button>
            </div>
          ))}
          {gridMetrics && spacerAfter > 0 ? (
            <div className="card-grid-spacer" style={{ height: spacerAfter }} />
          ) : null}
          {filteredSets.length === 0 ? (
            <p className="empty">No sets yet. Create one from a folder path.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
