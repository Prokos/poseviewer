import {
  IconArrowsShuffle,
  IconHeart,
  IconPhoto,
  IconPlayerPlayFilled,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  }, [measureTitles, filteredSets]);
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
        <div className="card-grid">
          {filteredSets.map((set) => (
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
          {filteredSets.length === 0 ? (
            <p className="empty">No sets yet. Create one from a folder path.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
