import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconPhotoStar } from '@tabler/icons-react';
import { useLocalStorage } from './hooks/useLocalStorage';
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
const OVERVIEW_SIZE = 320;
const PREVIEW_SIZE = 220;
const VIEWER_SIZE = 1000;
const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_KEY = 'poseviewer-metadata-cache';
const METADATA_CACHE_TIME_KEY = 'poseviewer-metadata-cache-ts';
const METADATA_CACHE_ROOT_KEY = 'poseviewer-metadata-root';
const IMAGE_LIST_CACHE_TTL = 24 * 60 * 60 * 1000;
const IMAGE_LIST_CACHE_PREFIX = 'poseviewer-set-images:';
const IMAGE_LIST_CACHE_TIME_PREFIX = 'poseviewer-set-images-ts:';

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

function readImageListCache(setId: string) {
  const data = localStorage.getItem(`${IMAGE_LIST_CACHE_PREFIX}${setId}`);
  const ts = localStorage.getItem(`${IMAGE_LIST_CACHE_TIME_PREFIX}${setId}`);
  if (!data || !ts) {
    return null;
  }
  const timestamp = Number(ts);
  if (Number.isNaN(timestamp) || Date.now() - timestamp > IMAGE_LIST_CACHE_TTL) {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as Array<{ id: string; name: string }>;
    return parsed.map((item) => ({
      id: item.id,
      name: item.name,
      mimeType: 'image/jpeg',
    })) as DriveImage[];
  } catch {
    return null;
  }
}

function writeImageListCache(setId: string, images: DriveImage[]) {
  const payload = images.map((image) => ({ id: image.id, name: image.name }));
  localStorage.setItem(`${IMAGE_LIST_CACHE_PREFIX}${setId}`, JSON.stringify(payload));
  localStorage.setItem(`${IMAGE_LIST_CACHE_TIME_PREFIX}${setId}`, String(Date.now()));
}

function setTokenCookie(token: string | null) {
  if (!token) {
    document.cookie = 'poseviewer_token=; Path=/; Max-Age=0; SameSite=Lax';
    return;
  }
  document.cookie = `poseviewer_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
}

function createProxyThumbUrl(fileId: string, size: number) {
  return `/api/thumb/${encodeURIComponent(fileId)}?size=${size}`;
}

function createProxyMediaUrl(fileId: string) {
  return `/api/media/${encodeURIComponent(fileId)}`;
}

function ImageThumb({
  token,
  fileId,
  alt,
  size,
}: {
  token: string;
  fileId: string;
  alt: string;
  size: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  if (!fileId) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  if (!token) {
    return <div className="thumb thumb--empty">Connect to load</div>;
  }

  return (
    <div
      className="thumb"
      ref={containerRef}
      onMouseMove={(event) => {
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds) {
          return;
        }
        const y = event.clientY - bounds.top;
        const raw = y / bounds.height;
        const clamped = Math.min(1, Math.max(0, raw));
        const start = 0.2;
        const end = 0.8;
        let percent = 0;
        if (clamped <= start) {
          percent = 0;
        } else if (clamped >= end) {
          percent = 100;
        } else {
          percent = ((clamped - start) / (end - start)) * 100;
        }
        containerRef.current?.style.setProperty('--thumb-pos', `${percent}%`);
      }}
      onMouseLeave={() => {
        containerRef.current?.style.setProperty('--thumb-pos', '50%');
      }}
    >
      <img src={createProxyThumbUrl(fileId, size)} alt={alt} loading="lazy" decoding="async" />
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [previewImages, setPreviewImages] = useState<DriveImage[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE);
  const [allImages, setAllImages] = useState<DriveImage[]>([]);
  const [isLoadingAllImages, setIsLoadingAllImages] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [modalImageId, setModalImageId] = useState<string | null>(null);
  const [isModalLoaded, setIsModalLoaded] = useState(false);

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

  useEffect(() => {
    setTokenCookie(token);
  }, [token]);

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
      const images = await listImagesRecursive(token, selectedFolder.id);
      const thumbnailFileId = images[0]?.id;
      const next = createPoseSet({
        name: setName.trim() || selectedFolder.name,
        rootFolderId: selectedFolder.id,
        rootPath: selectedFolder.path,
        tags: normalizeTags(setTags),
        thumbnailFileId,
        imageCount: images.length,
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

    if (activeSet?.id === setId) {
      setActiveSet((current) => (current ? { ...current, ...update } : current));
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

  const handleSetThumbnail = async (setId: string, fileId: string) => {
    await handleUpdateSet(setId, { thumbnailFileId: fileId });
  };

  const loadSetImages = async (set: PoseSet, limit: number, append = false) => {
    if (!token) {
      return;
    }
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoadingImages(true);
    }
    setError('');

    try {
      const cached = readImageListCache(set.id);
      if (cached && cached.length >= limit) {
        const slice = cached.slice(0, limit);
        if (append) {
          setActiveImages((current) => {
            const merged = [...current];
            const existing = new Set(current.map((item) => item.id));
            for (const image of slice) {
              if (!existing.has(image.id)) {
                merged.push(image);
              }
            }
            return merged;
          });
        } else {
          setActiveImages(slice);
        }
        return;
      }

      const images = await listImagesRecursive(token, set.rootFolderId, limit);
      writeImageListCache(set.id, images);
      if (append) {
        setActiveImages((current) => {
          const merged = [...current];
          const existing = new Set(current.map((item) => item.id));
          for (const image of images) {
            if (!existing.has(image.id)) {
              merged.push(image);
            }
          }
          return merged;
        });
      } else {
        setActiveImages(images);
      }
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoadingImages(false);
      }
    }
  };

  const loadAllImages = async (set: PoseSet) => {
    if (!token) {
      return;
    }
    const cached = readImageListCache(set.id);
    if (cached) {
      setAllImages(cached);
      return;
    }
    setIsLoadingAllImages(true);
    try {
      const images = await listImagesRecursive(token, set.rootFolderId);
      setAllImages(images);
      writeImageListCache(set.id, images);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingAllImages(false);
    }
  };

  const handleOpenSet = async (set: PoseSet) => {
    setActiveSet(set);
    setImageLimit(IMAGE_PAGE_SIZE);
    setAllImages([]);
    await loadSetImages(set, IMAGE_PAGE_SIZE);
    void loadAllImages(set);
  };

  const handleLoadMoreImages = async () => {
    if (!activeSet) {
      return;
    }
    const nextLimit = imageLimit + IMAGE_PAGE_SIZE;
    setImageLimit(nextLimit);
    await loadSetImages(activeSet, nextLimit, true);
  };

  const isConnected = Boolean(token);
  const modalList = allImages.length > 0 ? allImages : activeImages;
  const modalImage =
    modalIndex !== null && modalIndex >= 0 && modalIndex < modalList.length
      ? modalList[modalIndex]
      : null;

  const openModal = (index: number) => {
    const image = activeImages[index];
    setModalImageId(image?.id ?? null);
    setModalIndex(index);
    setIsModalLoaded(false);
  };

  const closeModal = () => {
    setModalIndex(null);
    setModalImageId(null);
    setIsModalLoaded(false);
  };

  const goNextImage = () => {
    setModalIndex((current) => {
      if (current === null || modalList.length === 0) {
        return current;
      }
      return (current + 1) % modalList.length;
    });
    setIsModalLoaded(false);
  };

  const goPrevImage = () => {
    setModalIndex((current) => {
      if (current === null || modalList.length === 0) {
        return current;
      }
      return (current - 1 + modalList.length) % modalList.length;
    });
    setIsModalLoaded(false);
  };

  useEffect(() => {
    if (modalIndex === null) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
      }
      if (event.key === 'ArrowRight') {
        goNextImage();
      }
      if (event.key === 'ArrowLeft') {
        goPrevImage();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [modalIndex, modalList.length]);

  useEffect(() => {
    if (!modalImageId || allImages.length === 0) {
      return;
    }
    const nextIndex = allImages.findIndex((image) => image.id === modalImageId);
    if (nextIndex >= 0) {
      setModalIndex(nextIndex);
    }
  }, [allImages, modalImageId]);

  useEffect(() => {
    if (modalIndex === null) {
      return;
    }
    const image = modalList[modalIndex];
    if (image?.id && image.id !== modalImageId) {
      setModalImageId(image.id);
    }
  }, [modalIndex, modalList, modalImageId]);


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
                          size={PREVIEW_SIZE}
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
                      size={OVERVIEW_SIZE}
                    />
                  ) : (
                    <div className="thumb thumb--empty">No thumbnail</div>
                  )
                ) : null}
                <div className="card-body">
                  <p className="muted">{set.name}</p>
                  <div className="tag-row">
                    {set.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                    {set.tags.length === 0 ? <span className="tag ghost">No tags</span> : null}
                    {typeof set.imageCount === 'number' ? (
                      <span className="tag ghost">{set.imageCount} images</span>
                    ) : null}
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
          <p>{activeSet ? 'Edit metadata and preview images.' : 'Open a set to preview its images.'}</p>
        </div>
        <div className="panel-body">
          {activeSet ? (
            <div className="stack">
              <div className="viewer-header">
                <div>
                  <h3>{activeSet.name}</h3>
                  <p className="muted">
                    {typeof activeSet.imageCount === 'number'
                      ? `${activeSet.imageCount} images`
                      : `${activeImages.length} loaded`}
                  </p>
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
              <div className="stack">
                {isLoadingImages ? <p className="empty">Loading images…</p> : null}
                <div className="image-grid image-grid--zoom">
                  {activeImages.map((image, index) => (
                    <div key={image.id} className="image-tile">
                      <button
                        type="button"
                        className="image-button"
                        onClick={() => openModal(index)}
                      >
                        <ImageThumb
                          token={token ?? ''}
                          fileId={image.id}
                          alt={activeSet.name}
                          size={VIEWER_SIZE}
                        />
                      </button>
                      <button
                        type="button"
                        className={`thumb-action ${
                          activeSet.thumbnailFileId === image.id ? 'is-active' : ''
                        }`}
                        onClick={() => handleSetThumbnail(activeSet.id, image.id)}
                        disabled={isSaving || activeSet.thumbnailFileId === image.id}
                        aria-label="Use as thumbnail"
                      >
                        <IconPhotoStar size={16} />
                      </button>
                    </div>
                  ))}
                  {!isLoadingImages && activeImages.length === 0 ? (
                    <p className="empty">No images found in this set.</p>
                  ) : null}
                </div>
                {activeImages.length > 0 ? (
                  <button
                    className="ghost load-more"
                    onClick={handleLoadMoreImages}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? 'Loading more…' : 'Load more images'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="empty">Select a set above to view images.</p>
          )}
        </div>
      </section>
      {modalImage ? (
        <div className="modal" onClick={closeModal}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={closeModal}>
              Close
            </button>
            <img
              className="modal-thumb"
              src={createProxyThumbUrl(modalImage.id, VIEWER_SIZE)}
              alt={modalImage.name}
            />
            <img
              className={`modal-full ${isModalLoaded ? 'is-loaded' : ''}`}
              src={createProxyMediaUrl(modalImage.id)}
              alt={modalImage.name}
              onLoad={() => setIsModalLoaded(true)}
            />
            <div className="modal-hint">Use ← → to navigate</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
