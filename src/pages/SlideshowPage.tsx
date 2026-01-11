import type { DriveImage } from '../drive/types';
import { ImageGrid } from '../components/ImageGrid';
import { GridLoadButtons } from '../components/GridLoadButtons';
import { useSlideshow } from '../features/slideshow/SlideshowContext';

export function SlideshowPage() {
  const {
    isConnected,
    slideshowSets,
    slideshowFavoriteFilter,
    onSlideshowFavoriteFilterChange,
    onStartSlideshow,
    isLoadingSlideshow,
    onClearSlideshowTags,
    sortedTags,
    slideshowIncludeTags,
    slideshowExcludeTags,
    onToggleIncludeTag,
    onToggleExcludeTag,
    slideshowStarted,
    viewerIndexProgress,
    slideshowImages,
    slideshowImageSetMap,
    setsById,
    onToggleFavoriteImage,
    onToggleHiddenImage,
    thumbSize,
    onLoadMoreSlideshow,
    slideshowPageSize,
  } = useSlideshow();
  const favoriteAction = {
    isActive: (image: DriveImage) => {
      const setId = slideshowImageSetMap.get(image.id);
      const set = setId ? setsById.get(setId) : undefined;
      return set?.favoriteImageIds?.includes(image.id) ?? false;
    },
    onToggle: (image: DriveImage) => {
      const setId = slideshowImageSetMap.get(image.id);
      if (setId) {
        onToggleFavoriteImage(setId, image.id);
      }
    },
    disabled: (image: DriveImage) => !slideshowImageSetMap.get(image.id),
  };
  const hideAction = {
    isActive: (image: DriveImage) => {
      const setId = slideshowImageSetMap.get(image.id);
      const set = setId ? setsById.get(setId) : undefined;
      return set?.hiddenImageIds?.includes(image.id) ?? false;
    },
    onToggle: (image: DriveImage) => {
      const setId = slideshowImageSetMap.get(image.id);
      if (setId) {
        onToggleHiddenImage(setId, image.id);
      }
    },
    disabled: (image: DriveImage) => !slideshowImageSetMap.get(image.id),
  };
  return (
    <section className="panel panel--slideshow">
      <div className="panel-header panel-header--row">
        <div className="overview-title">
          <h2>Slideshow</h2>
          <p className="muted">{slideshowSets.length} sets matched</p>
        </div>
        <div className="overview-controls">
          <label className="field field--inline">
            <span>Favorites</span>
            <select
              value={slideshowFavoriteFilter}
              onChange={(event) =>
                onSlideshowFavoriteFilterChange(
                  event.target.value as 'all' | 'favorites' | 'nonfavorites'
                )
              }
            >
              <option value="all">All images</option>
              <option value="favorites">Favorites only</option>
              <option value="nonfavorites">Non favorites only</option>
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={onStartSlideshow}
            disabled={isLoadingSlideshow || slideshowSets.length === 0}
          >
            {isLoadingSlideshow ? 'Loading…' : 'Generate slideshow'}
          </button>
          <button
            type="button"
            className="ghost tag-filter-clear"
            onClick={onClearSlideshowTags}
            disabled={slideshowIncludeTags.length === 0 && slideshowExcludeTags.length === 0}
          >
            Clear tags
          </button>
        </div>
      </div>
      <div className="panel-body">
        {sortedTags.length > 0 ? (
          <div className="tag-suggestions">
            <div className="tag-filter-header">
              <p className="muted">Include tags</p>
            </div>
            <div className="tag-row">
              {sortedTags.map((tag) => {
                const isActive = slideshowIncludeTags.includes(tag);
                return (
                  <button
                    key={`include-${tag}`}
                    type="button"
                    className={`tag-button ${isActive ? 'is-active' : ''}`}
                    onClick={() => onToggleIncludeTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="tag-filter-header">
              <p className="muted">Exclude tags</p>
            </div>
            <div className="tag-row">
              {sortedTags.map((tag) => {
                const isActive = slideshowExcludeTags.includes(tag);
                return (
                  <button
                    key={`exclude-${tag}`}
                    type="button"
                    className={`tag-button tag-button--exclude ${isActive ? 'is-active' : ''}`}
                    onClick={() => onToggleExcludeTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {slideshowSets.length === 0 ? (
          <p className="empty">No sets match the current filters.</p>
        ) : !slideshowStarted ? (
          <p className="empty">Press Generate slideshow to load images.</p>
        ) : isLoadingSlideshow && slideshowImages.length === 0 ? (
          <div className="stack">
            <p className="empty">Loading slideshow…</p>
            {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
          </div>
        ) : slideshowImages.length > 0 ? (
          <div className="stack">
            <ImageGrid
              images={slideshowImages}
              isConnected={isConnected}
              thumbSize={thumbSize}
              alt="Slideshow image"
              modalLabel="Slideshow"
              gridClassName="image-grid image-grid--zoom"
              favoriteAction={favoriteAction}
              hideAction={hideAction}
            />
            <GridLoadButtons
              variant="slideshow"
              isLoading={isLoadingSlideshow}
              currentCount={slideshowImages.length}
              pendingCount={slideshowPageSize}
              disabled={!slideshowStarted}
              onLoadMore={onLoadMoreSlideshow}
            />
          </div>
        ) : (
          <p className="empty">No images matched the current filters.</p>
        )}
      </div>
    </section>
  );
}
