import {
  IconDotsVertical,
  IconFolder,
  IconHeart,
  IconHeartFilled,
  IconPhoto,
  IconPhotoStar,
} from '@tabler/icons-react';
import type { MouseEvent, RefObject } from 'react';
import type { PoseSet } from '../metadata';
import type { DriveImage } from '../drive/types';
import { ImageThumb } from '../components/ImageThumb';

type ViewerQuickTags = {
  active: string[];
  inactive: string[];
};

type SetViewerPageProps = {
  activeSet: PoseSet | null;
  isConnected: boolean;
  isSaving: boolean;
  isRefreshingSet: boolean;
  setViewerTab: 'samples' | 'favorites' | 'nonfavorites' | 'all';
  onSetViewerTab: (tab: 'samples' | 'favorites' | 'nonfavorites' | 'all') => void;
  viewerQuickTags: ViewerQuickTags;
  onToggleActiveSetTag: (tag: string) => void;
  favoriteIds: string[];
  favoritesCount: number;
  nonFavoritesCount?: number;
  allImagesCount: number;
  sampleImages: DriveImage[];
  favoriteImages: DriveImage[];
  nonFavoriteImages: DriveImage[];
  activeImages: DriveImage[];
  viewerIndexProgress: string;
  isLoadingSample: boolean;
  isLoadingFavorites: boolean;
  isLoadingNonFavorites: boolean;
  isLoadingImages: boolean;
  isLoadingMore: boolean;
  totalImagesKnown?: number;
  samplePendingExtra: number;
  nonFavoritesPendingExtra: number;
  favoritesPendingExtra: number;
  pendingExtra: number;
  remainingImages?: number;
  onLoadMoreSample: () => void | Promise<void>;
  onLoadAllSample: () => void | Promise<void>;
  onLoadMoreNonFavorites: () => void | Promise<void>;
  onLoadAllNonFavorites: () => void | Promise<void>;
  onLoadMoreFavorites: () => void | Promise<void>;
  onLoadAllFavorites: () => void | Promise<void>;
  onLoadMoreImages: () => void | Promise<void>;
  onLoadAllPreloaded: () => void | Promise<void>;
  onOpenModal: (imageId: string, images: DriveImage[], label: string) => void;
  onToggleFavoriteImage: (setId: string, imageId: string) => void;
  onSetThumbnail: (setId: string, imageId: string) => void;
  onUpdateSetName: (value: string) => void;
  onRefreshSet: (set: PoseSet) => void;
  onDeleteSet: (set: PoseSet) => void;
  onLoadMoreClick: (
    handler: () => void | Promise<void>
  ) => (event: MouseEvent<HTMLButtonElement>) => void;
  thumbSize: number;
  viewerThumbSize: number;
  sampleGridRef: RefObject<HTMLDivElement>;
  allGridRef: RefObject<HTMLDivElement>;
  sectionRef: RefObject<HTMLDivElement>;
};

export function SetViewerPage({
  activeSet,
  isConnected,
  isSaving,
  isRefreshingSet,
  setViewerTab,
  onSetViewerTab,
  viewerQuickTags,
  onToggleActiveSetTag,
  favoriteIds,
  favoritesCount,
  nonFavoritesCount,
  allImagesCount,
  sampleImages,
  favoriteImages,
  nonFavoriteImages,
  activeImages,
  viewerIndexProgress,
  isLoadingSample,
  isLoadingFavorites,
  isLoadingNonFavorites,
  isLoadingImages,
  isLoadingMore,
  totalImagesKnown,
  samplePendingExtra,
  nonFavoritesPendingExtra,
  favoritesPendingExtra,
  pendingExtra,
  remainingImages,
  onLoadMoreSample,
  onLoadAllSample,
  onLoadMoreNonFavorites,
  onLoadAllNonFavorites,
  onLoadMoreFavorites,
  onLoadAllFavorites,
  onLoadMoreImages,
  onLoadAllPreloaded,
  onOpenModal,
  onToggleFavoriteImage,
  onSetThumbnail,
  onUpdateSetName,
  onRefreshSet,
  onDeleteSet,
  onLoadMoreClick,
  thumbSize,
  viewerThumbSize,
  sampleGridRef,
  allGridRef,
  sectionRef,
}: SetViewerPageProps) {
  const favoritesRemaining = Math.max(0, favoritesCount - favoriteImages.length);
  return (
    <section className="panel" ref={sectionRef}>
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
                  <span>{(activeSet.favoriteImageIds ?? []).length}</span>
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
                className={`subtab ${setViewerTab === 'samples' ? 'is-active' : ''}`}
                onClick={() => onSetViewerTab('samples')}
              >
                Sample
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
                Non favorites{nonFavoritesCount !== undefined ? ` (${nonFavoritesCount})` : ''}
              </button>
              <button
                type="button"
                className={`subtab ${setViewerTab === 'all' ? 'is-active' : ''}`}
                onClick={() => onSetViewerTab('all')}
              >
                All images ({allImagesCount})
              </button>
            </div>
            {setViewerTab === 'samples' ? (
              <div className="preview">
                {isLoadingSample ? (
                  <div className="stack">
                    <p className="empty">Loading sample…</p>
                    {viewerIndexProgress ? <p className="muted">{viewerIndexProgress}</p> : null}
                  </div>
                ) : viewerIndexProgress ? (
                  <p className="muted">{viewerIndexProgress}</p>
                ) : sampleImages.length > 0 ? (
                  <div className="image-grid image-grid--zoom" ref={sampleGridRef}>
                    {sampleImages.map((image) => (
                      <div key={image.id} className="image-tile">
                        <button
                          type="button"
                          className="image-button"
                          onClick={() => onOpenModal(image.id, sampleImages, 'Sample')}
                        >
                          <ImageThumb
                            isConnected={isConnected}
                            fileId={image.id}
                            alt={activeSet.name}
                            size={thumbSize}
                          />
                        </button>
                        <button
                          type="button"
                          className={`thumb-action thumb-action--favorite ${
                            favoriteIds.includes(image.id) ? 'is-active' : ''
                          }`}
                          onClick={() => onToggleFavoriteImage(activeSet.id, image.id)}
                          aria-pressed={favoriteIds.includes(image.id)}
                          aria-label={
                            favoriteIds.includes(image.id)
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                        >
                          {favoriteIds.includes(image.id) ? (
                            <IconHeartFilled size={16} />
                          ) : (
                            <IconHeart size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`thumb-action ${
                            activeSet.thumbnailFileId === image.id ? 'is-active' : ''
                          }`}
                          onClick={() => onSetThumbnail(activeSet.id, image.id)}
                          disabled={isSaving || activeSet.thumbnailFileId === image.id}
                          aria-label="Use as thumbnail"
                        >
                          <IconPhotoStar size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No sample yet. Refresh to build a preview.</p>
                )}
                <button
                  type="button"
                  className="ghost load-more"
                  onClick={onLoadMoreClick(onLoadMoreSample)}
                  disabled={isLoadingSample}
                >
                  {isLoadingSample
                    ? totalImagesKnown !== undefined
                      ? `Loading... (+${samplePendingExtra}) • ${sampleImages.length}/${totalImagesKnown}`
                      : 'Loading images...'
                    : totalImagesKnown !== undefined
                      ? sampleImages.length > 0
                        ? `Load more images (+${samplePendingExtra}) • ${sampleImages.length}/${totalImagesKnown}`
                        : `Load images (+${samplePendingExtra}) • ${sampleImages.length}/${totalImagesKnown}`
                      : sampleImages.length > 0
                        ? `Load more images (+${samplePendingExtra})`
                        : `Load images (+${samplePendingExtra})`}
                </button>
                <button
                  type="button"
                  className="ghost load-more"
                  onClick={onLoadMoreClick(onLoadAllSample)}
                  disabled={isLoadingSample}
                >
                  {isLoadingSample
                    ? totalImagesKnown !== undefined
                      ? `Loading all ${totalImagesKnown}...`
                      : 'Loading all images...'
                    : totalImagesKnown !== undefined
                      ? `Load all remaining ${Math.max(0, totalImagesKnown - sampleImages.length)}`
                      : 'Load all remaining'}
                </button>
              </div>
            ) : null}
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
                  <div className="image-grid image-grid--zoom" ref={sampleGridRef}>
                    {nonFavoriteImages.map((image) => (
                      <div key={image.id} className="image-tile">
                        <button
                          type="button"
                          className="image-button"
                          onClick={() => onOpenModal(image.id, nonFavoriteImages, 'Non favorites')}
                        >
                          <ImageThumb
                            isConnected={isConnected}
                            fileId={image.id}
                            alt={activeSet.name}
                            size={thumbSize}
                          />
                        </button>
                        <button
                          type="button"
                          className={`thumb-action thumb-action--favorite ${
                            favoriteIds.includes(image.id) ? 'is-active' : ''
                          }`}
                          onClick={() => onToggleFavoriteImage(activeSet.id, image.id)}
                          aria-pressed={favoriteIds.includes(image.id)}
                          aria-label={
                            favoriteIds.includes(image.id)
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                        >
                          {favoriteIds.includes(image.id) ? (
                            <IconHeartFilled size={16} />
                          ) : (
                            <IconHeart size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`thumb-action ${
                            activeSet.thumbnailFileId === image.id ? 'is-active' : ''
                          }`}
                          onClick={() => onSetThumbnail(activeSet.id, image.id)}
                          disabled={isSaving || activeSet.thumbnailFileId === image.id}
                          aria-label="Use as thumbnail"
                        >
                          <IconPhotoStar size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No non-favorites yet.</p>
                )}
                <button
                  type="button"
                  className="ghost load-more"
                  onClick={onLoadMoreClick(onLoadMoreNonFavorites)}
                  disabled={isLoadingNonFavorites}
                >
                  {isLoadingNonFavorites
                    ? nonFavoritesCount !== undefined
                      ? `Loading... (+${nonFavoritesPendingExtra}) • ${nonFavoriteImages.length}/${nonFavoritesCount}`
                      : 'Loading images...'
                    : nonFavoritesCount !== undefined
                      ? nonFavoriteImages.length > 0
                        ? `Load more images (+${nonFavoritesPendingExtra}) • ${nonFavoriteImages.length}/${nonFavoritesCount}`
                        : `Load images (+${nonFavoritesPendingExtra}) • ${nonFavoriteImages.length}/${nonFavoritesCount}`
                      : nonFavoriteImages.length > 0
                        ? `Load more images (+${nonFavoritesPendingExtra})`
                        : `Load images (+${nonFavoritesPendingExtra})`}
                </button>
                <button
                  type="button"
                  className="ghost load-more"
                  onClick={onLoadMoreClick(onLoadAllNonFavorites)}
                  disabled={isLoadingNonFavorites}
                >
                  {isLoadingNonFavorites
                    ? nonFavoritesCount !== undefined
                      ? `Loading all ${nonFavoritesCount}...`
                      : 'Loading all images...'
                    : nonFavoritesCount !== undefined
                      ? `Load all remaining ${Math.max(
                          0,
                          nonFavoritesCount - nonFavoriteImages.length
                        )} • ${nonFavoriteImages.length}/${nonFavoritesCount}`
                      : 'Load all remaining'}
                </button>
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
                  <div className="image-grid image-grid--zoom image-grid--filled">
                    {favoriteImages.map((image) => (
                      <div key={image.id} className="image-tile">
                        <button
                          type="button"
                          className="image-button"
                          onClick={() => onOpenModal(image.id, favoriteImages, 'Favorites')}
                        >
                          <ImageThumb
                            isConnected={isConnected}
                            fileId={image.id}
                            alt={activeSet.name}
                            size={thumbSize}
                          />
                        </button>
                        <button
                          type="button"
                          className={`thumb-action thumb-action--favorite ${
                            favoriteIds.includes(image.id) ? 'is-active' : ''
                          }`}
                          onClick={() => onToggleFavoriteImage(activeSet.id, image.id)}
                          aria-pressed={favoriteIds.includes(image.id)}
                          aria-label={
                            favoriteIds.includes(image.id)
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                        >
                          {favoriteIds.includes(image.id) ? (
                            <IconHeartFilled size={16} />
                          ) : (
                            <IconHeart size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`thumb-action ${
                            activeSet.thumbnailFileId === image.id ? 'is-active' : ''
                          }`}
                          onClick={() => onSetThumbnail(activeSet.id, image.id)}
                          disabled={isSaving || activeSet.thumbnailFileId === image.id}
                          aria-label="Use as thumbnail"
                        >
                          <IconPhotoStar size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No favorites yet.</p>
                )}
                <button
                  type="button"
                  className="ghost load-more"
                  onClick={onLoadMoreClick(onLoadMoreFavorites)}
                  disabled={isLoadingFavorites || favoritesRemaining === 0}
                >
                  {isLoadingFavorites
                    ? `Loading... (+${favoritesPendingExtra}) • ${favoriteImages.length}/${favoritesCount}`
                    : favoritesRemaining > 0
                      ? `Load more favorites (+${favoritesPendingExtra}) • ${favoriteImages.length}/${favoritesCount}`
                      : `All favorites loaded (${favoriteImages.length})`}
                </button>
                <button
                  type="button"
                  className="ghost load-more"
                  onClick={onLoadMoreClick(onLoadAllFavorites)}
                  disabled={isLoadingFavorites || favoritesRemaining === 0}
                >
                  {isLoadingFavorites
                    ? `Loading all ${favoritesCount}...`
                    : `Load all remaining ${favoritesRemaining}`}
                </button>
              </div>
            ) : null}
            {setViewerTab === 'all' ? (
              <div className="stack">
                <div className="image-grid image-grid--zoom" ref={allGridRef}>
                  {activeImages.map((image) => (
                    <div key={image.id} className="image-tile">
                      <button
                        type="button"
                        className="image-button"
                        onClick={() => onOpenModal(image.id, activeImages, 'Set')}
                      >
                        <ImageThumb
                          isConnected={isConnected}
                          fileId={image.id}
                          alt={activeSet.name}
                          size={thumbSize}
                        />
                      </button>
                      <button
                        type="button"
                        className={`thumb-action thumb-action--favorite ${
                          favoriteIds.includes(image.id) ? 'is-active' : ''
                        }`}
                        onClick={() => onToggleFavoriteImage(activeSet.id, image.id)}
                        aria-pressed={favoriteIds.includes(image.id)}
                        aria-label={
                          favoriteIds.includes(image.id)
                            ? 'Remove from favorites'
                            : 'Add to favorites'
                        }
                      >
                        {favoriteIds.includes(image.id) ? (
                          <IconHeartFilled size={16} />
                        ) : (
                          <IconHeart size={16} />
                        )}
                      </button>
                      <button
                        type="button"
                        className={`thumb-action ${
                          activeSet.thumbnailFileId === image.id ? 'is-active' : ''
                        }`}
                        onClick={() => onSetThumbnail(activeSet.id, image.id)}
                        disabled={isSaving || activeSet.thumbnailFileId === image.id}
                        aria-label="Use as thumbnail"
                      >
                        <IconPhotoStar size={16} />
                      </button>
                    </div>
                  ))}
                  {!isLoadingImages && activeImages.length === 0 ? (
                    totalImagesKnown === 0 ? (
                      <p className="empty">No images found in this set.</p>
                    ) : (
                      <p className="empty">No images loaded yet. Use the load buttons below.</p>
                    )
                  ) : null}
                </div>
                {pendingExtra > 0 ? (
                  <button
                    type="button"
                    className="ghost load-more"
                    onClick={onLoadMoreClick(onLoadMoreImages)}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore
                      ? totalImagesKnown !== undefined
                        ? `Loading... (+${pendingExtra}) • ${activeImages.length}/${totalImagesKnown}`
                        : 'Loading images...'
                      : totalImagesKnown !== undefined
                        ? activeImages.length > 0
                          ? `Load more images (+${pendingExtra}) • ${activeImages.length}/${totalImagesKnown}`
                          : `Load images (+${pendingExtra}) • ${activeImages.length}/${totalImagesKnown}`
                        : activeImages.length > 0
                          ? `Load more images (+${pendingExtra})`
                          : `Load images (+${pendingExtra})`}
                  </button>
                ) : null}
                {remainingImages !== undefined && remainingImages > 0 ? (
                  <button
                    type="button"
                    className="ghost load-more"
                    onClick={onLoadMoreClick(onLoadAllPreloaded)}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? `Loading all ${allImagesCount}...` : `Load all remaining ${remainingImages}`}
                  </button>
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
