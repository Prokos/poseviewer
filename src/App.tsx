import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowDown,
  IconArrowUp,
  IconDotsVertical,
  IconHeart,
  IconHeartFilled,
  IconLoader2,
  IconFolder,
  IconPhoto,
  IconPhotoStar,
} from '@tabler/icons-react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { listFolderPaths, listImagesRecursive, type FolderPath } from './drive/scan';
import {
  buildSetIndex,
  findSetIndexFileId,
  indexItemsToImages,
  loadSetIndex,
  loadSetIndexById,
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
const IMAGE_PAGE_SIZE = 96;
const THUMB_SIZE = 320;
const CARD_THUMB_SIZE = 500;
const VIEWER_THUMB_SIZE = CARD_THUMB_SIZE;
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

function shuffleItems<T>(items: T[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function formatIndexProgress(progress: { folders: number; images: number }) {
  return `Indexing… ${progress.folders} folders • ${progress.images} images`;
}

function formatDownloadProgress(progress: { loaded: number }) {
  const kb = progress.loaded / 1024;
  if (kb < 1024) {
    return `Loading index… ${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `Loading index… ${mb.toFixed(2)} MB`;
}

function startIndexTimer(setter: (value: string) => void) {
  const startedAt = Date.now();
  setter('Checking index… 0s');
  const id = window.setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    setter(`Checking index… ${seconds}s`);
  }, 1000);
  return () => window.clearInterval(id);
}

function parsePathState() {
  const raw = window.location.pathname;
  const path = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
  if (path === '/create') {
    return { page: 'create', setId: undefined };
  }
  if (path.startsWith('/set/')) {
    const setId = decodeURIComponent(path.slice('/set/'.length));
    if (setId) {
      return { page: 'set', setId };
    }
  }
  return { page: 'overview', setId: undefined };
}

function syncPathState(page: 'overview' | 'create' | 'set', setId?: string) {
  let next = '/';
  if (page === 'create') {
    next = '/create';
  } else if (page === 'set' && setId) {
    next = `/set/${encodeURIComponent(setId)}`;
  }
  window.history.replaceState(null, '', next);
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

function clearImageListCache() {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith(IMAGE_LIST_CACHE_PREFIX) || key.startsWith(IMAGE_LIST_CACHE_TIME_PREFIX))
    ) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

function writeImageListCache(setId: string, images: DriveImage[]) {
  const payload = images.map((image) => ({ id: image.id, name: image.name }));
  const dataKey = `${IMAGE_LIST_CACHE_PREFIX}${setId}`;
  const timeKey = `${IMAGE_LIST_CACHE_TIME_PREFIX}${setId}`;
  try {
    localStorage.setItem(dataKey, JSON.stringify(payload));
    localStorage.setItem(timeKey, String(Date.now()));
    return true;
  } catch {
    clearImageListCache();
    try {
      localStorage.setItem(dataKey, JSON.stringify(payload));
      localStorage.setItem(timeKey, String(Date.now()));
      return true;
    } catch {
      return false;
    }
  }
}

function createProxyThumbUrl(fileId: string, size: number) {
  return `/api/thumb/${encodeURIComponent(fileId)}?size=${size}`;
}

function createProxyMediaUrl(fileId: string) {
  return `/api/media/${encodeURIComponent(fileId)}`;
}

function ImageThumb({
  isConnected,
  fileId,
  alt,
  size,
}: {
  isConnected: boolean;
  fileId: string;
  alt: string;
  size: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  if (!fileId) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  if (!isConnected) {
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
  const [isConnected, setIsConnected] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<string>('');
  const rootId = DEFAULT_ROOT_ID ?? '';
  const [page, setPage] = useState<'overview' | 'create' | 'set'>('overview');
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
  const [toasts, setToasts] = useState<Array<{ id: string; message: string }>>([]);
  const lastToastRef = useRef<string | null>(null);
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
  const [setSort, setSetSort] = useState('favs_desc');
  const [selectedFolder, setSelectedFolder] = useState<FolderPath | null>(null);
  const [setName, setSetName] = useState('');
  const [setTags, setSetTags] = useState('');
  const [activeSet, setActiveSet] = useState<PoseSet | null>(null);
  const [activeImages, setActiveImages] = useState<DriveImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [setViewerTab, setSetViewerTab] = useState<'samples' | 'favorites' | 'all'>('samples');
  const [sampleColumns, setSampleColumns] = useState(1);
  const [allColumns, setAllColumns] = useState(1);
  const [previewImages, setPreviewImages] = useState<DriveImage[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewIndexProgress, setPreviewIndexProgress] = useState('');
  const [sampleImages, setSampleImages] = useState<DriveImage[]>([]);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [imageLoadStatus, setImageLoadStatus] = useState('');
  const [viewerIndexProgress, setViewerIndexProgress] = useState('');
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE);
  const [favoriteImages, setFavoriteImages] = useState<DriveImage[]>([]);
  const [isRefreshingSet, setIsRefreshingSet] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [modalImageId, setModalImageId] = useState<string | null>(null);
  const [modalItems, setModalItems] = useState<DriveImage[]>([]);
  const [modalContextLabel, setModalContextLabel] = useState('');
  const [modalIsLoading, setModalIsLoading] = useState(false);
  const [modalPulse, setModalPulse] = useState(false);
  const [modalFavoritePulse, setModalFavoritePulse] = useState<null | 'add' | 'remove'>(null);
  const [modalFullSrc, setModalFullSrc] = useState<string | null>(null);
  const [modalFullImageId, setModalFullImageId] = useState<string | null>(null);
  const [modalFullAnimate, setModalFullAnimate] = useState(false);
  const [modalZoom, setModalZoom] = useState(1);
  const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });
  const modalPendingAdvanceRef = useRef(false);
  const modalItemsLengthRef = useRef(0);
  const modalPulseTimeout = useRef<number | null>(null);
  const modalFavoritePulseTimeout = useRef<number | null>(null);
  const modalFullAbortRef = useRef<AbortController | null>(null);
  const modalFullUrlRef = useRef<string | null>(null);
  const modalPrefetchAbortRef = useRef<Map<string, AbortController>>(new Map());
  const modalPrefetchCacheRef = useRef<Map<string, string>>(new Map());
  const modalFullCacheRef = useRef<Map<string, string>>(new Map());
  const modalFullCacheMax = 6;
  const sampleGridRef = useRef<HTMLDivElement | null>(null);
  const allGridRef = useRef<HTMLDivElement | null>(null);
  const sampleHistoryRef = useRef<DriveImage[]>([]);
  const sampleHistorySetRef = useRef<string | null>(null);
  const sampleAppendInFlightRef = useRef(false);
  const metadataSaveTimeoutRef = useRef<number | null>(null);
  const pendingSavePromiseRef = useRef<Promise<void> | null>(null);
  const pendingSaveResolveRef = useRef<(() => void) | null>(null);
  const initialNavRef = useRef(parsePathState());
  const appliedNavRef = useRef(false);
  const metadataLoadedRef = useRef(false);
  const pendingSetIdRef = useRef<string | null>(null);
  const pendingSetFetchAttemptedRef = useRef(false);
  const setViewerRef = useRef<HTMLDivElement | null>(null);
  const sampleSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const prefetchedThumbsRef = useRef<Set<string>>(new Set());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchLastRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const oneHandZoomRef = useRef<{ startY: number; zoom: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const prebuiltIndexRef = useRef<{
    folderId: string;
    items: { id: string; name: string }[];
    fileId: string | null;
  } | null>(null);
  const viewerIndexTimerRef = useRef<(() => void) | null>(null);

  const samplePageSize = Math.max(1, Math.ceil(48 / sampleColumns) * sampleColumns);
  const allPageSize = Math.max(1, Math.ceil(IMAGE_PAGE_SIZE / allColumns) * allColumns);
  const metadataRef = useRef<MetadataDocument>(metadata);
  const metadataFileIdRef = useRef<string | null>(metadataFileId);
  const updateQueueRef = useRef(Promise.resolve());

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
    const sorted = [...matches];
    switch (setSort) {
      case 'added_asc':
        break;
      case 'images_asc':
        sorted.sort((a, b) => (a.imageCount ?? 0) - (b.imageCount ?? 0));
        break;
      case 'images_desc':
        sorted.sort((a, b) => (b.imageCount ?? 0) - (a.imageCount ?? 0));
        break;
      case 'favs_asc':
        sorted.sort(
          (a, b) =>
            (a.favoriteImageIds?.length ?? 0) - (b.favoriteImageIds?.length ?? 0)
        );
        break;
      case 'favs_desc':
        sorted.sort(
          (a, b) =>
            (b.favoriteImageIds?.length ?? 0) - (a.favoriteImageIds?.length ?? 0)
        );
        break;
      case 'added_desc':
      default:
        sorted.reverse();
        break;
    }
    return sorted;
  }, [metadata.sets, selectedTags, setFilter, setSort]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const set of metadata.sets) {
      for (const tag of set.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [metadata.sets]);

  const tagUsageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const set of metadata.sets) {
      for (const tag of set.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  }, [metadata.sets]);

  const sortedQuickTags = useMemo(() => {
    return [...availableTags].sort((a, b) => {
      const diff = (tagUsageCounts[b] ?? 0) - (tagUsageCounts[a] ?? 0);
      if (diff !== 0) {
        return diff;
      }
      return a.localeCompare(b);
    });
  }, [availableTags, tagUsageCounts]);

  const selectedCreateTags = useMemo(() => normalizeTags(setTags), [setTags]);

  const viewerQuickTags = useMemo(() => {
    if (!activeSet) {
      return { active: [] as string[], inactive: [] as string[] };
    }
    const activeLower = new Set(activeSet.tags.map((tag) => tag.toLowerCase()));
    const active = sortedQuickTags.filter((tag) => activeLower.has(tag.toLowerCase()));
    const inactive = sortedQuickTags.filter((tag) => !activeLower.has(tag.toLowerCase()));
    return { active, inactive };
  }, [activeSet, sortedQuickTags]);

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
    if (!error || error === lastToastRef.current) {
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    lastToastRef.current = error;
    setToasts((current) => [...current, { id, message: error }]);
    const timeout = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      if (lastToastRef.current === error) {
        lastToastRef.current = null;
      }
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const checkAuthStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (!response.ok) {
        throw new Error(`Auth status failed: ${response.status}`);
      }
      const data = (await response.json()) as { connected?: boolean };
      const connected = Boolean(data.connected);
      setIsConnected(connected);
      setTokenStatus(connected ? 'Connected.' : '');
    } catch (statusError) {
      setError((statusError as Error).message);
    }
  }, []);

  const handleConnect = useCallback(() => {
    window.open('/api/auth/start', '_blank', 'noopener');
    setTokenStatus('Complete sign-in in the new window.');
    window.setTimeout(() => {
      void checkAuthStatus();
    }, 1500);
  }, [checkAuthStatus]);

  useEffect(() => {
    void checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    const handleFocus = () => {
      void checkAuthStatus();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkAuthStatus]);

  const handleFetchMetadata = useCallback(async () => {
    if (!isConnected || !rootId) {
      return;
    }
    setIsLoadingMetadata(true);
    setError('');

    try {
      const meta = await loadMetadata(rootId);

      setMetadata(meta.data);
      setMetadataFileId(meta.fileId);
      metadataLoadedRef.current = true;
      writeMetadataCache(rootId, meta.fileId, meta.data);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingMetadata(false);
    }
  }, [isConnected, rootId]);

  const handleScan = useCallback(async () => {
    if (!isConnected || !rootId) {
      return;
    }

    setIsScanning(true);
    setScanCount(0);
    setScanPath('');
    setError('');

    try {
      const meta = await loadMetadata(rootId);
      const excludeIds = new Set(meta.data.sets.map((set) => set.rootFolderId));
      const excludePaths = meta.data.sets.map((set) => set.rootPath);
      const ignoreIds = new Set(hiddenFolders.map((folder) => folder.id));
      const ignorePaths = hiddenFolders.map((folder) => folder.path);
      const folders = await listFolderPaths(rootId, {
        excludeIds,
        excludePaths,
        ignoreIds,
        ignorePaths,
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
  }, [hiddenFolders, isConnected, rootId]);

  useEffect(() => {
    if (!rootId) {
      return;
    }

    const cached = readMetadataCache(rootId, { allowStale: !isConnected });
    if (cached) {
      setMetadata(cached.data);
      setMetadataFileId(cached.fileId);
      metadataLoadedRef.current = true;
    }

    if (!isConnected) {
      return;
    }

    if (!cached) {
      void handleFetchMetadata();
    }
  }, [handleFetchMetadata, isConnected, rootId]);

  useEffect(() => {
    if (activeSet) {
      setSetViewerTab('samples');
    }
  }, [activeSet?.id]);

  useEffect(() => {
    if (setViewerTab !== 'all' || !activeSet || isLoadingImages || isLoadingMore) {
      return;
    }
    if (allColumns <= 1 || activeImages.length === 0) {
      return;
    }
    const remainder = activeImages.length % allColumns;
    if (remainder === 0) {
      return;
    }
    const fill = allColumns - remainder;
    const maxAvailable = activeSet.imageCount ?? readImageListCache(activeSet.id)?.length ?? Infinity;
    if (!Number.isFinite(maxAvailable) || activeImages.length >= maxAvailable) {
      return;
    }
    const nextLimit = Math.min(activeImages.length + fill, maxAvailable);
    void loadSetImages(activeSet, nextLimit, true);
  }, [
    activeImages.length,
    activeSet,
    allColumns,
    isLoadingImages,
    isLoadingMore,
    setViewerTab,
  ]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    metadataFileIdRef.current = metadataFileId;
  }, [metadataFileId]);

  useEffect(() => {
    const readColumns = (element: HTMLDivElement | null) => {
      if (!element) {
        return 1;
      }
      const value = window.getComputedStyle(element).gridTemplateColumns;
      if (!value || value === 'none') {
        return 1;
      }
      const count = value.split(' ').filter(Boolean).length;
      return Math.max(1, count);
    };
    const updateSample = () => setSampleColumns(readColumns(sampleGridRef.current));
    const updateAll = () => setAllColumns(readColumns(allGridRef.current));
    updateSample();
    updateAll();
    const observer = new ResizeObserver(() => {
      updateSample();
      updateAll();
    });
    if (sampleGridRef.current) {
      observer.observe(sampleGridRef.current);
    }
    if (allGridRef.current) {
      observer.observe(allGridRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const handleSelectFolder = (folder: FolderPath) => {
    setSelectedFolder(folder);
    setSetName(folder.name);
    setSetTags('');
  };

  const toggleCreateTag = (tag: string) => {
    const current = normalizeTags(setTags);
    if (current.includes(tag)) {
      const next = current.filter((value) => value !== tag);
      setSetTags(next.join(', '));
      return;
    }
    setSetTags([...current, tag].join(', '));
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
    if (!isConnected || !selectedFolder) {
      setPreviewImages([]);
      return;
    }

    let isActive = true;
    setIsLoadingPreview(true);
    setPreviewCount(null);

    const loadPreview = async () => {
      try {
        setPreviewIndexProgress('Indexing…');
        const items = await buildSetIndex(selectedFolder.id, (progress) => {
          setPreviewIndexProgress(formatIndexProgress(progress));
        });
        const existingIndexId = await findSetIndexFileId(selectedFolder.id);
        const indexFileId = await saveSetIndex(selectedFolder.id, existingIndexId, items);
        prebuiltIndexRef.current = { folderId: selectedFolder.id, items, fileId: indexFileId };
        const images = indexItemsToImages(items);
        const sample = pickRandom(images, 8);
        if (isActive) {
          setPreviewImages(sample);
          setPreviewCount(images.length);
          setPreviewIndexProgress('');
        }
      } catch (previewError) {
        if (isActive) {
          setError((previewError as Error).message);
        }
      } finally {
        if (isActive) {
          setIsLoadingPreview(false);
          setPreviewIndexProgress('');
        }
      }
    };

    void loadPreview();

    return () => {
      isActive = false;
    };
  }, [isConnected, selectedFolder]);

  const handleRefreshPreview = useCallback(async () => {
    if (!isConnected || !selectedFolder) {
      return;
    }
    setIsLoadingPreview(true);
    setPreviewCount(null);
    setPreviewIndexProgress('Indexing…');
    setError('');
    try {
      const items = await buildSetIndex(selectedFolder.id, (progress) => {
        setPreviewIndexProgress(formatIndexProgress(progress));
      });
      const existingIndexId = await findSetIndexFileId(selectedFolder.id);
      const indexFileId = await saveSetIndex(selectedFolder.id, existingIndexId, items);
      prebuiltIndexRef.current = { folderId: selectedFolder.id, items, fileId: indexFileId };
      const images = indexItemsToImages(items);
      setPreviewImages(pickRandom(images, 8));
      setPreviewCount(images.length);
    } catch (previewError) {
      setError((previewError as Error).message);
    } finally {
      setIsLoadingPreview(false);
      setPreviewIndexProgress('');
    }
  }, [isConnected, selectedFolder]);

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
    if (!isConnected || !rootId || !selectedFolder) {
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      let indexItems = prebuiltIndexRef.current?.folderId === selectedFolder.id
        ? prebuiltIndexRef.current.items
        : null;
      let indexFileId =
        prebuiltIndexRef.current?.folderId === selectedFolder.id
          ? prebuiltIndexRef.current.fileId
          : null;
      if (!indexItems) {
        setPreviewIndexProgress('Indexing…');
        indexItems = await buildSetIndex(selectedFolder.id, (progress) => {
          setPreviewIndexProgress(formatIndexProgress(progress));
        });
      }
      if (!indexFileId) {
        const existingIndexId = await findSetIndexFileId(selectedFolder.id);
        indexFileId = await saveSetIndex(selectedFolder.id, existingIndexId, indexItems);
      }
      prebuiltIndexRef.current = {
        folderId: selectedFolder.id,
        items: indexItems,
        fileId: indexFileId,
      };
      const images = indexItemsToImages(indexItems);
      const thumbnailFileId = images[0]?.id;
      const next = createPoseSet({
        name: setName.trim() || selectedFolder.name,
        rootFolderId: selectedFolder.id,
        rootPath: selectedFolder.path,
        tags: normalizeTags(setTags),
        thumbnailFileId,
        imageCount: images.length,
        indexFileId,
      });

      const updated: MetadataDocument = {
        version: 1,
        sets: [...metadata.sets, next],
      };

      const newFileId = await saveMetadata(rootId, metadataFileId, updated);
      setMetadataFileId(newFileId);
      setMetadata(updated);
      writeMetadataCache(rootId, newFileId, updated);
      await handleOpenSet(next);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSaving(false);
      setPreviewIndexProgress('');
    }
  };

  const handleUpdateSet = async (setId: string, update: Partial<PoseSet>) => {
    if (!isConnected || !rootId) {
      return;
    }

    if (activeSet?.id === setId) {
      setActiveSet((current) => (current ? { ...current, ...update } : current));
    }

    const base = metadataRef.current;
    const updated: MetadataDocument = {
      version: 1,
      sets: base.sets.map((set) => (set.id === setId ? { ...set, ...update } : set)),
    };

    metadataRef.current = updated;
    setMetadata(updated);

    if (!pendingSavePromiseRef.current) {
      pendingSavePromiseRef.current = new Promise<void>((resolve) => {
        pendingSaveResolveRef.current = resolve;
      });
    }

    if (metadataSaveTimeoutRef.current) {
      window.clearTimeout(metadataSaveTimeoutRef.current);
    }

    metadataSaveTimeoutRef.current = window.setTimeout(() => {
      metadataSaveTimeoutRef.current = null;
      updateQueueRef.current = updateQueueRef.current.then(async () => {
        setIsSaving(true);
        setError('');
        try {
          const newFileId = await saveMetadata(
            rootId,
            metadataFileIdRef.current,
            metadataRef.current
          );
          metadataFileIdRef.current = newFileId;
          setMetadataFileId(newFileId);
          writeMetadataCache(rootId, newFileId, metadataRef.current);
        } catch (saveError) {
          setError((saveError as Error).message);
        } finally {
          setIsSaving(false);
        }
      });

      updateQueueRef.current.finally(() => {
        pendingSaveResolveRef.current?.();
        pendingSaveResolveRef.current = null;
        pendingSavePromiseRef.current = null;
      });
    }, 350);

    return pendingSavePromiseRef.current;
  };

  const toggleActiveSetTag = useCallback(
    (tag: string) => {
      if (!activeSet) {
        return;
      }
      const current = activeSet.tags ?? [];
      const lower = tag.toLowerCase();
      const existingIndex = current.findIndex((value) => value.toLowerCase() === lower);
      const next =
        existingIndex >= 0
          ? current.filter((_, index) => index !== existingIndex)
          : [...current, tag];
      void handleUpdateSet(activeSet.id, { tags: next });
    },
    [activeSet, handleUpdateSet]
  );

  const pickNextSample = useCallback(
    (setId: string, images: DriveImage[], count: number) => {
      if (images.length === 0) {
        sampleSeenRef.current.set(setId, new Set());
        return [];
      }
      const seen = sampleSeenRef.current.get(setId) ?? new Set<string>();
      const availableIds = new Set(images.map((image) => image.id));
      for (const id of seen) {
        if (!availableIds.has(id)) {
          seen.delete(id);
        }
      }
      if (seen.size >= images.length) {
        seen.clear();
      }
      const unseen = images.filter((image) => !seen.has(image.id));
      const pool = unseen.length > 0 ? unseen : images;
      const sample = pickRandom(pool, Math.min(count, pool.length));
      for (const image of sample) {
        seen.add(image.id);
      }
      sampleSeenRef.current.set(setId, seen);
      return sample;
    },
    []
  );

  type IndexItems = Awaited<ReturnType<typeof buildSetIndex>>;

  const getPrebuiltIndexForSet = useCallback((set: PoseSet) => {
    return prebuiltIndexRef.current?.folderId === set.rootFolderId
      ? prebuiltIndexRef.current
      : null;
  }, []);

  const loadIndexItemsForSet = useCallback(
    async (
      set: PoseSet,
      buildIfMissing: boolean,
      onDownloadProgress?: (progress: { loaded: number }) => void,
      onIndexProgress?: (progress: { folders: number; images: number }) => void
    ): Promise<{ items: IndexItems; fileId: string | null; source: 'download' | 'build' } | null> => {
      const index = set.indexFileId
        ? await loadSetIndexById(set.indexFileId, onDownloadProgress)
        : await loadSetIndex(set.rootFolderId, onDownloadProgress);
      if (index) {
        return { items: index.data.items as IndexItems, fileId: index.fileId, source: 'download' };
      }
      if (!buildIfMissing) {
        return null;
      }
      if (onIndexProgress) {
        onIndexProgress({ folders: 0, images: 0 });
      }
      const items = await buildSetIndex(set.rootFolderId, onIndexProgress);
      const existingIndexId = await findSetIndexFileId(set.rootFolderId);
      const fileId = await saveSetIndex(set.rootFolderId, existingIndexId, items);
      return { items, fileId, source: 'build' };
    },
    []
  );

  const resolveSetImages = useCallback(
    async (set: PoseSet, buildIfMissing: boolean) => {
      if (!isConnected) {
        return [];
      }
      const prebuilt = getPrebuiltIndexForSet(set);
      const resolvedSet =
        !set.indexFileId && prebuilt?.fileId
          ? { ...set, indexFileId: prebuilt.fileId ?? undefined }
          : set;
      const cached = readImageListCache(set.id);
      if (cached) {
        return cached;
      }
      if (prebuilt?.items && prebuilt.items.length > 0) {
        const images = indexItemsToImages(prebuilt.items);
        if (!writeImageListCache(set.id, images)) {
          setError('Image cache full. Cleared cache and continued without saving.');
        }
        if (prebuilt.fileId && resolvedSet.indexFileId !== prebuilt.fileId) {
          await handleUpdateSet(set.id, { indexFileId: prebuilt.fileId });
        }
        return images;
      }
      if (viewerIndexTimerRef.current) {
        viewerIndexTimerRef.current();
        viewerIndexTimerRef.current = null;
      }
      const stopTimer = startIndexTimer(setViewerIndexProgress);
      viewerIndexTimerRef.current = stopTimer;
      const index = await loadIndexItemsForSet(
        resolvedSet,
        buildIfMissing,
        (progress) => {
          stopTimer();
          viewerIndexTimerRef.current = null;
          setViewerIndexProgress(formatDownloadProgress(progress));
        },
        (progress) => {
          setViewerIndexProgress(formatIndexProgress(progress));
        }
      );
      stopTimer();
      viewerIndexTimerRef.current = null;
      if (index) {
        const images = indexItemsToImages(index.items);
        if (!writeImageListCache(set.id, images)) {
          setError('Image cache full. Cleared cache and continued without saving.');
        }
        if (index.fileId && resolvedSet.indexFileId !== index.fileId) {
          await handleUpdateSet(set.id, { indexFileId: index.fileId });
        }
        return images;
      }
      return [];
    },
    [getPrebuiltIndexForSet, isConnected, loadIndexItemsForSet]
  );

  const hydrateSetExtras = useCallback(
    async (set: PoseSet, buildIfMissing: boolean) => {
      setIsLoadingSample(true);
      setViewerIndexProgress('Loading index…');
      try {
        const images = await resolveSetImages(set, buildIfMissing);
        setFavoriteImages(filterFavorites(images, set.favoriteImageIds ?? []));
        setSampleImages(pickNextSample(set.id, images, samplePageSize));
      } catch (loadError) {
        setError((loadError as Error).message);
        setFavoriteImages([]);
        setSampleImages([]);
      } finally {
        setIsLoadingSample(false);
        setViewerIndexProgress('');
      }
    },
    [pickNextSample, resolveSetImages, samplePageSize]
  );

  const hydratedSetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      hydratedSetIdRef.current = null;
      return;
    }
    if (!activeSet) {
      return;
    }
    if (hydratedSetIdRef.current === activeSet.id) {
      return;
    }
    hydratedSetIdRef.current = activeSet.id;
    void hydrateSetExtras(activeSet, true);
  }, [activeSet, hydrateSetExtras, isConnected]);

  const prefetchThumbs = useCallback((images: DriveImage[]) => {
    for (const image of images) {
      if (prefetchedThumbsRef.current.has(image.id)) {
        continue;
      }
      const preload = new Image();
      preload.src = createProxyThumbUrl(image.id, THUMB_SIZE);
      prefetchedThumbsRef.current.add(image.id);
    }
  }, []);

  const handleSetThumbnail = async (setId: string, fileId: string) => {
    await handleUpdateSet(setId, { thumbnailFileId: fileId });
  };

  const handleDeleteSet = async (setToDelete: PoseSet) => {
    if (!isConnected || !rootId) {
      return;
    }
    const confirmed = window.confirm(
      `Delete set "${setToDelete.name}"? This removes it from metadata but does not delete any Drive files.`
    );
    if (!confirmed) {
      return;
    }
    const updated: MetadataDocument = {
      version: 1,
      sets: metadata.sets.filter((set) => set.id !== setToDelete.id),
    };

    setIsSaving(true);
    setError('');
    try {
      const newFileId = await saveMetadata(rootId, metadataFileId, updated);
      setMetadataFileId(newFileId);
      setMetadata(updated);
      writeMetadataCache(rootId, newFileId, updated);
      if (activeSet?.id === setToDelete.id) {
        setActiveSet(null);
        setActiveImages([]);
        setFavoriteImages([]);
        setImageLoadStatus('');
        setPage('overview');
      }
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const loadSetImages = async (set: PoseSet, limit: number, append = false) => {
    if (!isConnected) {
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
      const prebuilt = getPrebuiltIndexForSet(set);
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
      if (prebuilt?.items && prebuilt.items.length > 0) {
        setImageLoadStatus('Images: using prebuilt index');
        const images = indexItemsToImages(prebuilt.items);
        if (!writeImageListCache(set.id, images)) {
          setError('Image cache full. Cleared cache and continued without saving.');
        }
        if (prebuilt.fileId && set.indexFileId !== prebuilt.fileId) {
          await handleUpdateSet(set.id, { indexFileId: prebuilt.fileId });
        }
        setFavoriteImages(filterFavorites(images, favoriteIds));
        setActiveImages(images.slice(0, limit));
        return;
      }

      if (viewerIndexTimerRef.current) {
        viewerIndexTimerRef.current();
        viewerIndexTimerRef.current = null;
      }
      const stopTimer = startIndexTimer(setViewerIndexProgress);
      viewerIndexTimerRef.current = stopTimer;
      const index = await loadIndexItemsForSet(
        set,
        true,
        (progress) => {
          stopTimer();
          viewerIndexTimerRef.current = null;
          setViewerIndexProgress(formatDownloadProgress(progress));
        },
        (progress) => {
          setViewerIndexProgress(formatIndexProgress(progress));
        }
      );
      stopTimer();
      viewerIndexTimerRef.current = null;
      if (index) {
        const images = indexItemsToImages(index.items);
        if (index.source === 'build') {
          setImageLoadStatus('Images: building Drive index (first time)');
        } else {
          setImageLoadStatus(
            set.indexFileId ? 'Images: using Drive index' : 'Images: using Drive index (found)'
          );
        }
        if (!writeImageListCache(set.id, images)) {
          setError('Image cache full. Cleared cache and continued without saving.');
        }
        if (index.fileId && set.indexFileId !== index.fileId) {
          await handleUpdateSet(set.id, { indexFileId: index.fileId });
        }
        setFavoriteImages(filterFavorites(images, favoriteIds));
        setActiveImages(images.slice(0, limit));
        return;
      }
    } catch (loadError) {
      setError((loadError as Error).message);
      setImageLoadStatus('');
    } finally {
      setViewerIndexProgress('');
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoadingImages(false);
      }
    }
  };

  const handleOpenSet = async (set: PoseSet) => {
    const nextSet =
      !set.indexFileId && prebuiltIndexRef.current?.folderId === set.rootFolderId
        ? { ...set, indexFileId: prebuiltIndexRef.current.fileId ?? undefined }
        : set;
    setActiveSet(nextSet);
    setPage('set');
    setImageLimit(0);
    setActiveImages([]);
    setFavoriteImages([]);
    setSampleImages([]);
    setImageLoadStatus('');
    if (!set.indexFileId && nextSet.indexFileId) {
      await handleUpdateSet(set.id, { indexFileId: nextSet.indexFileId });
    }
    await hydrateSetExtras(nextSet, true);
  };

  useEffect(() => {
    if (appliedNavRef.current) {
      return;
    }
    const initial = initialNavRef.current;
    if (initial.page === 'set' && initial.setId) {
      pendingSetIdRef.current = initial.setId;
      pendingSetFetchAttemptedRef.current = false;
      appliedNavRef.current = true;
      setPage('set');
      return;
    }
    appliedNavRef.current = true;
    setPage(initial.page);
  }, [handleOpenSet, isLoadingMetadata, metadata.sets]);

  useEffect(() => {
    const handlePop = () => {
      const next = parsePathState();
      if (next.page === 'set' && next.setId) {
        pendingSetIdRef.current = next.setId;
        pendingSetFetchAttemptedRef.current = false;
        setPage('set');
        return;
      }
      pendingSetIdRef.current = null;
      pendingSetFetchAttemptedRef.current = false;
      setPage(next.page);
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [handleOpenSet, metadata.sets]);

  useEffect(() => {
    if (!appliedNavRef.current) {
      return;
    }
    if (page === 'set') {
      if (!activeSet) {
        return;
      }
      syncPathState('set', activeSet.id);
      return;
    }
    syncPathState(page);
  }, [activeSet, page]);

  useEffect(() => {
    if (page !== 'set') {
      return;
    }
    const pendingId = pendingSetIdRef.current;
    if (!pendingId) {
      return;
    }
    if (activeSet?.id === pendingId) {
      pendingSetIdRef.current = null;
      return;
    }
    const match = metadata.sets.find((item) => item.id === pendingId);
    if (match) {
      pendingSetIdRef.current = null;
      void handleOpenSet(match);
      return;
    }
    if (!pendingSetFetchAttemptedRef.current && isConnected && !isLoadingMetadata) {
      pendingSetFetchAttemptedRef.current = true;
      void handleFetchMetadata();
      return;
    }
    if (
      pendingSetFetchAttemptedRef.current &&
      metadataLoadedRef.current &&
      !isLoadingMetadata
    ) {
      pendingSetIdRef.current = null;
      setPage('overview');
    }
  }, [
    activeSet?.id,
    handleFetchMetadata,
    handleOpenSet,
    isConnected,
    isLoadingMetadata,
    metadata.sets,
    page,
  ]);


  const handleRefreshSet = async (set: PoseSet) => {
    if (!isConnected || !rootId) {
      return;
    }
    setIsRefreshingSet(true);
    try {
      const existingIndexId = await findSetIndexFileId(set.rootFolderId);
      setViewerIndexProgress('Indexing…');
      const items = await buildSetIndex(set.rootFolderId, (progress) => {
        setViewerIndexProgress(formatIndexProgress(progress));
      });
      const refreshed = indexItemsToImages(items);
      const indexFileId = await saveSetIndex(set.rootFolderId, existingIndexId, items);
      if (!writeImageListCache(set.id, refreshed)) {
        setError('Image cache full. Cleared cache and continued without saving.');
      }
      const updatedSet = { ...set, imageCount: refreshed.length, indexFileId };
      await handleUpdateSet(set.id, {
        imageCount: refreshed.length,
        indexFileId,
      });
      setActiveSet(updatedSet);
      setFavoriteImages(filterFavorites(refreshed, updatedSet.favoriteImageIds ?? []));
      setSampleImages(pickNextSample(set.id, refreshed, samplePageSize));
      if (activeImages.length > 0) {
        setActiveImages(refreshed.slice(0, imageLimit));
      }
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setIsRefreshingSet(false);
      setViewerIndexProgress('');
    }
  };

  const loadSampleBatch = useCallback(
    async (count: number) => {
      if (!activeSet || !isConnected || count <= 0) {
        return;
      }
      setIsLoadingSample(true);
      setViewerIndexProgress('Loading sample…');
      try {
        const images = await resolveSetImages(activeSet, true);
        if (images.length === 0) {
          setSampleImages([]);
          return;
        }
        const nextSample = pickNextSample(activeSet.id, images, count);
        if (nextSample.length === 0) {
          return;
        }
        setSampleImages((current) => {
          const existingIds = new Set(current.map((item) => item.id));
          const merged = [...current];
          for (const item of nextSample) {
            if (!existingIds.has(item.id)) {
              merged.push(item);
            }
          }
          return merged;
        });
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsLoadingSample(false);
        setViewerIndexProgress('');
      }
    },
    [activeSet, isConnected, pickNextSample, resolveSetImages]
  );

  const handleLoadMoreSample = useCallback(async () => {
    await loadSampleBatch(samplePageSize);
  }, [loadSampleBatch, samplePageSize]);

  useEffect(() => {
    if (setViewerTab !== 'samples' || !activeSet || isLoadingSample) {
      return;
    }
    if (sampleColumns <= 1 || sampleImages.length === 0) {
      return;
    }
    const remainder = sampleImages.length % sampleColumns;
    if (remainder === 0) {
      return;
    }
    const fill = sampleColumns - remainder;
    void loadSampleBatch(fill);
  }, [
    activeSet,
    isLoadingSample,
    loadSampleBatch,
    sampleColumns,
    sampleImages.length,
    setViewerTab,
  ]);

  const handleLoadAllSample = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setIsLoadingSample(true);
    setViewerIndexProgress('Loading sample…');
    try {
      const images = await resolveSetImages(activeSet, true);
      if (images.length === 0) {
        setSampleImages([]);
        return;
      }
      const shuffled = shuffleItems(images);
      setSampleImages(shuffled);
      sampleSeenRef.current.set(
        activeSet.id,
        new Set(shuffled.map((image) => image.id))
      );
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingSample(false);
      setViewerIndexProgress('');
    }
  }, [activeSet, isConnected, resolveSetImages]);

  const handleLoadMoreImages = async () => {
    if (!activeSet) {
      return;
    }
    const previousCount = activeImages.length;
    const cached = readImageListCache(activeSet.id);
    const maxAvailable = activeSet.imageCount ?? cached?.length ?? Infinity;
    const nextLimit = Math.min(imageLimit + allPageSize, maxAvailable);
    if (nextLimit <= activeImages.length) {
      return;
    }
    setImageLimit(nextLimit);
    await loadSetImages(activeSet, nextLimit, true);
    const nextCached = readImageListCache(activeSet.id);
    if (nextCached) {
      prefetchThumbs(nextCached.slice(previousCount, nextLimit));
    }
  };

  const handleLoadAllPreloaded = async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setIsLoadingMore(true);
    setImageLoadStatus('Images: loading preloaded list');
    try {
      const favoriteIds = activeSet.favoriteImageIds ?? [];
      const cached = readImageListCache(activeSet.id);
      if (cached) {
        setFavoriteImages(filterFavorites(cached, favoriteIds));
        setActiveImages(cached);
        setImageLimit(cached.length);
        return;
      }
      if (viewerIndexTimerRef.current) {
        viewerIndexTimerRef.current();
        viewerIndexTimerRef.current = null;
      }
      const stopTimer = startIndexTimer(setViewerIndexProgress);
      viewerIndexTimerRef.current = stopTimer;
      const index = activeSet.indexFileId
        ? await loadSetIndexById(activeSet.indexFileId, (progress) => {
            stopTimer();
            viewerIndexTimerRef.current = null;
            setViewerIndexProgress(formatDownloadProgress(progress));
          })
        : await loadSetIndex(activeSet.rootFolderId, (progress) => {
            stopTimer();
            viewerIndexTimerRef.current = null;
            setViewerIndexProgress(formatDownloadProgress(progress));
          });
      stopTimer();
      viewerIndexTimerRef.current = null;
      if (index) {
        const images = indexItemsToImages(index.data.items);
        if (!writeImageListCache(activeSet.id, images)) {
          setError('Image cache full. Cleared cache and continued without saving.');
        }
        setFavoriteImages(filterFavorites(images, favoriteIds));
        setActiveImages(images);
        setImageLimit(images.length);
        if (activeSet.indexFileId !== index.fileId) {
          await handleUpdateSet(activeSet.id, { indexFileId: index.fileId });
        }
        return;
      }
      setError('No index available yet. Use Refresh data to build it.');
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingMore(false);
      setViewerIndexProgress('');
    }
  };

  const favoriteIds = activeSet?.favoriteImageIds ?? [];
  const modalImage =
    modalIndex !== null && modalIndex >= 0 && modalIndex < modalItems.length
      ? modalItems[modalIndex]
      : null;
  const cachedCount = activeSet ? readImageListCache(activeSet.id)?.length : undefined;
  const totalImagesKnown = activeSet?.imageCount ?? cachedCount;
  const totalImages = totalImagesKnown ?? activeImages.length;
  const remainingImages =
    totalImagesKnown !== undefined
      ? Math.max(0, totalImagesKnown - activeImages.length)
      : undefined;
  const pendingExtra =
    totalImagesKnown !== undefined
      ? Math.max(0, Math.min(allPageSize, remainingImages))
      : allPageSize;
  const favoritesCount = activeSet?.favoriteImageIds?.length ?? 0;
  const allImagesCount = totalImagesKnown ?? activeImages.length;
  const sampleRemaining =
    totalImagesKnown !== undefined
      ? Math.max(0, totalImagesKnown - sampleImages.length)
      : undefined;
  const samplePendingExtra =
    sampleRemaining !== undefined
      ? Math.max(0, Math.min(samplePageSize, sampleRemaining))
      : samplePageSize;

  const handleSetViewerTab = useCallback(
    (tab: 'samples' | 'favorites' | 'all') => {
      setSetViewerTab(tab);
      if (tab === 'all' && activeSet && activeImages.length === 0 && !isLoadingImages) {
        setImageLimit(allPageSize);
        void loadSetImages(activeSet, allPageSize, false);
      }
    },
    [activeImages.length, activeSet, allPageSize, isLoadingImages]
  );

  const openModal = (imageId: string, items: DriveImage[], label: string) => {
    const index = items.findIndex((image) => image.id === imageId);
    setModalItems(items);
    modalItemsLengthRef.current = items.length;
    setModalContextLabel(label);
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    if (label === 'Sample' && activeSet) {
      sampleHistoryRef.current = items;
      sampleHistorySetRef.current = activeSet.id;
    } else {
      sampleHistoryRef.current = [];
      sampleHistorySetRef.current = null;
    }
    setModalImageId(imageId);
    setModalIndex(index >= 0 ? index : null);
    triggerModalPulse();
  };

  const closeModal = () => {
    setModalIndex(null);
    setModalImageId(null);
    setModalItems([]);
    modalItemsLengthRef.current = 0;
    setModalContextLabel('');
    setModalIsLoading(false);
    setModalPulse(false);
    setModalFavoritePulse(null);
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    setModalZoom(1);
    setModalPan({ x: 0, y: 0 });
    sampleHistoryRef.current = [];
    sampleHistorySetRef.current = null;
    sampleAppendInFlightRef.current = false;
    if (modalPulseTimeout.current) {
      window.clearTimeout(modalPulseTimeout.current);
      modalPulseTimeout.current = null;
    }
    if (modalFavoritePulseTimeout.current) {
      window.clearTimeout(modalFavoritePulseTimeout.current);
      modalFavoritePulseTimeout.current = null;
    }
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
      modalFullAbortRef.current = null;
    }
    if (modalFullUrlRef.current) {
      const cached = Array.from(modalFullCacheRef.current.values()).includes(
        modalFullUrlRef.current
      );
      if (!cached) {
        URL.revokeObjectURL(modalFullUrlRef.current);
      }
      modalFullUrlRef.current = null;
    }
    modalPrefetchAbortRef.current.forEach((controller) => controller.abort());
    modalPrefetchAbortRef.current.clear();
    modalPrefetchCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    modalPrefetchCacheRef.current.clear();
    modalFullCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    modalFullCacheRef.current.clear();
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

  const triggerFavoritePulse = useCallback((mode: 'add' | 'remove') => {
    setModalFavoritePulse(null);
    if (modalFavoritePulseTimeout.current) {
      window.clearTimeout(modalFavoritePulseTimeout.current);
    }
    modalFavoritePulseTimeout.current = window.setTimeout(() => {
      setModalFavoritePulse(mode);
      modalFavoritePulseTimeout.current = window.setTimeout(() => {
        setModalFavoritePulse(null);
      }, 520);
    }, 10);
  }, []);

  const storeModalFullCache = useCallback((imageId: string, url: string) => {
    const cache = modalFullCacheRef.current;
    const existing = cache.get(imageId);
    if (existing && existing !== url) {
      URL.revokeObjectURL(existing);
    }
    cache.delete(imageId);
    cache.set(imageId, url);
    while (cache.size > modalFullCacheMax) {
      const oldest = cache.entries().next().value as [string, string] | undefined;
      if (!oldest) {
        break;
      }
      cache.delete(oldest[0]);
      URL.revokeObjectURL(oldest[1]);
    }
  }, []);

  const fetchImageBlob = useCallback(async (url: string, signal: AbortSignal) => {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Image load failed: ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    const blob = await response.blob();
    if (contentLength) {
      const expected = Number(contentLength);
      if (Number.isFinite(expected) && expected > 0 && blob.size !== expected) {
        throw new Error('Image load incomplete');
      }
    }
    return blob;
  }, []);

  const prefetchModalImage = useCallback((imageId?: string) => {
    if (!imageId) {
      return;
    }
    if (modalPrefetchCacheRef.current.has(imageId)) {
      return;
    }
    if (modalPrefetchAbortRef.current.has(imageId)) {
      return;
    }
    const controller = new AbortController();
    modalPrefetchAbortRef.current.set(imageId, controller);
    const url = createProxyMediaUrl(imageId);
    fetchImageBlob(url, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        modalPrefetchCacheRef.current.set(imageId, objectUrl);
      })
      .catch((prefetchError) => {
        if ((prefetchError as Error).name === 'AbortError') {
          return;
        }
        setError((prefetchError as Error).message);
      })
      .finally(() => {
        modalPrefetchAbortRef.current.delete(imageId);
      });
  }, [fetchImageBlob]);

  const toggleFavoriteFromModal = useCallback(() => {
    if (!activeSet || !modalImage) {
      return;
    }
    const isFavorite = favoriteIds.includes(modalImage.id);
    triggerFavoritePulse(isFavorite ? 'remove' : 'add');
    void toggleFavoriteImage(activeSet.id, modalImage.id);
  }, [activeSet, favoriteIds, modalImage, toggleFavoriteImage, triggerFavoritePulse]);

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
      if (modalContextLabel === 'Sample' && activeSet) {
        if (sampleAppendInFlightRef.current) {
          return;
        }
        sampleAppendInFlightRef.current = true;
        const setId = activeSet.id;
        (async () => {
          const source =
            readImageListCache(activeSet.id) ??
            (await resolveSetImages(activeSet, true));
          if (!source || source.length === 0) {
            return;
          }
          const nextSample = pickNextSample(activeSet.id, source, samplePageSize);
          if (nextSample.length === 0) {
            return;
          }
          const existingIds = new Set(modalItems.map((item) => item.id));
          const deduped = nextSample.filter((item) => !existingIds.has(item.id));
          if (deduped.length === 0) {
            return;
          }
          if (sampleHistorySetRef.current && sampleHistorySetRef.current !== setId) {
            return;
          }
          const updated = [...modalItems, ...deduped];
          sampleHistoryRef.current = updated;
          sampleHistorySetRef.current = setId;
          setModalItems(updated);
          modalItemsLengthRef.current = updated.length;
          setSampleImages((current) => {
            const existingIds = new Set(current.map((item) => item.id));
            const merged = [...current];
            for (const item of deduped) {
              if (!existingIds.has(item.id)) {
                merged.push(item);
              }
            }
            return merged;
          });
          const nextIndex = updated.length - deduped.length;
          setModalFullSrc(null);
          setModalFullImageId(null);
          setModalFullAnimate(false);
          setModalImageId(updated[nextIndex]?.id ?? null);
          setModalIndex(updated[nextIndex]?.id ? nextIndex : null);
          triggerModalPulse();
        })()
          .catch((error) => {
            setError((error as Error).message);
          })
          .finally(() => {
            sampleAppendInFlightRef.current = false;
          });
        return;
      }
      if (
        modalContextLabel === 'Set' &&
        remainingImages !== undefined &&
        remainingImages > 0 &&
        !isLoadingMore &&
        activeSet
      ) {
        modalPendingAdvanceRef.current = true;
        void handleLoadMoreImages();
      }
      return;
    }
    const nextIndex = currentIndex + 1;
    const nextImage = modalItems[nextIndex];
    if (!nextImage) {
      return;
    }
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    setModalImageId(nextImage.id);
    setModalIndex(nextIndex);
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
    setModalFullSrc(null);
    setModalFullImageId(null);
    setModalFullAnimate(false);
    setModalImageId(nextImage.id);
    setModalIndex(nextIndex);
    triggerModalPulse();
  };

  useEffect(() => {
    if (modalIndex === null) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f') {
        toggleFavoriteFromModal();
      }
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
  }, [
    closeModal,
    goNextImage,
    goPrevImage,
    modalImageId,
    modalIndex,
    toggleFavoriteFromModal,
  ]);

  useEffect(() => {
    return () => {
      if (modalPulseTimeout.current) {
        window.clearTimeout(modalPulseTimeout.current);
      }
      if (modalFavoritePulseTimeout.current) {
        window.clearTimeout(modalFavoritePulseTimeout.current);
      }
      modalPrefetchAbortRef.current.forEach((controller) => controller.abort());
      modalPrefetchAbortRef.current.clear();
      modalPrefetchCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      modalPrefetchCacheRef.current.clear();
      modalFullCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      modalFullCacheRef.current.clear();
      if (modalFullUrlRef.current) {
        URL.revokeObjectURL(modalFullUrlRef.current);
        modalFullUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (modalImageId) {
      setModalZoom(1);
      setModalPan({ x: 0, y: 0 });
    }
  }, [modalImageId, storeModalFullCache]);

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    setModalIsLoading(true);
    setModalFullAnimate(false);
    setModalFullImageId(null);
    setModalFullSrc(null);
    if (modalFullAbortRef.current) {
      modalFullAbortRef.current.abort();
    }
    modalFullUrlRef.current = null;
    const cacheHit = modalFullCacheRef.current.get(modalImageId);
    if (cacheHit) {
      modalFullCacheRef.current.delete(modalImageId);
      modalFullCacheRef.current.set(modalImageId, cacheHit);
      modalFullUrlRef.current = cacheHit;
      setModalFullSrc(cacheHit);
      setModalFullImageId(modalImageId);
      setModalFullAnimate(false);
      setModalIsLoading(false);
      return;
    }
    const cachedUrl = modalPrefetchCacheRef.current.get(modalImageId);
    if (cachedUrl) {
      modalPrefetchCacheRef.current.delete(modalImageId);
      modalFullUrlRef.current = cachedUrl;
      setModalFullSrc(cachedUrl);
      setModalFullImageId(modalImageId);
      setModalFullAnimate(false);
      storeModalFullCache(modalImageId, cachedUrl);
      setModalIsLoading(false);
      return;
    }
    const controller = new AbortController();
    modalFullAbortRef.current = controller;
    const url = createProxyMediaUrl(modalImageId);
    fetchImageBlob(url, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        modalFullUrlRef.current = objectUrl;
        setModalFullSrc(objectUrl);
        setModalFullImageId(modalImageId);
        setModalFullAnimate(true);
        storeModalFullCache(modalImageId, objectUrl);
        setModalIsLoading(false);
      })
      .catch((loadError) => {
        if ((loadError as Error).name === 'AbortError') {
          return;
        }
        setError((loadError as Error).message);
        setModalIsLoading(false);
      });
  }, [fetchImageBlob, modalImageId, storeModalFullCache]);

  useEffect(() => {
    if (modalIndex === null || modalIndex < 0 || modalItems.length === 0) {
      return;
    }
    const prev = modalItems[modalIndex - 1]?.id;
    const next = modalItems[modalIndex + 1]?.id;
    const allowed = new Set([prev, next].filter(Boolean) as string[]);
    modalPrefetchAbortRef.current.forEach((controller, id) => {
      if (!allowed.has(id)) {
        controller.abort();
        modalPrefetchAbortRef.current.delete(id);
      }
    });
    modalPrefetchCacheRef.current.forEach((url, id) => {
      if (!allowed.has(id)) {
        URL.revokeObjectURL(url);
        modalPrefetchCacheRef.current.delete(id);
      }
    });
    prefetchModalImage(prev);
    prefetchModalImage(next);
  }, [modalIndex, modalItems, prefetchModalImage]);

  useEffect(() => {
    if (!modalImageId) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalImageId]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      setCanScrollUp(scrollY > 20);
      setCanScrollDown(scrollY < maxScroll - 20);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (
      modalContextLabel !== 'Set' ||
      !modalPendingAdvanceRef.current ||
      modalItems.length >= activeImages.length ||
      activeImages.length === 0
    ) {
      return;
    }
    const previousLength = modalItemsLengthRef.current;
    const nextImage = activeImages[previousLength];
    if (!nextImage) {
      return;
    }
    setModalItems(activeImages);
    modalItemsLengthRef.current = activeImages.length;
    modalPendingAdvanceRef.current = false;
    setModalImageId(nextImage.id);
    setModalIndex(previousLength);
    setIsModalLoaded(false);
    triggerModalPulse();
  }, [activeImages, modalContextLabel, modalItems.length]);

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

  const handleModalTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const now = Date.now();
      const lastTap = lastTapRef.current;
      if (lastTap) {
        const dt = now - lastTap.time;
        const dx = touch.clientX - lastTap.x;
        const dy = touch.clientY - lastTap.y;
        if (dt < 300 && Math.hypot(dx, dy) < 24) {
          event.preventDefault();
          oneHandZoomRef.current = { startY: touch.clientY, zoom: modalZoom };
          if (modalZoom <= 1) {
            setModalZoom(1.2);
          }
          touchStartRef.current = null;
          touchLastRef.current = null;
          lastTapRef.current = null;
          return;
        }
      }
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchLastRef.current = { x: touch.clientX, y: touch.clientY };
      pinchStartRef.current = null;
      touchMovedRef.current = false;
    } else if (event.touches.length === 2) {
      const [first, second] = Array.from(event.touches);
      if (!first || !second) {
        return;
      }
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      pinchStartRef.current = { distance: Math.hypot(dx, dy), zoom: modalZoom };
      touchStartRef.current = null;
      touchLastRef.current = null;
    }
  };

  const handleModalTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 1 && oneHandZoomRef.current) {
      event.preventDefault();
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const deltaY = oneHandZoomRef.current.startY - touch.clientY;
      const nextZoom = Math.min(4, Math.max(1, oneHandZoomRef.current.zoom + deltaY / 200));
      setModalZoom(nextZoom);
      if (nextZoom === 1) {
        setModalPan({ x: 0, y: 0 });
      }
      return;
    }

    if (event.touches.length === 2 && pinchStartRef.current) {
      event.preventDefault();
      const [first, second] = Array.from(event.touches);
      if (!first || !second) {
        return;
      }
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      const distance = Math.hypot(dx, dy);
      const nextZoom = Math.min(
        4,
        Math.max(1, (distance / pinchStartRef.current.distance) * pinchStartRef.current.zoom)
      );
      setModalZoom(nextZoom);
      if (nextZoom === 1) {
        setModalPan({ x: 0, y: 0 });
      }
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (touchStartRef.current) {
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        if (Math.hypot(dx, dy) > 10) {
          touchMovedRef.current = true;
        }
      }
      if (modalZoom > 1 && touchLastRef.current) {
        event.preventDefault();
        const deltaX = touch.clientX - touchLastRef.current.x;
        const deltaY = touch.clientY - touchLastRef.current.y;
        setModalPan((current) => ({
          x: current.x + deltaX,
          y: current.y + deltaY,
        }));
      }
      touchLastRef.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleModalTouchEnd = () => {
    if (pinchStartRef.current) {
      pinchStartRef.current = null;
      return;
    }
    if (oneHandZoomRef.current) {
      oneHandZoomRef.current = null;
      return;
    }
    if (!touchStartRef.current || !touchLastRef.current) {
      touchStartRef.current = null;
      touchLastRef.current = null;
      return;
    }
    const dx = touchLastRef.current.x - touchStartRef.current.x;
    const dy = touchLastRef.current.y - touchStartRef.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const swipeThreshold = 60;
    const verticalThreshold = 80;

    if (absX > absY && absX > swipeThreshold && modalZoom <= 1.05) {
      if (dx < 0) {
        goNextImage();
      } else {
        goPrevImage();
      }
    } else if (dy < -verticalThreshold && modalZoom <= 1.05) {
      closeModal();
    }

    if (!touchMovedRef.current && absX < 6 && absY < 6) {
      lastTapRef.current = { time: Date.now(), x: touchStartRef.current.x, y: touchStartRef.current.y };
    }
    touchStartRef.current = null;
    touchLastRef.current = null;
    touchMovedRef.current = false;
  };


  return (
    <div className={`app ${isLoadingMetadata ? 'app--loading' : ''}`}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="title">Pose Viewer</div>
          <div className="nav-tabs">
            <button
              type="button"
              className={`nav-tab ${page === 'overview' ? 'is-active' : ''}`}
              onClick={() => setPage('overview')}
            >
              Sets
            </button>
            <button
              type="button"
              className={`nav-tab ${page === 'create' ? 'is-active' : ''}`}
              onClick={() => setPage('create')}
            >
              Create
            </button>
            {activeSet ? (
              <button
                type="button"
                className={`nav-tab ${page === 'set' ? 'is-active' : ''}`}
                onClick={() => setPage('set')}
              >
                Viewer
              </button>
            ) : null}
          </div>
        </div>
        <div className="auth-chip">
          <button className="chip-button" onClick={handleConnect}>
            {isConnected ? 'Reconnect' : 'Connect'}
          </button>
          {isConnected ? <span className="chip-status">Connected</span> : null}
        </div>
      </header>
      {isLoadingMetadata ? (
        <div className="loading-overlay">
          <div className="loading-card">Loading metadata…</div>
        </div>
      ) : null}

      {page === 'create' ? (
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
                    <div className="tag-row">
                      {sortedQuickTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className={`tag-button ${
                            selectedCreateTags.includes(tag) ? 'is-active' : ''
                          }`}
                          onClick={() => toggleCreateTag(tag)}
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
                  {previewCount !== null ? (
                    <p className="muted">{previewCount} images</p>
                  ) : null}
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleRefreshPreview}
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
                            size={THUMB_SIZE}
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">No images found under this folder.</p>
                  )}
                </div>
                <button className="primary" onClick={handleCreateSet} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Create set'}
                </button>
              </div>
            ) : (
              <p className="empty">Select a folder path to populate this form.</p>
            )}
          </div>
        </div>
      </section>
      ) : null}

      {page === 'overview' ? (
      <section className="panel">
        <div className="panel-header panel-header--row panel-header--overview">
          <div className="overview-title">
            <h2>Sets</h2>
            <p className="muted">{metadata.sets.length} total</p>
          </div>
          <div className="overview-controls">
            <label className="field field--inline">
              <span>Filter sets</span>
              <input
                type="search"
                value={setFilter}
                onChange={(event) => setSetFilter(event.target.value)}
                placeholder="Search by name or tag"
              />
            </label>
            <label className="field field--inline">
              <span>Sort sets</span>
              <select value={setSort} onChange={(event) => setSetSort(event.target.value)}>
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
          <div className="card-grid">
            {filteredSets.map((set) => (
              <button
                key={set.id}
                className="card card--clickable"
                onClick={() => handleOpenSet(set)}
              >
                <div className="card-thumb">
                  {set.thumbnailFileId ? (
                    <ImageThumb
                      isConnected={isConnected}
                      fileId={set.thumbnailFileId}
                      alt={set.name}
                      size={CARD_THUMB_SIZE}
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
      ) : null}

      {page === 'set' ? (
      <section className="panel" ref={setViewerRef}>
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
                      size={VIEWER_THUMB_SIZE}
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
                  <input
                    className="viewer-title-input"
                    type="text"
                    key={activeSet.id}
                    defaultValue={activeSet.name}
                    onBlur={(event) =>
                      handleUpdateSet(activeSet.id, {
                        name: event.target.value.trim() || activeSet.name,
                      })
                    }
                  />
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
                                onClick={() => toggleActiveSetTag(tag)}
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
                                onClick={() => toggleActiveSetTag(tag)}
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
          {activeSet ? (
            <div className="viewer-actions">
              <div className="viewer-menu">
                <button type="button" className="ghost viewer-menu-trigger" aria-label="Set actions">
                  <IconDotsVertical size={18} />
                </button>
                <div className="viewer-menu-panel">
                  <button
                    className="ghost"
                    onClick={() => handleRefreshSet(activeSet)}
                    disabled={isRefreshingSet}
                  >
                    {isRefreshingSet ? 'Refreshing…' : 'Refresh data'}
                  </button>
                  <button
                    className="ghost ghost--danger"
                    onClick={() => handleDeleteSet(activeSet)}
                    disabled={isSaving}
                  >
                    Delete set
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="panel-body">
          {activeSet ? (
            <div className="stack">
              <div className="subtabs">
                <button
                  type="button"
                  className={`subtab ${setViewerTab === 'samples' ? 'is-active' : ''}`}
                  onClick={() => handleSetViewerTab('samples')}
                >
                  Sample
                </button>
                <button
                  type="button"
                  className={`subtab ${setViewerTab === 'favorites' ? 'is-active' : ''}`}
                  onClick={() => handleSetViewerTab('favorites')}
                >
                  Favorites ({favoritesCount})
                </button>
                <button
                  type="button"
                  className={`subtab ${setViewerTab === 'all' ? 'is-active' : ''}`}
                  onClick={() => handleSetViewerTab('all')}
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
                            onClick={() => openModal(image.id, sampleImages, 'Sample')}
                          >
                            <ImageThumb
                              isConnected={isConnected}
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
                  </div>
                ) : (
                  <p className="empty">No sample yet. Refresh to build a preview.</p>
                )}
                <button
                  className="ghost load-more"
                  onClick={handleLoadMoreSample}
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
                  className="ghost load-more"
                  onClick={handleLoadAllSample}
                  disabled={isLoadingSample}
                >
                  {isLoadingSample
                    ? totalImagesKnown !== undefined
                      ? `Loading all ${totalImagesKnown}...`
                      : 'Loading all images...'
                    : totalImagesKnown !== undefined
                      ? `Load all remaining ${Math.max(
                          0,
                          totalImagesKnown - sampleImages.length
                        )}`
                      : 'Load all remaining'}
                </button>
              </div>
            ) : null}
              {setViewerTab === 'favorites' ? (
                <div className="stack">
                  {isLoadingSample && favoriteImages.length === 0 ? (
                    <p className="empty">Loading favorites…</p>
                  ) : null}
                  {favoriteImages.length > 0 ? (
                    <div className="image-grid image-grid--zoom image-grid--filled">
                      {favoriteImages.map((image) => (
                        <div key={image.id} className="image-tile">
                          <button
                            type="button"
                            className="image-button"
                            onClick={() => openModal(image.id, favoriteImages, 'Favorites')}
                          >
                            <ImageThumb
                              isConnected={isConnected}
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
                    </div>
                  ) : (
                    <p className="empty">No favorites yet.</p>
                  )}
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
                          onClick={() => openModal(image.id, activeImages, 'Set')}
                        >
                          <ImageThumb
                            isConnected={isConnected}
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
                      totalImagesKnown === 0 ? (
                        <p className="empty">No images found in this set.</p>
                      ) : (
                        <p className="empty">
                          No images loaded yet. Use the load buttons below.
                        </p>
                      )
                    ) : null}
                  </div>
                  {pendingExtra > 0 ? (
                    <button
                      className="ghost load-more"
                      onClick={handleLoadMoreImages}
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
                      ? `Load more images (+${allPageSize})`
                      : `Load images (+${allPageSize})`}
                  </button>
                ) : null}
                  {remainingImages !== undefined && remainingImages > 0 ? (
                    <button
                      className="ghost load-more"
                      onClick={handleLoadAllPreloaded}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore
                        ? `Loading all ${totalImages}...`
                        : `Load all remaining ${remainingImages}`}
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
      ) : null}
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
            onTouchStart={handleModalTouchStart}
            onTouchMove={handleModalTouchMove}
            onTouchEnd={handleModalTouchEnd}
            onTouchCancel={handleModalTouchEnd}
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
                onClick={toggleFavoriteFromModal}
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
            {modalFavoritePulse ? (
              <div
                className={`modal-favorite-pop ${
                  modalFavoritePulse === 'add' ? 'is-add' : 'is-remove'
                }`}
              >
                {modalFavoritePulse === 'add' ? (
                  <IconHeartFilled size={1} />
                ) : (
                  <IconHeart size={1} />
                )}
              </div>
            ) : null}
            <div
              className={`modal-media ${modalZoom > 1 ? 'is-zoomed' : ''}`}
              style={{
                transform: `translate(${modalPan.x}px, ${modalPan.y}px) scale(${modalZoom})`,
              }}
            >
              <img
                className="modal-thumb"
                key={`thumb-${modalImage.id}`}
                src={createProxyThumbUrl(modalImage.id, THUMB_SIZE)}
                alt={modalImage.name}
              />
              <img
                className={`modal-full ${
                  modalFullImageId === modalImage.id ? 'is-loaded' : ''
                } ${modalFullAnimate ? 'is-animate' : ''}`}
                key={`full-${modalImage.id}`}
                src={modalFullSrc ?? undefined}
                alt={modalImage.name}
              />
            </div>
            <div className={`modal-status ${modalIsLoading ? 'is-visible' : ''}`}>
              <div className={`modal-status-inner ${modalPulse ? 'pulse' : ''}`}>
                <IconLoader2 size={20} />
                <span>Loading image</span>
              </div>
            </div>
            {modalContextLabel && modalIndex !== null ? (
              <div className="modal-counter">
                {modalContextLabel} {modalIndex + 1}/{modalItems.length}
                {modalContextLabel === 'Set' || modalContextLabel === 'Sample'
                  ? ` [${totalImages}]`
                  : ''}
              </div>
            ) : null}
            <div className="modal-hint">
              {modalZoom > 1 ? 'Drag to pan • ' : ''}
              Scroll to zoom • Use ← → to navigate
            </div>
          </div>
        </div>
      ) : null}
      {toasts.length > 0 ? (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast">
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
      <div className="scroll-controls">
        <button
          type="button"
          className="scroll-control"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          disabled={!canScrollUp}
        >
          <IconArrowUp size={18} />
        </button>
        <button
          type="button"
          className="scroll-control"
          onClick={() =>
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: 'smooth',
            })
          }
          aria-label="Scroll to bottom"
          disabled={!canScrollDown}
        >
          <IconArrowDown size={18} />
        </button>
      </div>
    </div>
  );
}
