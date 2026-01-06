import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconHeart, IconHeartFilled, IconLoader2, IconPhotoStar } from '@tabler/icons-react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { listFolderPaths, listImagesRecursive, type FolderPath } from './drive/scan';
import {
  buildSetIndex,
  findSetIndexFileId,
  indexItemsToImages,
  loadSetIndex,
  saveSetIndex,
} from './drive/index';
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
const IMAGE_PAGE_SIZE = 60;
const THUMB_SIZE = 320;
const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_KEY = 'poseviewer-metadata-cache';
const METADATA_CACHE_TIME_KEY = 'poseviewer-metadata-cache-ts';
const METADATA_CACHE_ROOT_KEY = 'poseviewer-metadata-root';
const IMAGE_LIST_CACHE_TTL = 24 * 60 * 60 * 1000;
const IMAGE_LIST_CACHE_PREFIX = 'poseviewer-set-images:v2:';
const IMAGE_LIST_CACHE_TIME_PREFIX = 'poseviewer-set-images-ts:v2:';

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

function filterFavorites(images: DriveImage[], favoriteIds: string[]) {
  if (favoriteIds.length === 0) {
    return [];
  }
  const favorites = new Set(favoriteIds);
  return images.filter((image) => favorites.has(image.id));
}

function readMetadataCache(rootId: string, options?: { allowStale?: boolean }) {
  const cacheRoot = localStorage.getItem(METADATA_CACHE_ROOT_KEY);
  const cacheTs = localStorage.getItem(METADATA_CACHE_TIME_KEY);
  const cacheData = localStorage.getItem(METADATA_CACHE_KEY);
  if (!cacheRoot || !cacheTs || !cacheData) {
    return null;
  }
  if (cacheRoot !== rootId) {
    return null;
  }
  if (!options?.allowStale) {
    const timestamp = Number(cacheTs);
    if (Number.isNaN(timestamp) || Date.now() - timestamp > METADATA_CACHE_TTL) {
      return null;
    }
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
  const [folderPaths, setFolderPaths] = useLocalStorage<FolderPath[]>(
    'poseviewer-folder-paths',
    emptyFolders
  );
  const [metadata, setMetadata] = useState<MetadataDocument>(emptyMetadata());
  const [metadataFileId, setMetadataFileId] = useState<string | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [scanPath, setScanPath] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [folderFilter, setFolderFilter] = useState('');
  const [hiddenFolders, setHiddenFolders] = useLocalStorage<
    Array<{ id: string; path: string }>
  >(
    'poseviewer-hidden-folders',
    []
  );
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [setFilter, setSetFilter] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderPath | null>(null);
  const [setName, setSetName] = useState('');
  const [setTags, setSetTags] = useState('');
  const [activeSet, setActiveSet] = useState<PoseSet | null>(null);
  const [activeImages, setActiveImages] = useState<DriveImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [previewImages, setPreviewImages] = useState<DriveImage[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [imageLoadStatus, setImageLoadStatus] = useState('');
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE);
  const [favoriteImages, setFavoriteImages] = useState<DriveImage[]>([]);
  const [isRefreshingSet, setIsRefreshingSet] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [modalImageId, setModalImageId] = useState<string | null>(null);
  const [modalItems, setModalItems] = useState<DriveImage[]>([]);
  const [modalContextLabel, setModalContextLabel] = useState('');
  const [isModalLoaded, setIsModalLoaded] = useState(false);
  const [modalPulse, setModalPulse] = useState(false);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });
  const modalPulseTimeout = useRef<number | null>(null);

  const filteredFolders = useMemo(() => {
    const query = folderFilter.trim().toLowerCase();
    const setPrefixes = metadata.sets.map((set) => set.rootPath);
    return folderPaths.filter((folder) => {
      if (hiddenFolders.some((hidden) => hidden.id === folder.id)) {
        return false;
      }
      if (
        setPrefixes.some(
          (prefix) => folder.path === prefix || folder.path.startsWith(`${prefix}/`)
        )
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      return folder.path.toLowerCase().includes(query);
    });
  }, [folderFilter, folderPaths, hiddenFolders, metadata.sets]);

  const filteredSets = useMemo(() => {
    const query = setFilter.trim().toLowerCase();
    const selected = selectedTags.map((tag) => tag.toLowerCase());
    const matches = metadata.sets.filter((set) => {
      const tagMatch =
        selected.length === 0 ||
        selected.every((tag) => set.tags.some((value) => value.toLowerCase() === tag));
      if (!tagMatch) {
        return false;
      }
      if (!query) {
        return true;
      }
      const combined = `${set.name} ${set.tags.join(' ')}`.toLowerCase();
      return combined.includes(query);
    });
    return [...matches].reverse();
  }, [metadata.sets, selectedTags, setFilter]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const set of metadata.sets) {
      for (const tag of set.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [metadata.sets]);

  const tagCounts = useMemo(() => {
    const query = setFilter.trim().toLowerCase();
    const selected = selectedTags.map((tag) => tag.toLowerCase());

    const matchesQuery = (set: PoseSet) => {
      if (!query) {
        return true;
      }
      const combined = `${set.name} ${set.tags.join(' ')}`.toLowerCase();
      return combined.includes(query);
    };

    const matchesSelected = (set: PoseSet, tags: string[]) =>
      tags.length === 0 ||
      tags.every((tag) => set.tags.some((value) => value.toLowerCase() === tag));

    const counts: Record<string, number> = {};
    const baseSet = metadata.sets.filter((set) => matchesQuery(set));

    for (const tag of availableTags) {
      const lower = tag.toLowerCase();
      const nextTags = selected.includes(lower)
        ? selected
        : [...selected, lower];
      counts[tag] = baseSet.filter((set) => matchesSelected(set, nextTags)).length;
    }
    return counts;
  }, [availableTags, metadata.sets, selectedTags, setFilter]);

  const sortedTags = useMemo(() => {
    return [...availableTags].sort((a, b) => {
      const diff = (tagCounts[b] ?? 0) - (tagCounts[a] ?? 0);
      if (diff !== 0) {
        return diff;
      }
      return a.localeCompare(b);
    });
  }, [availableTags, tagCounts]);

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
    setScanCount(0);
    setScanPath('');
    setError('');

    try {
      const meta = await loadMetadata(token, rootId);
      const excludeIds = new Set(meta.data.sets.map((set) => set.rootFolderId));
      const excludePaths = [
        ...meta.data.sets.map((set) => set.rootPath),
        ...hiddenFolders.map((folder) => folder.path),
      ];
      for (const hidden of hiddenFolders) {
        excludeIds.add(hidden.id);
      }
      const folders = await listFolderPaths(token, rootId, {
        excludeIds,
        excludePaths,
        maxCount: 50,
        onProgress: (count, path) => {
          setScanCount(count);
          setScanPath(path);
        },
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
  }, [hiddenFolders, rootId, token]);

  useEffect(() => {
    if (!rootId) {
      return;
    }

    const cached = readMetadataCache(rootId, { allowStale: !token });
    if (cached) {
      setMetadata(cached.data);
      setMetadataFileId(cached.fileId);
    }

    if (!token) {
      return;
    }

    if (!cached) {
      void handleFetchMetadata();
    }
  }, [handleFetchMetadata, rootId, token]);

  const handleSelectFolder = (folder: FolderPath) => {
    setSelectedFolder(folder);
    setSetName(folder.name);
    setSetTags('');
  };

  const handleAddTag = (tag: string) => {
    const current = normalizeTags(setTags);
    if (current.includes(tag)) {
      return;
    }
    const next = [...current, tag];
    setSetTags(next.join(', '));
  };

  const toggleFilterTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
    );
  };

  const clearSetFilters = () => {
    setSelectedTags([]);
    setSetFilter('');
  };

  const toggleFavoriteImage = async (setId: string, imageId: string) => {
    const set = metadata.sets.find((item) => item.id === setId);
    if (!set) {
      return;
    }
    const current = set.favoriteImageIds ?? [];
    const next = current.includes(imageId)
      ? current.filter((id) => id !== imageId)
      : [...current, imageId];
    const cached = readImageListCache(setId);
    const source = cached ?? activeImages;
    setFavoriteImages(filterFavorites(source, next));
    await handleUpdateSet(setId, { favoriteImageIds: next });
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
        const index = await loadSetIndex(token, selectedFolder.id);
        const images = index
          ? indexItemsToImages(index.data.items)
          : indexItemsToImages(await buildSetIndex(token, selectedFolder.id));
        const sample = pickRandom(images, 8);
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
      const indexItems = images.map((image) => ({ id: image.id, name: image.name }));
      await saveSetIndex(token, selectedFolder.id, null, indexItems);
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
      setImageLoadStatus('Images: loading');
    }
    setError('');

    try {
      const cached = readImageListCache(set.id);
      const favoriteIds = set.favoriteImageIds ?? [];
      if (cached && cached.length >= limit) {
        if (favoriteIds.length > 0) {
          const cachedIds = new Set(cached.map((image) => image.id));
          const missingFavorite = favoriteIds.some((id) => !cachedIds.has(id));
          if (missingFavorite) {
            // Fall through to index load to ensure favorites are included.
          } else {
            setImageLoadStatus('Images: using local cache');
            setFavoriteImages(filterFavorites(cached, favoriteIds));
            setActiveImages(cached.slice(0, limit));
            return;
          }
        } else {
          setImageLoadStatus('Images: using local cache');
          setFavoriteImages([]);
          setActiveImages(cached.slice(0, limit));
          return;
        }
      }

      const index = await loadSetIndex(token, set.rootFolderId);
      if (index) {
        setImageLoadStatus('Images: using Drive index');
        const images = indexItemsToImages(index.data.items);
        writeImageListCache(set.id, images);
        setFavoriteImages(filterFavorites(images, favoriteIds));
        setActiveImages(images.slice(0, limit));
        return;
      }

      setImageLoadStatus('Images: building Drive index (first time)');
      const items = await buildSetIndex(token, set.rootFolderId);
      const images = indexItemsToImages(items);
      const existingIndexId = await findSetIndexFileId(token, set.rootFolderId);
      await saveSetIndex(token, set.rootFolderId, existingIndexId, items);
      writeImageListCache(set.id, images);
      setFavoriteImages(filterFavorites(images, favoriteIds));
      setActiveImages(images.slice(0, limit));
    } catch (loadError) {
      setError((loadError as Error).message);
      setImageLoadStatus('');
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoadingImages(false);
      }
    }
  };

  const handleOpenSet = async (set: PoseSet) => {
    setActiveSet(set);
    setImageLimit(IMAGE_PAGE_SIZE);
    setActiveImages([]);
    setFavoriteImages([]);
    setImageLoadStatus('');
    await loadSetImages(set, IMAGE_PAGE_SIZE);
  };

  const handleRefreshSet = async (set: PoseSet) => {
    if (!token || !rootId) {
      return;
    }
    setIsRefreshingSet(true);
    try {
      const existingIndexId = await findSetIndexFileId(token, set.rootFolderId);
      const items = await buildSetIndex(token, set.rootFolderId);
      const refreshed = indexItemsToImages(items);
      await saveSetIndex(token, set.rootFolderId, existingIndexId, items);
      writeImageListCache(set.id, refreshed);
      const updatedSet = { ...set, imageCount: refreshed.length };
      await handleUpdateSet(set.id, { imageCount: refreshed.length });
      setActiveSet(updatedSet);
      setFavoriteImages(filterFavorites(refreshed, updatedSet.favoriteImageIds ?? []));
      setActiveImages(refreshed.slice(0, imageLimit));
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setIsRefreshingSet(false);
    }
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
  const favoriteIds = activeSet?.favoriteImageIds ?? [];
  const modalImage =
    modalIndex !== null && modalIndex >= 0 && modalIndex < modalItems.length
      ? modalItems[modalIndex]
      : null;
  const totalImages =
    activeSet?.imageCount ?? activeImages.length;
  const pendingExtra = Math.max(0, Math.min(IMAGE_PAGE_SIZE, totalImages - activeImages.length));

  const openModal = (imageId: string, items: DriveImage[], label: string) => {
    const index = items.findIndex((image) => image.id === imageId);
    setModalItems(items);
    setModalContextLabel(label);
    setModalImageId(imageId);
    setModalIndex(index >= 0 ? index : null);
    setIsModalLoaded(false);
    triggerModalPulse();
  };

  const closeModal = () => {
    setModalIndex(null);
    setModalImageId(null);
    setModalItems([]);
    setModalContextLabel('');
    setIsModalLoaded(false);
    setModalPulse(false);
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
    if (modalPulseTimeout.current) {
      window.clearTimeout(modalPulseTimeout.current);
      modalPulseTimeout.current = null;
    }
  };

  const triggerModalPulse = () => {
    setModalPulse(false);
    if (modalPulseTimeout.current) {
      window.clearTimeout(modalPulseTimeout.current);
    }
    modalPulseTimeout.current = window.setTimeout(() => {
      setModalPulse(true);
      modalPulseTimeout.current = window.setTimeout(() => {
        setModalPulse(false);
      }, 220);
    }, 10);
  };

  const goNextImage = () => {
    if (modalItems.length === 0) {
      return;
    }
    const currentId = modalImageId;
    const currentIndex = currentId
      ? modalItems.findIndex((image) => image.id === currentId)
      : modalIndex;
    if (currentIndex === null || currentIndex === -1) {
      return;
    }
    const isLast = currentIndex + 1 >= modalItems.length;
    if (isLast) {
      return;
    }
    const nextIndex = currentIndex + 1;
    const nextImage = modalItems[nextIndex];
    if (!nextImage) {
      return;
    }
    setModalImageId(nextImage.id);
    setModalIndex(nextIndex);
    setIsModalLoaded(false);
    triggerModalPulse();
  };

  const goPrevImage = () => {
    if (modalItems.length === 0) {
      return;
    }
    const currentId = modalImageId;
    const currentIndex = currentId
      ? modalItems.findIndex((image) => image.id === currentId)
      : modalIndex;
    if (currentIndex === null || currentIndex === -1) {
      return;
    }
    const isFirst = currentIndex - 1 < 0;
    if (isFirst) {
      return;
    }
    const nextIndex = currentIndex - 1;
    const nextImage = modalItems[nextIndex];
    if (!nextImage) {
      return;
    }
    setModalImageId(nextImage.id);
    setModalIndex(nextIndex);
    setIsModalLoaded(false);
    triggerModalPulse();
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
  }, [modalIndex, modalItems, modalImageId]);

  useEffect(() => {
    return () => {
      if (modalPulseTimeout.current) {
        window.clearTimeout(modalPulseTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (modalImageId) {
      setModalZoom(1);
      setModalPan({ x: 0, y: 0 });
    }
  }, [modalImageId]);

  const handleModalWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(4, Math.max(1, modalZoom * zoomFactor));
    if (nextZoom === modalZoom) {
      return;
    }

    if (nextZoom === 1) {
      setModalZoom(1);
      setModalPan({ x: 0, y: 0 });
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pointerX = event.clientX - centerX;
    const pointerY = event.clientY - centerY;
    const worldX = (pointerX - modalPan.x) / modalZoom;
    const worldY = (pointerY - modalPan.y) / modalZoom;
    const nextPanX = pointerX - worldX * nextZoom;
    const nextPanY = pointerY - worldY * nextZoom;

    setModalZoom(nextZoom);
    setModalPan({ x: nextPanX, y: nextPanY });
  };

  const handleModalPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || modalZoom <= 1) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    isPanningRef.current = true;
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: modalPan.x,
      originY: modalPan.y,
    };
  };

  const handleModalPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) {
      return;
    }
    const deltaX = event.clientX - panStartRef.current.x;
    const deltaY = event.clientY - panStartRef.current.y;
    setModalPan({
      x: panStartRef.current.originX + deltaX,
      y: panStartRef.current.originY + deltaY,
    });
  };

  const handleModalPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    isPanningRef.current = false;
  };


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
          <div className="panel-body panel-body--overlay">
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
              <button
                className="ghost"
                type="button"
                onClick={() => setShowHiddenFolders((value) => !value)}
              >
                {showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
              </button>
            ) : null}
            {showHiddenFolders && hiddenFolders.length > 0 ? (
              <div className="hidden-list">
                {hiddenFolders.map((folder) => (
                  <div key={folder.id} className="hidden-pill">
                    <span>{folder.path}</span>
                    <button className="pill-button" onClick={() => handleShowFolder(folder.id)}>
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
                {availableTags.length > 0 ? (
                  <div className="tag-suggestions">
                    <p className="muted">Quick tags</p>
                    <div className="tag-row">
                      {availableTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="tag-button"
                          onClick={() => handleAddTag(tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="preview">
                  <p className="muted">Preview sample</p>
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
                          size={THUMB_SIZE}
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
          {sortedTags.length > 0 ? (
            <div className="tag-suggestions">
              <div className="tag-filter-header">
                <p className="muted">Filter tags</p>
                <button
                  type="button"
                  className="ghost tag-filter-clear"
                  onClick={clearSetFilters}
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
                      onClick={() => toggleFilterTag(tag)}
                    >
                      {tag} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
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
                      size={THUMB_SIZE}
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
                  </div>
                  <div className="tag-row tag-row--meta">
                    {typeof set.imageCount === 'number' ? (
                      <span className="tag ghost">{set.imageCount} images</span>
                    ) : null}
                    <span className="tag ghost">
                      {(set.favoriteImageIds ?? []).length} favorites
                    </span>
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
        </div>
        <div className="panel-body">
          {activeSet ? (
            <div className="stack">
              <div className="viewer-header">
                <div>
                  <h3>{activeSet.name}</h3>
                  <p className="muted">
                    <a
                      className="link"
                      href={`https://drive.google.com/drive/folders/${activeSet.rootFolderId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {activeSet.rootPath}
                    </a>
                  </p>
                  <p className="muted">
                    {typeof activeSet.imageCount === 'number'
                      ? `${activeSet.imageCount} images`
                      : `${activeImages.length} loaded`}
                  </p>
                </div>
                <button
                  className="ghost"
                  onClick={() => handleRefreshSet(activeSet)}
                  disabled={isRefreshingSet}
                >
                  {isRefreshingSet ? 'Refreshing…' : 'Refresh data'}
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
                {isLoadingImages ? (
                  <p className="empty">
                    Loading images… {activeImages.length}/{totalImages} loaded
                  </p>
                ) : null}
                {imageLoadStatus ? <p className="muted">{imageLoadStatus}</p> : null}
                {favoriteImages.length > 0 ? (
                  <div className="stack">
                    <p className="muted">Favorites</p>
                    <div className="image-grid image-grid--zoom">
                      {favoriteImages.map((image) => (
                        <div key={image.id} className="image-tile">
                          <button
                            type="button"
                            className="image-button"
                          onClick={() => openModal(image.id, favoriteImages, 'Favorites')}
                          >
                            <ImageThumb
                              token={token ?? ''}
                              fileId={image.id}
                              alt={activeSet.name}
                              size={THUMB_SIZE}
                            />
                          </button>
                          <button
                            type="button"
                            className={`thumb-action thumb-action--favorite ${
                              favoriteIds.includes(image.id) ? 'is-active' : ''
                            }`}
                            onClick={() => toggleFavoriteImage(activeSet.id, image.id)}
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
                            onClick={() => handleSetThumbnail(activeSet.id, image.id)}
                            disabled={
                              isSaving || activeSet.thumbnailFileId === image.id
                            }
                            aria-label="Use as thumbnail"
                          >
                            <IconPhotoStar size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="image-grid image-grid--zoom">
                  {activeImages.map((image) => (
                    <div key={image.id} className="image-tile">
                      <button
                        type="button"
                        className="image-button"
                        onClick={() => openModal(image.id, activeImages, 'Set')}
                      >
                        <ImageThumb
                          token={token ?? ''}
                          fileId={image.id}
                          alt={activeSet.name}
                          size={THUMB_SIZE}
                        />
                      </button>
                      <button
                        type="button"
                        className={`thumb-action thumb-action--favorite ${
                          favoriteIds.includes(image.id) ? 'is-active' : ''
                        }`}
                        onClick={() => toggleFavoriteImage(activeSet.id, image.id)}
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
                    {isLoadingMore
                      ? `Loading... (+${pendingExtra}) • ${activeImages.length}/${totalImages}`
                      : `Load more images (+${pendingExtra}) • ${activeImages.length}/${totalImages}`}
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
          <div
            className="modal-content"
            onClick={(event) => event.stopPropagation()}
            onWheel={handleModalWheel}
            onPointerDown={handleModalPointerDown}
            onPointerMove={handleModalPointerMove}
            onPointerUp={handleModalPointerUp}
            onPointerCancel={handleModalPointerUp}
          >
            <button type="button" className="modal-close" onClick={closeModal}>
              Close
            </button>
            {activeSet ? (
              <button
                type="button"
                className={`modal-favorite ${
                  favoriteIds.includes(modalImage.id) ? 'is-active' : ''
                }`}
                onClick={() => toggleFavoriteImage(activeSet.id, modalImage.id)}
                aria-pressed={favoriteIds.includes(modalImage.id)}
                aria-label={
                  favoriteIds.includes(modalImage.id)
                    ? 'Remove from favorites'
                    : 'Add to favorites'
                }
              >
                {favoriteIds.includes(modalImage.id) ? (
                  <IconHeartFilled size={18} />
                ) : (
                  <IconHeart size={18} />
                )}
              </button>
            ) : null}
            <div
              className={`modal-media ${modalZoom > 1 ? 'is-zoomed' : ''}`}
              style={{
                transform: `translate(${modalPan.x}px, ${modalPan.y}px) scale(${modalZoom})`,
              }}
            >
              <img
                className="modal-thumb"
                src={createProxyThumbUrl(modalImage.id, THUMB_SIZE)}
                alt={modalImage.name}
              />
              <img
                className={`modal-full ${isModalLoaded ? 'is-loaded' : ''}`}
                src={createProxyMediaUrl(modalImage.id)}
                alt={modalImage.name}
                onLoad={() => setIsModalLoaded(true)}
              />
            </div>
            <div className={`modal-status ${!isModalLoaded ? 'is-visible' : ''}`}>
              <div className={`modal-status-inner ${modalPulse ? 'pulse' : ''}`}>
                <IconLoader2 size={20} />
                <span>Loading image</span>
              </div>
            </div>
            {modalContextLabel && modalIndex !== null ? (
              <div className="modal-counter">
                {modalContextLabel} {modalIndex + 1}/{modalItems.length}
              </div>
            ) : null}
            <div className="modal-hint">
              {modalZoom > 1 ? 'Drag to pan • ' : ''}
              Scroll to zoom • Use ← → to navigate
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
