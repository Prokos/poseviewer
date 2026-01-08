import { IconHeart, IconHeartFilled } from '@tabler/icons-react';
import type { MouseEvent } from 'react';
import type { PoseSet } from '../metadata';
import type { DriveImage } from '../drive/types';
import { ImageThumb } from '../components/ImageThumb';
import { useModal } from '../features/modal/ModalContext';

type SlideshowPageProps = {
  isConnected: boolean;
  slideshowSets: PoseSet[];
  slideshowFavoriteFilter: 'all' | 'favorites' | 'nonfavorites';
  onSlideshowFavoriteFilterChange: (value: 'all' | 'favorites' | 'nonfavorites') => void;
  onStartSlideshow: () => void;
  isLoadingSlideshow: boolean;
  onClearSlideshowTags: () => void;
  sortedTags: string[];
  slideshowIncludeTags: string[];
  slideshowExcludeTags: string[];
  onToggleIncludeTag: (tag: string) => void;
  onToggleExcludeTag: (tag: string) => void;
  slideshowStarted: boolean;
  viewerIndexProgress: string;
  slideshowImages: DriveImage[];
  slideshowImageSetMap: Map<string, string>;
  setsById: Map<string, PoseSet>;
  onToggleFavoriteImage: (setId: string, imageId: string) => void;
  thumbSize: number;
  onLoadMoreSlideshow: () => void | Promise<void>;
  onLoadMoreClick: (
    handler: () => void | Promise<void>
  ) => (event: MouseEvent<HTMLButtonElement>) => void;
  slideshowPageSize: number;
};

export function SlideshowPage({
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
  thumbSize,
  onLoadMoreSlideshow,
  onLoadMoreClick,
  slideshowPageSize,
}: SlideshowPageProps) {
  const { openModal } = useModal();
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
            {isLoadingSlideshow ? 'Loading…' : 'Start slideshow'}
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
          <p className="empty">Press Start slideshow to load images.</p>
        ) : isLoadingSlideshow && slideshowImages.length === 0 ? (
          <div className="stack">
            <p className="empty">Loading slideshow…</p>
            {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
          </div>
        ) : slideshowImages.length > 0 ? (
          <div className="stack">
            <div className="image-grid image-grid--zoom">
              {slideshowImages.map((image) => {
                const setId = slideshowImageSetMap.get(image.id);
                const set = setId ? setsById.get(setId) : undefined;
                const isFavorite = set?.favoriteImageIds?.includes(image.id) ?? false;
                return (
                  <div key={image.id} className="image-tile">
                    <button
                      type="button"
                      className="image-button"
                      onClick={() => openModal(image.id, slideshowImages, 'Slideshow')}
                    >
                      <ImageThumb
                        isConnected={isConnected}
                        fileId={image.id}
                        alt="Slideshow image"
                        size={thumbSize}
                      />
                    </button>
                    <button
                      type="button"
                      className={`thumb-action thumb-action--favorite ${
                        isFavorite ? 'is-active' : ''
                      }`}
                      onClick={() => (setId ? onToggleFavoriteImage(setId, image.id) : null)}
                      aria-pressed={isFavorite}
                      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      disabled={!setId}
                    >
                      {isFavorite ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="ghost load-more"
              onClick={onLoadMoreClick(onLoadMoreSlideshow)}
              disabled={isLoadingSlideshow || !slideshowStarted}
            >
              {isLoadingSlideshow
                ? `Loading... (+${slideshowPageSize})`
                : `Load more images (+${slideshowPageSize}) • ${slideshowImages.length}`}
            </button>
          </div>
        ) : (
          <p className="empty">No images matched the current filters.</p>
        )}
      </div>
    </section>
  );
}
