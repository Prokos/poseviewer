import { IconHeart, IconPhoto } from '@tabler/icons-react';
import type { PoseSet } from '../metadata';
import { ImageThumb } from '../components/ImageThumb';

type OverviewPageProps = {
  isConnected: boolean;
  setFilter: string;
  onSetFilterChange: (value: string) => void;
  setSort: string;
  onSetSortChange: (value: string) => void;
  selectedTags: string[];
  sortedTags: string[];
  tagCounts: Record<string, number>;
  onToggleFilterTag: (tag: string) => void;
  onClearFilters: () => void;
  filteredSets: PoseSet[];
  totalSets: number;
  onOpenSet: (set: PoseSet) => void;
  cardThumbSize: number;
};

export function OverviewPage({
  isConnected,
  setFilter,
  onSetFilterChange,
  setSort,
  onSetSortChange,
  selectedTags,
  sortedTags,
  tagCounts,
  onToggleFilterTag,
  onClearFilters,
  filteredSets,
  totalSets,
  onOpenSet,
  cardThumbSize,
}: OverviewPageProps) {
  return (
    <section className="panel">
      <div className="panel-header panel-header--row panel-header--overview">
        <div className="overview-title">
          <h2>Sets</h2>
          <p className="muted">{totalSets} total</p>
        </div>
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
            <select value={setSort} onChange={(event) => onSetSortChange(event.target.value)}>
              <option value="added_desc">Added (newest)</option>
              <option value="added_asc">Added (oldest)</option>
              <option value="images_desc">Images (high to low)</option>
              <option value="images_asc">Images (low to high)</option>
              <option value="favs_desc">Favorites (high to low)</option>
              <option value="favs_asc">Favorites (low to high)</option>
            </select>
          </label>
        </div>
      </div>
      <div className="panel-body">
        {sortedTags.length > 0 ? (
          <div className="tag-suggestions">
            <div className="tag-filter-header">
              <p className="muted">Filter tags</p>
              <button
                type="button"
                className="ghost tag-filter-clear"
                onClick={onClearFilters}
                disabled={selectedTags.length === 0 && setFilter.trim().length === 0}
              >
                Clear filters
              </button>
            </div>
            <div className="tag-row">
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
        <div className="card-grid">
          {filteredSets.map((set) => (
            <button key={set.id} className="card card--clickable" onClick={() => onOpenSet(set)}>
              <div className="card-thumb">
                {set.thumbnailFileId ? (
                  <ImageThumb
                    isConnected={isConnected}
                    fileId={set.thumbnailFileId}
                    alt={set.name}
                    size={cardThumbSize}
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
          ))}
          {filteredSets.length === 0 ? (
            <p className="empty">No sets yet. Create one from a folder path.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
