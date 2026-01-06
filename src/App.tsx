import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { driveDownloadBlob } from './drive/api';
import { listFolderPaths, listImagesRecursive, type FolderPath } from './drive/scan';
import {
  createPoseSet,
  emptyMetadata,
  loadMetadata,
  saveMetadata,
  type MetadataDocument,
  type PoseSet,
} from './metadata';
import type { DriveImage } from './drive/types';

const DEFAULT_ROOT_ID = import.meta.env.VITE_ROOT_FOLDER_ID as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const IMAGE_PAGE_SIZE = 30;
const THUMBNAIL_CONCURRENCY = 4;
const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_KEY = 'poseviewer-metadata-cache';
const METADATA_CACHE_TIME_KEY = 'poseviewer-metadata-cache-ts';
const METADATA_CACHE_ROOT_KEY = 'poseviewer-metadata-root';

const emptyFolders: FolderPath[] = [];

function normalizeTags(input: string) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function pickRandom<T>(items: T[], count: number) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, count);
}

function readMetadataCache(rootId: string) {
  const cacheRoot = localStorage.getItem(METADATA_CACHE_ROOT_KEY);
  const cacheTs = localStorage.getItem(METADATA_CACHE_TIME_KEY);
  const cacheData = localStorage.getItem(METADATA_CACHE_KEY);
  if (!cacheRoot || !cacheTs || !cacheData) {
    return null;
  }
  if (cacheRoot !== rootId) {
    return null;
  }
  const timestamp = Number(cacheTs);
  if (Number.isNaN(timestamp) || Date.now() - timestamp > METADATA_CACHE_TTL) {
    return null;
  }
  try {
    return JSON.parse(cacheData) as { fileId: string | null; data: MetadataDocument };
  } catch {
    return null;
  }
}

function writeMetadataCache(
  rootId: string,
  fileId: string | null,
  data: MetadataDocument
) {
  localStorage.setItem(METADATA_CACHE_ROOT_KEY, rootId);
  localStorage.setItem(METADATA_CACHE_TIME_KEY, String(Date.now()));
  localStorage.setItem(
    METADATA_CACHE_KEY,
    JSON.stringify({
      fileId,
      data,
    })
  );
}

type QueueTask<T> = () => Promise<T>;

const thumbQueue: Array<() => void> = [];
let activeThumbTasks = 0;

function enqueueThumbTask<T>(task: QueueTask<T>) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeThumbTasks += 1;
      task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeThumbTasks -= 1;
          const next = thumbQueue.shift();
          if (next) {
            next();
          }
        });
    };

    if (activeThumbTasks < THUMBNAIL_CONCURRENCY) {
      run();
    } else {
      thumbQueue.push(run);
    }
  });
}

async function fetchMediaBlob(token: string, fileId: string) {
  let attempt = 0;
  let delay = 400;

  while (attempt < 3) {
    try {
      return await driveDownloadBlob(token, fileId);
    } catch (error) {
      const message = (error as Error).message;
      if (!message.includes('429')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
      attempt += 1;
    }
  }

  throw new Error('Drive download failed: 429');
}

function ImageThumb({ token, fileId, alt }: { token: string; fileId: string; alt: string }) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);

  if (!fileId) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  useEffect(() => {
    let isActive = true;
    let url = '';
    setSrc('');

    const load = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const blob = await enqueueThumbTask(() => fetchMediaBlob(token, fileId));
        url = URL.createObjectURL(blob);
        if (isActive) {
          setSrc(url);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isActive = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [fileId, token]);

  if (!token) {
    return <div className="thumb thumb--empty">Connect to load</div>;
  }

  return (
    <div className={`thumb ${loading ? 'thumb--loading' : ''}`}>
      {src ? <img src={src} alt={alt} loading="lazy" decoding="async" /> : <span>Loading…</span>}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem('poseviewer-token');
    const expiresAt = localStorage.getItem('poseviewer-token-expires');
    if (!stored || !expiresAt) {
      return null;
    }
    const expiry = Number(expiresAt);
    if (Number.isNaN(expiry) || Date.now() >= expiry) {
      localStorage.removeItem('poseviewer-token');
      localStorage.removeItem('poseviewer-token-expires');
      return null;
    }
    return stored;
  });
  const [tokenStatus, setTokenStatus] = useState<string>('');
  const rootId = DEFAULT_ROOT_ID ?? '';
  const [folderPaths, setFolderPaths] = useState<FolderPath[]>(emptyFolders);
  const [metadata, setMetadata] = useState<MetadataDocument>(emptyMetadata());
  const [metadataFileId, setMetadataFileId] = useState<string | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [folderFilter, setFolderFilter] = useState('');
  const [hiddenFolders, setHiddenFolders] = useLocalStorage<
    Array<{ id: string; path: string }>
  >(
    'poseviewer-hidden-folders',
    []
  );
  const [setFilter, setSetFilter] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<FolderPath | null>(null);
  const [setName, setSetName] = useState('');
  const [setTags, setSetTags] = useState('');
  const [activeSet, setActiveSet] = useState<PoseSet | null>(null);
  const [activeImages, setActiveImages] = useState<DriveImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [previewImages, setPreviewImages] = useState<DriveImage[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE);

  const filteredFolders = useMemo(() => {
    const query = folderFilter.trim().toLowerCase();
    return folderPaths.filter((folder) => {
      if (hiddenFolders.some((hidden) => hidden.id === folder.id)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return folder.path.toLowerCase().includes(query);
    });
  }, [folderFilter, folderPaths, hiddenFolders]);

  const filteredSets = useMemo(() => {
    const query = setFilter.trim().toLowerCase();
    if (!query) {
      return metadata.sets;
    }
    return metadata.sets.filter((set) => {
      const combined = `${set.name} ${set.tags.join(' ')}`.toLowerCase();
      return combined.includes(query);
    });
  }, [metadata.sets, setFilter]);

  const requestToken = useCallback(() => {
    if (!CLIENT_ID) {
      setError('Missing VITE_GOOGLE_CLIENT_ID.');
      return;
    }

    if (!window.google?.accounts?.oauth2) {
      setError('Google Identity Services did not load.');
      return;
    }

    setTokenStatus('Requesting access…');

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        setTokenStatus('Connected.');
        setToken(response.access_token);
        const expiresAt = Date.now() + response.expires_in * 1000;
        localStorage.setItem('poseviewer-token', response.access_token);
        localStorage.setItem('poseviewer-token-expires', String(expiresAt));
        setError('');
      },
    });

    client.requestAccessToken({ prompt: 'consent' });
  }, []);

  const handleFetchMetadata = useCallback(async () => {
    if (!token || !rootId) {
      return;
    }
    setIsLoadingMetadata(true);
    setError('');

    try {
      const meta = await loadMetadata(token, rootId);
      setMetadata(meta.data);
      setMetadataFileId(meta.fileId);
      writeMetadataCache(rootId, meta.fileId, meta.data);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingMetadata(false);
    }
  }, [rootId, token]);

  const handleScan = useCallback(async () => {
    if (!token || !rootId) {
      return;
    }

    setIsScanning(true);
    setError('');

    try {
      const meta = await loadMetadata(token, rootId);
      const excludeIds = new Set(meta.data.sets.map((set) => set.rootFolderId));
      const folders = await listFolderPaths(token, rootId, {
        excludeIds,
        maxCount: 50,
      });
      setFolderPaths(folders);
      setMetadata(meta.data);
      setMetadataFileId(meta.fileId);
      writeMetadataCache(rootId, meta.fileId, meta.data);
    } catch (scanError) {
      setError((scanError as Error).message);
    } finally {
      setIsScanning(false);
    }
  }, [rootId, token]);

  useEffect(() => {
    if (!token || !rootId) {
      return;
    }

    const cached = readMetadataCache(rootId);
    if (cached) {
      setMetadata(cached.data);
      setMetadataFileId(cached.fileId);
      return;
    }

    void handleFetchMetadata();
  }, [handleFetchMetadata, rootId, token]);

  const handleSelectFolder = (folder: FolderPath) => {
    setSelectedFolder(folder);
    setSetName(folder.name);
    setSetTags('');
  };

  useEffect(() => {
    if (!token || !selectedFolder) {
      setPreviewImages([]);
      return;
    }

    let isActive = true;
    setIsLoadingPreview(true);

    const loadPreview = async () => {
      try {
        const images = await listImagesRecursive(token, selectedFolder.id, 80);
        const sample = pickRandom(images, 10);
        if (isActive) {
          setPreviewImages(sample);
        }
      } catch (previewError) {
        if (isActive) {
          setError((previewError as Error).message);
        }
      } finally {
        if (isActive) {
          setIsLoadingPreview(false);
        }
      }
    };

    void loadPreview();

    return () => {
      isActive = false;
    };
  }, [selectedFolder, token]);

  const handleHideFolder = (folder: FolderPath) => {
    setHiddenFolders((current) => {
      if (current.some((hidden) => hidden.id === folder.id)) {
        return current;
      }
      return [...current, { id: folder.id, path: folder.path }];
    });
  };

  const handleShowFolder = (folderId: string) => {
    setHiddenFolders((current) => current.filter((hidden) => hidden.id !== folderId));
  };

  const handleCreateSet = async () => {
    if (!token || !rootId || !selectedFolder) {
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const images = await listImagesRecursive(token, selectedFolder.id, 1);
      const thumbnailFileId = images[0]?.id;
      const next = createPoseSet({
        name: setName.trim() || selectedFolder.name,
        rootFolderId: selectedFolder.id,
        rootPath: selectedFolder.path,
        tags: normalizeTags(setTags),
        thumbnailFileId,
      });

      const updated: MetadataDocument = {
        version: 1,
        sets: [...metadata.sets, next],
      };

      const newFileId = await saveMetadata(token, rootId, metadataFileId, updated);
      setMetadataFileId(newFileId);
      setMetadata(updated);
      writeMetadataCache(rootId, newFileId, updated);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSet = async (setId: string, update: Partial<PoseSet>) => {
    if (!token || !rootId) {
      return;
    }

    const updated: MetadataDocument = {
      version: 1,
      sets: metadata.sets.map((set) => (set.id === setId ? { ...set, ...update } : set)),
    };

    setIsSaving(true);
    setError('');

    try {
      const newFileId = await saveMetadata(token, rootId, metadataFileId, updated);
      setMetadataFileId(newFileId);
      setMetadata(updated);
      writeMetadataCache(rootId, newFileId, updated);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const loadSetImages = async (set: PoseSet, limit: number) => {
    if (!token) {
      return;
    }
    setIsLoadingImages(true);
    setError('');

    try {
      const images = await listImagesRecursive(token, set.rootFolderId, limit);
      setActiveImages(images);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingImages(false);
    }
  };

  const handleOpenSet = async (set: PoseSet) => {
    setActiveSet(set);
    setImageLimit(IMAGE_PAGE_SIZE);
    await loadSetImages(set, IMAGE_PAGE_SIZE);
  };

  const handleLoadMoreImages = async () => {
    if (!activeSet) {
      return;
    }
    const nextLimit = imageLimit + IMAGE_PAGE_SIZE;
    setImageLimit(nextLimit);
    await loadSetImages(activeSet, nextLimit);
  };

  const isConnected = Boolean(token);


  return (
    <div className={`app ${isLoadingMetadata ? 'app--loading' : ''}`}>
      <header className="topbar">
        <div className="title">Pose Viewer</div>
        <div className="auth-chip">
          <button className="chip-button" onClick={requestToken} disabled={!CLIENT_ID}>
            {isConnected ? 'Reconnect' : 'Connect'}
          </button>
          {isConnected ? <span className="chip-status">Connected</span> : null}
        </div>
      </header>
      {!CLIENT_ID ? <p className="warning">Set VITE_GOOGLE_CLIENT_ID in `.env`.</p> : null}
      {tokenStatus ? <p className="status">{tokenStatus}</p> : null}
      {isLoadingMetadata ? (
        <div className="loading-overlay">
          <div className="loading-card">Loading metadata…</div>
        </div>
      ) : null}

      <section className="columns">
        <div className="panel">
          <div className="panel-header panel-header--row">
            <div>
              <h2>Folder paths</h2>
              <p>Select any folder (including nested) to define a set. Limited to 50 paths.</p>
            </div>
            <div className="panel-actions">
              <button className="ghost" onClick={handleFetchMetadata} disabled={!isConnected}>
                Fetch metadata
              </button>
              <button className="primary" onClick={handleScan} disabled={!isConnected || !rootId}>
                {isScanning ? 'Scanning…' : 'Scan folders'}
              </button>
            </div>
          </div>
          <div className="panel-body">
            <label className="field">
              <span>Filter folders</span>
              <input
                type="search"
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                placeholder="Search by path"
              />
            </label>
            {hiddenFolders.length > 0 ? (
              <div className="hidden-list">
                {hiddenFolders.map((folder) => (
                  <div key={folder.id} className="hidden-pill">
                    <span>{folder.path}</span>
                    <button className="pill-button" onClick={() => handleShowFolder(folder.id)}>
                      Show
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
                    onClick={() => handleSelectFolder(folder)}
                  >
                    <span>{folder.path}</span>
                    <span className="badge">{folder.name}</span>
                  </button>
                  <button className="list-action" onClick={() => handleHideFolder(folder)}>
                    Hide
                  </button>
                </div>
              ))}
              {filteredFolders.length === 0 ? (
                <p className="empty">No folders yet. Run a scan to populate this list.</p>
              ) : null}
            </div>
            {error ? <p className="error">{error}</p> : null}
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
                <div className="pill">{selectedFolder.path}</div>
                <label className="field">
                  <span>Set name</span>
                  <input
                    type="text"
                    value={setName}
                    onChange={(event) => setSetName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Tags (comma separated)</span>
                  <input
                    type="text"
                    value={setTags}
                    onChange={(event) => setSetTags(event.target.value)}
                    placeholder="male, clothed, 1000+"
                  />
                </label>
                <div className="preview">
                  <p className="muted">Preview sample (random 10)</p>
                  {isLoadingPreview ? (
                    <p className="empty">Loading preview…</p>
                  ) : previewImages.length > 0 ? (
                    <div className="preview-grid">
                      {previewImages.map((image) => (
                        <ImageThumb
                          key={image.id}
                          token={token ?? ''}
                          fileId={image.id}
                          alt={selectedFolder.name}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="empty">No images found under this folder.</p>
                  )}
                </div>
                <button className="primary" onClick={handleCreateSet} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Create set & pick first thumbnail'}
                </button>
              </div>
            ) : (
              <p className="empty">Select a folder path to populate this form.</p>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Sets overview</h2>
          <p>Browse, filter, and open any set.</p>
        </div>
        <div className="panel-body">
          <label className="field">
            <span>Filter sets</span>
            <input
              type="search"
              value={setFilter}
              onChange={(event) => setSetFilter(event.target.value)}
              placeholder="Search by name or tag"
            />
          </label>
          <div className="card-grid">
            {filteredSets.map((set) => (
              <button
                key={set.id}
                className="card card--clickable"
                onClick={() => handleOpenSet(set)}
              >
                {token ? (
                  set.thumbnailFileId ? (
                    <ImageThumb
                      token={token}
                      fileId={set.thumbnailFileId}
                      alt={set.name}
                    />
                  ) : (
                    <div className="thumb thumb--empty">No thumbnail</div>
                  )
                ) : null}
                <div className="card-body">
                  <h3>{set.name}</h3>
                  <p className="muted">{set.rootPath}</p>
                  <div className="tag-row">
                    {set.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                    {set.tags.length === 0 ? <span className="tag ghost">No tags</span> : null}
                  </div>
                </div>
              </button>
            ))}
            {filteredSets.length === 0 ? (
              <p className="empty">No sets yet. Create one from a folder path.</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Set viewer</h2>
          <p>{activeSet ? activeSet.name : 'Open a set to preview its images.'}</p>
        </div>
        <div className="panel-body">
          {activeSet ? (
            <div className="stack">
              <div className="viewer-header">
                <div>
                  <h3>{activeSet.name}</h3>
                  <p className="muted">{activeSet.rootPath}</p>
                </div>
                <button className="ghost" onClick={() => handleOpenSet(activeSet)}>
                  Refresh images
                </button>
              </div>
              <div key={activeSet.id} className="field-group">
                <label className="field">
                  <span>Name</span>
                  <input
                    type="text"
                    defaultValue={activeSet.name}
                    onBlur={(event) =>
                      handleUpdateSet(activeSet.id, {
                        name: event.target.value.trim() || activeSet.name,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Tags</span>
                  <input
                    type="text"
                    defaultValue={activeSet.tags.join(', ')}
                    onBlur={(event) =>
                      handleUpdateSet(activeSet.id, { tags: normalizeTags(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Thumbnail file ID</span>
                  <input
                    type="text"
                    defaultValue={activeSet.thumbnailFileId ?? ''}
                    onBlur={(event) =>
                      handleUpdateSet(activeSet.id, {
                        thumbnailFileId: event.target.value.trim() || undefined,
                      })
                    }
                  />
                </label>
              </div>
              {isLoadingImages ? (
                <p className="empty">Loading images…</p>
              ) : (
                <div className="stack">
                  <div className="image-grid">
                    {activeImages.map((image) => (
                      <ImageThumb
                        key={image.id}
                        token={token ?? ''}
                        fileId={image.id}
                        alt={activeSet.name}
                      />
                    ))}
                    {activeImages.length === 0 ? (
                      <p className="empty">No images found in this set.</p>
                    ) : null}
                  </div>
                  {activeImages.length > 0 ? (
                    <button className="ghost" onClick={handleLoadMoreImages}>
                      Load more images
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <p className="empty">Select a set above to view images.</p>
          )}
        </div>
      </section>
    </div>
  );
}
