import type { FolderPath } from '../drive/scan';
import type { DriveImage } from '../drive/types';
import { ImageThumb } from '../components/ImageThumb';
import { useModal } from '../features/modal/ModalContext';

type CreateSetPageProps = {
  isConnected: boolean;
  rootId: string;
  isScanning: boolean;
  scanCount: number;
  scanPath: string;
  folderFilter: string;
  onFolderFilterChange: (value: string) => void;
  hiddenFolders: Array<{ id: string; path: string }>;
  showHiddenFolders: boolean;
  onToggleHiddenFolders: () => void;
  onShowFolder: (folderId: string) => void;
  filteredFolders: FolderPath[];
  selectedFolder: FolderPath | null;
  onSelectFolder: (folder: FolderPath) => void;
  onHideFolder: (folder: FolderPath) => void;
  error: string;
  isSaving: boolean;
  setName: string;
  onSetNameChange: (value: string) => void;
  setTags: string;
  onSetTagsChange: (value: string) => void;
  availableTags: string[];
  sortedQuickTags: string[];
  selectedCreateTags: string[];
  onToggleCreateTag: (tag: string) => void;
  previewImages: DriveImage[];
  previewCount: number | null;
  isLoadingPreview: boolean;
  previewIndexProgress: string;
  onRefreshPreview: () => void;
  onCreateSet: () => void;
  onScanFolders: () => void;
  thumbSize: number;
};

export function CreateSetPage({
  isConnected,
  rootId,
  isScanning,
  scanCount,
  scanPath,
  folderFilter,
  onFolderFilterChange,
  hiddenFolders,
  showHiddenFolders,
  onToggleHiddenFolders,
  onShowFolder,
  filteredFolders,
  selectedFolder,
  onSelectFolder,
  onHideFolder,
  error,
  isSaving,
  setName,
  onSetNameChange,
  setTags,
  onSetTagsChange,
  availableTags,
  sortedQuickTags,
  selectedCreateTags,
  onToggleCreateTag,
  previewImages,
  previewCount,
  isLoadingPreview,
  previewIndexProgress,
  onRefreshPreview,
  onCreateSet,
  onScanFolders,
  thumbSize,
}: CreateSetPageProps) {
  const { openModal } = useModal();
  return (
    <section className="columns">
      <div className="panel">
        <div className="panel-header panel-header--row">
          <div>
            <h2>Folder paths</h2>
            <p>Select any folder (including nested) to define a set. Limited to 50 paths.</p>
          </div>
          <div className="panel-actions">
            <button className="primary" onClick={onScanFolders} disabled={!isConnected || !rootId}>
              {isScanning ? 'Scanning…' : 'Scan folders'}
            </button>
          </div>
        </div>
        <div className="panel-body panel-body--overlay">
          <label className="field">
            <span>Filter folders</span>
            <input
              type="search"
              value={folderFilter}
              onChange={(event) => onFolderFilterChange(event.target.value)}
              placeholder="Search by path"
            />
          </label>
          {hiddenFolders.length > 0 ? (
            <button className="ghost" type="button" onClick={onToggleHiddenFolders}>
              {showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
            </button>
          ) : null}
          {showHiddenFolders && hiddenFolders.length > 0 ? (
            <div className="hidden-list">
              {hiddenFolders.map((folder) => (
                <div key={folder.id} className="hidden-pill">
                  <span>{folder.path}</span>
                  <button className="pill-button" onClick={() => onShowFolder(folder.id)}>
                    Unhide
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="list">
            {filteredFolders.map((folder) => (
              <div key={folder.id} className="list-row">
                <button
                  className={`list-item ${selectedFolder?.id === folder.id ? 'active' : ''}`}
                  onClick={() => onSelectFolder(folder)}
                >
                  <span>{folder.path}</span>
                  <span className="badge">{folder.name}</span>
                </button>
                <button className="list-action" onClick={() => onHideFolder(folder)}>
                  Hide
                </button>
              </div>
            ))}
            {filteredFolders.length === 0 ? (
              <p className="empty">No folders yet. Run a scan to populate this list.</p>
            ) : null}
          </div>
          {error ? <p className="error">{error}</p> : null}
          {isScanning ? (
            <div className="panel-overlay">
              <div className="overlay-card">
                <p>Scanning folders…</p>
                <p className="muted">{scanCount}/50 found</p>
                {scanPath ? <p className="overlay-path">{scanPath}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Create a set</h2>
          <p>Turn any folder path into a library set.</p>
        </div>
        <div className="panel-body">
          {selectedFolder ? (
            <div className="stack">
              <a
                className="pill"
                href={`https://drive.google.com/drive/folders/${selectedFolder.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {selectedFolder.path}
              </a>
              <label className="field">
                <span>Set name</span>
                <input
                  type="text"
                  value={setName}
                  onChange={(event) => onSetNameChange(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Tags (comma separated)</span>
                <input
                  type="text"
                  value={setTags}
                  onChange={(event) => onSetTagsChange(event.target.value)}
                  placeholder="male, clothed, 1000+"
                />
              </label>
              {availableTags.length > 0 ? (
                <div className="tag-suggestions">
                  <div className="tag-row">
                    {sortedQuickTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`tag-button ${
                          selectedCreateTags.includes(tag) ? 'is-active' : ''
                        }`}
                        onClick={() => onToggleCreateTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="preview">
                <div className="preview-header">
                  <p className="muted">Preview sample (random 8)</p>
                  {previewCount !== null ? <p className="muted">{previewCount} images</p> : null}
                  <button
                    type="button"
                    className="ghost"
                    onClick={onRefreshPreview}
                    disabled={isLoadingPreview}
                  >
                    {isLoadingPreview ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                {isLoadingPreview ? (
                  <div className="stack">
                    <p className="empty">Loading preview…</p>
                    {previewIndexProgress ? <p className="muted">{previewIndexProgress}</p> : null}
                  </div>
                ) : previewIndexProgress ? (
                  <p className="muted">{previewIndexProgress}</p>
                ) : previewImages.length > 0 ? (
                  <div className="preview-grid">
                    {previewImages.map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        className="image-button"
                        onClick={() => openModal(image.id, previewImages, 'Preview')}
                      >
                        <ImageThumb
                          isConnected={isConnected}
                          fileId={image.id}
                          alt={selectedFolder.name}
                          size={thumbSize}
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No images found under this folder.</p>
                )}
              </div>
              <button className="primary" onClick={onCreateSet} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Create set'}
              </button>
            </div>
          ) : (
            <p className="empty">Select a folder path to populate this form.</p>
          )}
        </div>
      </div>
    </section>
  );
}
