import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { listFolderPaths, type FolderPath } from './drive/scan';
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
  getMetadataInfo,
  loadMetadata,
  saveMetadataWithInfo,
  type MetadataDocument,
  type MetadataInfo,
  type PoseSet,
} from './metadata';
import type { DriveImage } from './drive/types';
import { normalizeTags } from './utils/tags';
import { pickRandom, shuffleItems } from './utils/random';
import { formatDownloadProgress, formatIndexProgress, startIndexTimer } from './utils/progress';
import { createProxyThumbUrl } from './utils/driveUrls';
import {
  readImageListCache,
  readMetadataCache,
  readMetadataDirtyFlag,
  writeImageListCache,
  writeMetadataCache,
  writeMetadataDirtyFlag,
} from './utils/cache';
import { appendUniqueImages, pickNextBatch } from './utils/imageSampling';
import { AppHeader } from './components/AppHeader';
import { ToastStack } from './components/ToastStack';
import { ScrollControls } from './components/ScrollControls';
import { CreateSetPage } from './pages/CreateSetPage';
import { OverviewPage } from './pages/OverviewPage';
import { SlideshowPage } from './pages/SlideshowPage';
import { SetViewerPage } from './pages/SetViewerPage';
import { ModalStateProvider } from './features/modal/ModalStateProvider';

const DEFAULT_ROOT_ID = import.meta.env.VITE_ROOT_FOLDER_ID as string | undefined;
const IMAGE_PAGE_SIZE = 96;
const THUMB_SIZE = 320;
const CARD_THUMB_SIZE = 500;
const VIEWER_THUMB_SIZE = CARD_THUMB_SIZE;
const emptyFolders: FolderPath[] = [];

function parsePathState() {
  const raw = window.location.pathname;
  const path = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
  if (path === '/create') {
    return { page: 'create', setId: undefined };
  }
  if (path === '/slideshow') {
    return { page: 'slideshow', setId: undefined };
  }
  if (path.startsWith('/set/')) {
    const setId = decodeURIComponent(path.slice('/set/'.length));
    if (setId) {
      return { page: 'set', setId };
    }
  }
  return { page: 'overview', setId: undefined };
}

function filterFavorites(images: DriveImage[], favoriteIds: string[]) {
  if (favoriteIds.length === 0) {
    return [];
  }
  const favorites = new Set(favoriteIds);
  return images.filter((image) => favorites.has(image.id));
}

function filterNonFavorites(images: DriveImage[], favoriteIds: string[]) {
  if (favoriteIds.length === 0) {
    return images;
  }
  const favorites = new Set(favoriteIds);
  return images.filter((image) => !favorites.has(image.id));
}

function mergeMetadata(local: MetadataDocument, remote: MetadataDocument): MetadataDocument {
  const localMap = new Map(local.sets.map((set) => [set.id, set]));
  const merged = remote.sets.map((remoteSet) => {
    const localSet = localMap.get(remoteSet.id);
    if (!localSet) {
      return remoteSet;
    }
    localMap.delete(remoteSet.id);
    const localUpdated = localSet.updatedAt ?? 0;
    const remoteUpdated = remoteSet.updatedAt ?? 0;
    if (localUpdated === remoteUpdated) {
      return { ...remoteSet, ...localSet };
    }
    return localUpdated > remoteUpdated ? localSet : remoteSet;
  });
  for (const set of localMap.values()) {
    merged.push(set);
  }
  return { version: 1, sets: merged };
}

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<string>('');
  const rootId = DEFAULT_ROOT_ID ?? '';
  const [page, setPage] = useState<'overview' | 'create' | 'set' | 'slideshow'>('overview');
  const [folderPaths, setFolderPaths] = useLocalStorage<FolderPath[]>(
    'poseviewer-folder-paths',
    emptyFolders
  );
  const [metadata, setMetadata] = useState<MetadataDocument>(emptyMetadata());
  const [metadataFileId, setMetadataFileId] = useState<string | null>(null);
  const [metadataInfo, setMetadataInfo] = useState<MetadataInfo>({ fileId: null });
  const [metadataDirty, setMetadataDirty] = useState(readMetadataDirtyFlag());
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
  const [slideshowIncludeTags, setSlideshowIncludeTags] = useState<string[]>([]);
  const [slideshowExcludeTags, setSlideshowExcludeTags] = useState<string[]>([]);
  const [slideshowFavoriteFilter, setSlideshowFavoriteFilter] = useState<
    'all' | 'favorites' | 'nonfavorites'
  >('all');
  const [selectedFolder, setSelectedFolder] = useState<FolderPath | null>(null);
  const [setName, setSetName] = useState('');
  const [setTags, setSetTags] = useState('');
  const [activeSet, setActiveSet] = useState<PoseSet | null>(null);
  const [activeImages, setActiveImages] = useState<DriveImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [setViewerTab, setSetViewerTab] = useState<
    'samples' | 'favorites' | 'nonfavorites' | 'all'
  >('samples');
  const [sampleColumns, setSampleColumns] = useState(1);
  const [allColumns, setAllColumns] = useState(1);
  const [previewImages, setPreviewImages] = useState<DriveImage[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewIndexProgress, setPreviewIndexProgress] = useState('');
  const [sampleImages, setSampleImages] = useState<DriveImage[]>([]);
  const [nonFavoriteImages, setNonFavoriteImages] = useState<DriveImage[]>([]);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(false);
  const [isLoadingNonFavorites, setIsLoadingNonFavorites] = useState(false);
  const [slideshowImages, setSlideshowImages] = useState<DriveImage[]>([]);
  const [isLoadingSlideshow, setIsLoadingSlideshow] = useState(false);
  const [slideshowStarted, setSlideshowStarted] = useState(false);
  const [imageLoadStatus, setImageLoadStatus] = useState('');
  const [viewerIndexProgress, setViewerIndexProgress] = useState('');
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE);
  const [favoriteImages, setFavoriteImages] = useState<DriveImage[]>([]);
  const [isRefreshingSet, setIsRefreshingSet] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const sampleGridRef = useRef<HTMLDivElement | null>(null);
  const allGridRef = useRef<HTMLDivElement | null>(null);
  const slideshowSeenRef = useRef<Set<string>>(new Set());
  const slideshowPoolRef = useRef<{ key: string; images: DriveImage[] } | null>(null);
  const slideshowImageSetRef = useRef<Map<string, string>>(new Map());
  const nonFavoriteSeenRef = useRef<Map<string, Set<string>>>(new Map());
  const favoriteSeenRef = useRef<Map<string, Set<string>>>(new Map());
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
  const prebuiltIndexRef = useRef<{
    folderId: string;
    items: { id: string; name: string }[];
    fileId: string | null;
  } | null>(null);
  const viewerIndexTimerRef = useRef<(() => void) | null>(null);

  const samplePageSize = Math.max(1, Math.ceil(48 / sampleColumns) * sampleColumns);
  const allPageSize = Math.max(1, Math.ceil(IMAGE_PAGE_SIZE / allColumns) * allColumns);
  const slideshowPageSize = 48;
  const metadataRef = useRef<MetadataDocument>(metadata);
  const metadataFileIdRef = useRef<string | null>(metadataFileId);
  const metadataInfoRef = useRef<MetadataInfo>(metadataInfo);
  const metadataDirtyRef = useRef(metadataDirty);
  const slideshowImagesRef = useRef<DriveImage[]>(slideshowImages);
  const openModalRef = useRef<
    (imageId: string, images: DriveImage[], label: string) => void
  >(() => {});
  const updateQueueRef = useRef(Promise.resolve());
  const lastHistoryPathRef = useRef<string | null>(null);
  const skipHistoryRef = useRef(false);

  const syncPathState = useCallback(
    (page: 'overview' | 'create' | 'set' | 'slideshow', setId?: string) => {
      let next = '/';
      if (page === 'create') {
        next = '/create';
      } else if (page === 'slideshow') {
        next = '/slideshow';
      } else if (page === 'set' && setId) {
        next = `/set/${encodeURIComponent(setId)}`;
      }
      if (lastHistoryPathRef.current === next) {
        return;
      }
      if (skipHistoryRef.current) {
        skipHistoryRef.current = false;
        window.history.replaceState(null, '', next);
      } else {
        window.history.pushState(null, '', next);
      }
      lastHistoryPathRef.current = next;
    },
    []
  );

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

  const setsById = useMemo(() => {
    return new Map(metadata.sets.map((set) => [set.id, set]));
  }, [metadata.sets]);

  const slideshowTagFilters = useMemo(() => {
    const include = slideshowIncludeTags.map((tag) => tag.toLowerCase());
    const exclude = slideshowExcludeTags.map((tag) => tag.toLowerCase());
    return { include, exclude };
  }, [slideshowExcludeTags, slideshowIncludeTags]);

  const slideshowSets = useMemo(() => {
    const { include, exclude } = slideshowTagFilters;
    return metadata.sets.filter((set) => {
      const tags = set.tags.map((tag) => tag.toLowerCase());
      if (include.length > 0 && !include.every((tag) => tags.includes(tag))) {
        return false;
      }
      if (exclude.length > 0 && exclude.some((tag) => tags.includes(tag))) {
        return false;
      }
      return true;
    });
  }, [metadata.sets, slideshowTagFilters]);

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

  const applyMetadataSnapshot = useCallback(
    (
      snapshot: {
        data: MetadataDocument;
        fileId: string | null;
        md5Checksum?: string;
        modifiedTime?: string;
      },
      options?: { preserveDirty?: boolean }
    ) => {
      setMetadata(snapshot.data);
      setMetadataFileId(snapshot.fileId);
      setMetadataInfo({
        fileId: snapshot.fileId,
        md5Checksum: snapshot.md5Checksum,
        modifiedTime: snapshot.modifiedTime,
      });
      metadataLoadedRef.current = true;
      if (!options?.preserveDirty) {
        setMetadataDirty(false);
      }
      if (rootId) {
        writeMetadataCache(rootId, snapshot.fileId, snapshot.data, {
          md5Checksum: snapshot.md5Checksum,
          modifiedTime: snapshot.modifiedTime,
        });
      }
    },
    [rootId]
  );

  const handleFetchMetadata = useCallback(async () => {
    if (!isConnected || !rootId) {
      return;
    }
    setIsLoadingMetadata(true);
    setError('');

    try {
      const remoteInfo = await getMetadataInfo(rootId);
      if (!remoteInfo.fileId) {
        if (metadataRef.current.sets.length > 0) {
          const saved = await saveMetadataWithInfo(
            rootId,
            metadataFileIdRef.current,
            metadataRef.current
          );
          applyMetadataSnapshot({ data: metadataRef.current, ...saved });
        }
        return;
      }

      const cachedMd5 = metadataInfoRef.current.md5Checksum;
      if (cachedMd5 && remoteInfo.md5Checksum && cachedMd5 === remoteInfo.md5Checksum) {
        return;
      }

      const remote = await loadMetadata(rootId);
      if (metadataDirtyRef.current) {
        const merged = mergeMetadata(metadataRef.current, remote.data);
        const saved = await saveMetadataWithInfo(rootId, remote.fileId, merged);
        applyMetadataSnapshot({ data: merged, ...saved });
      } else {
        applyMetadataSnapshot(remote);
      }
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingMetadata(false);
    }
  }, [applyMetadataSnapshot, isConnected, rootId]);

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
      const base = metadataDirtyRef.current
        ? mergeMetadata(metadataRef.current, meta.data)
        : meta.data;
      const excludeIds = new Set(base.sets.map((set) => set.rootFolderId));
      const excludePaths = base.sets.map((set) => set.rootPath);
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
      if (metadataDirtyRef.current) {
        const saved = await saveMetadataWithInfo(rootId, meta.fileId, base);
        applyMetadataSnapshot({ data: base, ...saved });
      } else {
        applyMetadataSnapshot(meta);
      }
    } catch (scanError) {
      setError((scanError as Error).message);
    } finally {
      setIsScanning(false);
    }
  }, [applyMetadataSnapshot, hiddenFolders, isConnected, rootId]);

  useEffect(() => {
    if (!rootId) {
      return;
    }

    const cached = readMetadataCache(rootId, { allowStale: !isConnected });
    if (cached) {
      applyMetadataSnapshot(
        {
          data: cached.data,
          fileId: cached.fileId,
          md5Checksum: cached.md5Checksum,
          modifiedTime: cached.modifiedTime,
        },
        { preserveDirty: readMetadataDirtyFlag() }
      );
    }

    if (!isConnected) {
      return;
    }

    const checkRemote = async () => {
      if (!cached) {
        await handleFetchMetadata();
        return;
      }
      const remoteInfo = await getMetadataInfo(rootId);
      if (!remoteInfo.fileId) {
        return;
      }
      const cachedMd5 = cached.md5Checksum;
      if (cachedMd5 && remoteInfo.md5Checksum && cachedMd5 === remoteInfo.md5Checksum) {
        return;
      }
      const remote = await loadMetadata(rootId);
      if (metadataDirtyRef.current) {
        const merged = mergeMetadata(metadataRef.current, remote.data);
        const saved = await saveMetadataWithInfo(rootId, remote.fileId, merged);
        applyMetadataSnapshot({ data: merged, ...saved });
      } else {
        applyMetadataSnapshot(remote);
      }
    };
    void checkRemote().catch((loadError) => {
      setError((loadError as Error).message);
    });
  }, [applyMetadataSnapshot, handleFetchMetadata, isConnected, rootId]);

  useEffect(() => {
    if (activeSet) {
      setSetViewerTab('samples');
    }
  }, [activeSet?.id]);

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    setNonFavoriteImages((current) =>
      filterNonFavorites(current, activeSet.favoriteImageIds ?? [])
    );
  }, [activeSet?.favoriteImageIds, activeSet?.id]);

  useEffect(() => {
    if (setViewerTab !== 'all' || !activeSet || isLoadingImages || isLoadingMore) {
      return;
    }
    if (activeImages.length === 0) {
      setImageLimit(allPageSize);
      void loadSetImages(activeSet, allPageSize, true);
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
    metadataInfoRef.current = metadataInfo;
  }, [metadataInfo]);

  useEffect(() => {
    metadataDirtyRef.current = metadataDirty;
    writeMetadataDirtyFlag(metadataDirty);
  }, [metadataDirty]);

  useEffect(() => {
    slideshowImagesRef.current = slideshowImages;
  }, [slideshowImages]);

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

  const toggleSlideshowIncludeTag = (tag: string) => {
    setSlideshowExcludeTags((current) => current.filter((value) => value !== tag));
    setSlideshowIncludeTags((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
    );
  };

  const toggleSlideshowExcludeTag = (tag: string) => {
    setSlideshowIncludeTags((current) => current.filter((value) => value !== tag));
    setSlideshowExcludeTags((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
    );
  };

  const clearSetFilters = () => {
    setSelectedTags([]);
    setSetFilter('');
  };

  const clearSlideshowTags = () => {
    setSlideshowIncludeTags([]);
    setSlideshowExcludeTags([]);
  };

  const resetSlideshow = useCallback(() => {
    slideshowPoolRef.current = null;
    slideshowSeenRef.current = new Set();
    slideshowImageSetRef.current = new Map();
    setSlideshowImages([]);
    setSlideshowStarted(false);
  }, []);

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
    let source = cached;
    if (!source) {
      if (activeSet?.id === setId) {
        source = activeImages;
      } else {
        source = await resolveSetImages(set, true);
      }
    }
    if (activeSet?.id === setId) {
      updateFavoriteImagesFromSource(setId, source, next, { keepLength: true });
    }
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

      setMetadata(updated);
      setMetadataDirty(true);
      const saved = await saveMetadataWithInfo(rootId, metadataFileId, updated);
      applyMetadataSnapshot({ data: updated, ...saved });
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

    const updateWithTimestamp: Partial<PoseSet> = {
      ...update,
      updatedAt: update.updatedAt ?? Date.now(),
    };

    if (activeSet?.id === setId) {
      setActiveSet((current) =>
        current ? { ...current, ...updateWithTimestamp } : current
      );
    }

    const base = metadataRef.current;
    const updated: MetadataDocument = {
      version: 1,
      sets: base.sets.map((set) =>
        set.id === setId ? { ...set, ...updateWithTimestamp } : set
      ),
    };

    metadataRef.current = updated;
    setMetadata(updated);
    setMetadataDirty(true);

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
          const saved = await saveMetadataWithInfo(
            rootId,
            metadataFileIdRef.current,
            metadataRef.current
          );
          metadataFileIdRef.current = saved.fileId ?? null;
          applyMetadataSnapshot({ data: metadataRef.current, ...saved });
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
    (setId: string, images: DriveImage[], count: number) =>
      pickNextBatch(setId, images, count, sampleSeenRef.current),
    []
  );

  const pickNextNonFavorites = useCallback(
    (setId: string, images: DriveImage[], count: number) =>
      pickNextBatch(setId, images, count, nonFavoriteSeenRef.current),
    []
  );

  const pickNextFavorites = useCallback(
    (setId: string, images: DriveImage[], count: number) =>
      pickNextBatch(setId, images, count, favoriteSeenRef.current),
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
    async (set: PoseSet, buildIfMissing: boolean, options?: { suppressProgress?: boolean }) => {
      if (!isConnected) {
        return [];
      }
      const suppressProgress = options?.suppressProgress ?? false;
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
      if (!suppressProgress) {
        if (viewerIndexTimerRef.current) {
          viewerIndexTimerRef.current();
          viewerIndexTimerRef.current = null;
        }
        const stopTimer = startIndexTimer(setViewerIndexProgress);
        viewerIndexTimerRef.current = stopTimer;
      }
      const index = await loadIndexItemsForSet(
        resolvedSet,
        buildIfMissing,
        (progress) => {
          if (suppressProgress) {
            return;
          }
          viewerIndexTimerRef.current?.();
          viewerIndexTimerRef.current = null;
          setViewerIndexProgress(formatDownloadProgress(progress));
        },
        (progress) => {
          if (suppressProgress) {
            return;
          }
          setViewerIndexProgress(formatIndexProgress(progress));
        }
      );
      if (!suppressProgress) {
        viewerIndexTimerRef.current?.();
        viewerIndexTimerRef.current = null;
      }
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

  const updateFavoriteImagesFromSource = useCallback(
    (
      setId: string,
      images: DriveImage[],
      favoriteIds: string[],
      options?: { keepLength?: boolean }
    ) => {
      const favorites = filterFavorites(images, favoriteIds);
      if (favorites.length === 0) {
        setFavoriteImages([]);
        favoriteSeenRef.current.set(setId, new Set());
        return;
      }
      const targetLength =
        options?.keepLength && favoriteImages.length > 0
          ? Math.min(favoriteImages.length, favorites.length)
          : Math.min(samplePageSize, favorites.length);
      favoriteSeenRef.current.set(setId, new Set());
      const next = pickNextFavorites(setId, favorites, targetLength);
      setFavoriteImages(next);
    },
    [favoriteImages.length, pickNextFavorites, samplePageSize]
  );

  const hydrateSetExtras = useCallback(
    async (set: PoseSet, buildIfMissing: boolean) => {
      setIsLoadingSample(true);
      setViewerIndexProgress('Loading index…');
      try {
        const images = await resolveSetImages(set, buildIfMissing);
        updateFavoriteImagesFromSource(set.id, images, set.favoriteImageIds ?? []);
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
    [pickNextSample, resolveSetImages, samplePageSize, updateFavoriteImagesFromSource]
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
      setMetadata(updated);
      setMetadataDirty(true);
      const saved = await saveMetadataWithInfo(rootId, metadataFileId, updated);
      applyMetadataSnapshot({ data: updated, ...saved });
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
            updateFavoriteImagesFromSource(set.id, cached, favoriteIds, { keepLength: true });
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
        updateFavoriteImagesFromSource(set.id, images, favoriteIds, { keepLength: true });
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
        updateFavoriteImagesFromSource(set.id, images, favoriteIds, { keepLength: true });
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
    const raw = window.location.pathname;
    lastHistoryPathRef.current = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
  }, []);

  useEffect(() => {
    const handlePop = () => {
      const next = parsePathState();
      skipHistoryRef.current = true;
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
  }, [activeSet, page, syncPathState]);

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
      updateFavoriteImagesFromSource(
        set.id,
        refreshed,
        updatedSet.favoriteImageIds ?? [],
        { keepLength: true }
      );
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
        setSampleImages((current) => appendUniqueImages(current, nextSample));
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsLoadingSample(false);
        setViewerIndexProgress('');
      }
    },
    [activeSet, isConnected, pickNextSample, resolveSetImages]
  );

  const loadNonFavoriteBatch = useCallback(
    async (count: number) => {
      if (!activeSet || !isConnected || count <= 0) {
        return;
      }
      setIsLoadingNonFavorites(true);
      setViewerIndexProgress('Loading images…');
      try {
        const images = await resolveSetImages(activeSet, true);
        const nonFavorites = filterNonFavorites(
          images,
          activeSet.favoriteImageIds ?? []
        );
        if (nonFavorites.length === 0) {
          setNonFavoriteImages([]);
          return;
        }
        const nextBatch = pickNextNonFavorites(activeSet.id, nonFavorites, count);
        if (nextBatch.length === 0) {
          return;
        }
        setNonFavoriteImages((current) => appendUniqueImages(current, nextBatch));
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsLoadingNonFavorites(false);
        setViewerIndexProgress('');
      }
    },
    [activeSet, isConnected, pickNextNonFavorites, resolveSetImages]
  );

  const loadFavoriteBatch = useCallback(
    async (count: number) => {
      if (!activeSet || !isConnected || count <= 0) {
        return;
      }
      setIsLoadingFavorites(true);
      setViewerIndexProgress('Loading favorites…');
      try {
        const images = await resolveSetImages(activeSet, true);
        const favorites = filterFavorites(images, activeSet.favoriteImageIds ?? []);
        if (favorites.length === 0) {
          setFavoriteImages([]);
          return;
        }
        const nextBatch = pickNextFavorites(activeSet.id, favorites, count);
        if (nextBatch.length === 0) {
          return;
        }
        setFavoriteImages((current) => appendUniqueImages(current, nextBatch));
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsLoadingFavorites(false);
        setViewerIndexProgress('');
      }
    },
    [activeSet, isConnected, pickNextFavorites, resolveSetImages]
  );

  const handleLoadMoreSample = useCallback(async () => {
    await loadSampleBatch(samplePageSize);
  }, [loadSampleBatch, samplePageSize]);

  const handleLoadMoreNonFavorites = useCallback(async () => {
    await loadNonFavoriteBatch(samplePageSize);
  }, [loadNonFavoriteBatch, samplePageSize]);

  const handleLoadMoreFavorites = useCallback(async () => {
    await loadFavoriteBatch(samplePageSize);
  }, [loadFavoriteBatch, samplePageSize]);

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

  useEffect(() => {
    if (setViewerTab !== 'favorites' || !activeSet || isLoadingFavorites) {
      return;
    }
    if (favoriteImages.length === 0) {
      void loadFavoriteBatch(samplePageSize);
      return;
    }
    if (sampleColumns <= 1 || favoriteImages.length === 0) {
      return;
    }
    const remainder = favoriteImages.length % sampleColumns;
    if (remainder === 0) {
      return;
    }
    const fill = sampleColumns - remainder;
    void loadFavoriteBatch(fill);
  }, [
    activeSet,
    favoriteImages.length,
    isLoadingFavorites,
    loadFavoriteBatch,
    sampleColumns,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'nonfavorites' || !activeSet || isLoadingNonFavorites) {
      return;
    }
    if (nonFavoriteImages.length === 0) {
      void loadNonFavoriteBatch(samplePageSize);
      return;
    }
    if (sampleColumns <= 1 || nonFavoriteImages.length === 0) {
      return;
    }
    const remainder = nonFavoriteImages.length % sampleColumns;
    if (remainder === 0) {
      return;
    }
    const fill = sampleColumns - remainder;
    void loadNonFavoriteBatch(fill);
  }, [
    activeSet,
    isLoadingNonFavorites,
    loadNonFavoriteBatch,
    nonFavoriteImages.length,
    sampleColumns,
    setViewerTab,
  ]);

  useEffect(() => {
    if (setViewerTab !== 'favorites' || !activeSet) {
      return;
    }
    favoriteSeenRef.current.set(activeSet.id, new Set());
    setFavoriteImages([]);
  }, [activeSet?.id, setViewerTab]);

  useEffect(() => {
    if (setViewerTab !== 'nonfavorites' || !activeSet) {
      return;
    }
    nonFavoriteSeenRef.current.set(activeSet.id, new Set());
    setNonFavoriteImages([]);
  }, [activeSet?.id, setViewerTab]);

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

  const handleLoadAllFavorites = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setIsLoadingFavorites(true);
    setViewerIndexProgress('Loading favorites…');
    try {
      const images = await resolveSetImages(activeSet, true);
      const favorites = filterFavorites(images, activeSet.favoriteImageIds ?? []);
      if (favorites.length === 0) {
        setFavoriteImages([]);
        return;
      }
      const shuffled = shuffleItems(favorites);
      setFavoriteImages(shuffled);
      favoriteSeenRef.current.set(
        activeSet.id,
        new Set(shuffled.map((image) => image.id))
      );
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingFavorites(false);
      setViewerIndexProgress('');
    }
  }, [activeSet, isConnected, resolveSetImages]);

  const handleLoadAllNonFavorites = useCallback(async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setIsLoadingNonFavorites(true);
    setViewerIndexProgress('Loading images…');
    try {
      const images = await resolveSetImages(activeSet, true);
      const nonFavorites = filterNonFavorites(
        images,
        activeSet.favoriteImageIds ?? []
      );
      if (nonFavorites.length === 0) {
        setNonFavoriteImages([]);
        return;
      }
      const shuffled = shuffleItems(nonFavorites);
      setNonFavoriteImages(shuffled);
      nonFavoriteSeenRef.current.set(
        activeSet.id,
        new Set(shuffled.map((image) => image.id))
      );
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoadingNonFavorites(false);
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
        updateFavoriteImagesFromSource(activeSet.id, cached, favoriteIds, { keepLength: true });
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
        updateFavoriteImagesFromSource(activeSet.id, images, favoriteIds, { keepLength: true });
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
  const nonFavoritesCount =
    totalImagesKnown !== undefined ? Math.max(0, totalImagesKnown - favoritesCount) : undefined;
  const favoritesRemaining = Math.max(0, favoritesCount - favoriteImages.length);
  const favoritesPendingExtra = Math.max(0, Math.min(samplePageSize, favoritesRemaining));
  const sampleRemaining =
    totalImagesKnown !== undefined
      ? Math.max(0, totalImagesKnown - sampleImages.length)
      : undefined;
  const samplePendingExtra =
    sampleRemaining !== undefined
      ? Math.max(0, Math.min(samplePageSize, sampleRemaining))
      : samplePageSize;
  const nonFavoritesRemaining =
    nonFavoritesCount !== undefined
      ? Math.max(0, nonFavoritesCount - nonFavoriteImages.length)
      : undefined;
  const nonFavoritesPendingExtra =
    nonFavoritesRemaining !== undefined
      ? Math.max(0, Math.min(samplePageSize, nonFavoritesRemaining))
      : samplePageSize;

  const handleSetViewerTab = useCallback(
    (tab: 'samples' | 'favorites' | 'nonfavorites' | 'all') => {
      setSetViewerTab(tab);
      if (tab === 'all' && activeSet && activeImages.length === 0 && !isLoadingImages) {
        setImageLimit(allPageSize);
        void loadSetImages(activeSet, allPageSize, false);
      }
    },
    [activeImages.length, activeSet, allPageSize, isLoadingImages]
  );

  const buildSlideshowPool = useCallback(async () => {
    if (!isConnected) {
      return [];
    }
    const results: DriveImage[] = [];
    const map = new Map<string, string>();
    const totalSets = slideshowSets.length;
    let processed = 0;
    for (const set of slideshowSets) {
      processed += 1;
      setViewerIndexProgress(`Loading indexes ${processed}/${totalSets}`);
      const images = await resolveSetImages(set, true, { suppressProgress: true });
      if (images.length === 0) {
        continue;
      }
      if (slideshowFavoriteFilter === 'favorites') {
        const favorites = set.favoriteImageIds ?? [];
        const filtered = filterFavorites(images, favorites);
        for (const image of filtered) {
          map.set(image.id, set.id);
        }
        results.push(...filtered);
      } else if (slideshowFavoriteFilter === 'nonfavorites') {
        const favorites = set.favoriteImageIds ?? [];
        const filtered = filterNonFavorites(images, favorites);
        for (const image of filtered) {
          map.set(image.id, set.id);
        }
        results.push(...filtered);
      } else {
        for (const image of images) {
          map.set(image.id, set.id);
        }
        results.push(...images);
      }
    }
    slideshowImageSetRef.current = map;
    setViewerIndexProgress('');
    return results;
  }, [isConnected, resolveSetImages, slideshowFavoriteFilter, slideshowSets]);

  const loadSlideshowBatch = useCallback(
    async (count: number, options?: { openModal?: boolean }) => {
      if (!isConnected || count <= 0) {
        return;
      }
      setIsLoadingSlideshow(true);
      setViewerIndexProgress('Loading slideshow…');
      try {
        const key = JSON.stringify({
          include: slideshowTagFilters.include,
          exclude: slideshowTagFilters.exclude,
          favorite: slideshowFavoriteFilter,
        });
        if (!slideshowPoolRef.current || slideshowPoolRef.current.key !== key) {
          slideshowPoolRef.current = {
            key,
            images: await buildSlideshowPool(),
          };
          slideshowSeenRef.current = new Set();
          setSlideshowImages([]);
        }
        const pool = slideshowPoolRef.current.images;
        if (pool.length === 0) {
          return;
        }
        const seen = slideshowSeenRef.current;
        if (seen.size >= pool.length) {
          seen.clear();
        }
        const available = pool.filter((image) => !seen.has(image.id));
        const batch = pickRandom(available, Math.min(count, available.length));
        for (const image of batch) {
          seen.add(image.id);
        }
        let mergedResult: DriveImage[] | null = null;
        setSlideshowImages((current) => {
          const merged = appendUniqueImages(current, batch);
          if (options?.openModal && merged.length > 0 && current.length === 0) {
            openModalRef.current(merged[0].id, merged, 'Slideshow');
          }
          mergedResult = merged;
          return merged;
        });
        if (mergedResult) {
          return mergedResult;
        }
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsLoadingSlideshow(false);
        setViewerIndexProgress('');
      }
    },
    [
      buildSlideshowPool,
      isConnected,
      slideshowFavoriteFilter,
      slideshowTagFilters.exclude,
      slideshowTagFilters.include,
    ]
  );

  const modalDeps = {
    activeSet,
    setsById,
    activeImages,
    setActiveImages,
    setImageLimit,
    allPageSize,
    samplePageSize,
    favoriteImages,
    setFavoriteImages,
    setSampleImages,
    setNonFavoriteImages,
    readImageListCache,
    filterFavorites,
    filterNonFavorites,
    pickNextSample,
    pickNextFavorites,
    pickNextNonFavorites,
    resolveSetImages,
    updateFavoriteImagesFromSource,
    handleLoadMoreImages,
    isLoadingMore,
    toggleFavoriteImage,
    loadSlideshowBatch,
    slideshowImagesRef,
    slideshowImageSetRef,
    slideshowPageSize,
    prefetchThumbs,
    setError,
  };

  const handleLoadMoreSlideshow = useCallback(async () => {
    await loadSlideshowBatch(slideshowPageSize);
  }, [loadSlideshowBatch, slideshowPageSize]);

  const handleLoadMoreClick = useCallback(
    (handler: () => void | Promise<void>) =>
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.blur();
        void handler();
      },
    []
  );

  useEffect(() => {
    if (page !== 'slideshow') {
      return;
    }
    resetSlideshow();
  }, [page, resetSlideshow]);

  useEffect(() => {
    if (page !== 'slideshow') {
      return;
    }
    resetSlideshow();
  }, [
    page,
    resetSlideshow,
    slideshowFavoriteFilter,
    slideshowTagFilters.exclude,
    slideshowTagFilters.include,
  ]);

  const handleStartSlideshow = useCallback(async () => {
    setSlideshowStarted(true);
    if (slideshowImages.length > 0) {
      openModalRef.current(slideshowImages[0].id, slideshowImages, 'Slideshow');
      return;
    }
    await loadSlideshowBatch(slideshowPageSize, { openModal: true });
  }, [loadSlideshowBatch, slideshowImages, slideshowPageSize]);

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

  return (
    <ModalStateProvider
      deps={modalDeps}
      thumbSize={THUMB_SIZE}
      onOpenModalReady={(modalOpen) => {
        openModalRef.current = modalOpen;
      }}
    >
      <div className={`app ${isLoadingMetadata ? 'app--loading' : ''}`}>
        <AppHeader
          page={page}
          activeSet={activeSet}
          isConnected={isConnected}
          onConnect={handleConnect}
          onNavigate={setPage}
        />
        {isLoadingMetadata ? (
          <div className="loading-overlay loading-overlay--full">
            <div className="loading-card">Loading metadata…</div>
          </div>
        ) : null}

      {page === 'create' ? (
        <CreateSetPage
          isConnected={isConnected}
          rootId={rootId}
          isScanning={isScanning}
          scanCount={scanCount}
          scanPath={scanPath}
          folderFilter={folderFilter}
          onFolderFilterChange={setFolderFilter}
          hiddenFolders={hiddenFolders}
          showHiddenFolders={showHiddenFolders}
          onToggleHiddenFolders={() => setShowHiddenFolders((value) => !value)}
          onShowFolder={handleShowFolder}
          filteredFolders={filteredFolders}
          selectedFolder={selectedFolder}
          onSelectFolder={handleSelectFolder}
          onHideFolder={handleHideFolder}
          error={error}
          isSaving={isSaving}
          setName={setName}
          onSetNameChange={setSetName}
          setTags={setTags}
          onSetTagsChange={setSetTags}
          availableTags={availableTags}
          sortedQuickTags={sortedQuickTags}
          selectedCreateTags={selectedCreateTags}
          onToggleCreateTag={toggleCreateTag}
          previewImages={previewImages}
          previewCount={previewCount}
          isLoadingPreview={isLoadingPreview}
          previewIndexProgress={previewIndexProgress}
          onRefreshPreview={handleRefreshPreview}
          onCreateSet={handleCreateSet}
          onScanFolders={handleScan}
          thumbSize={THUMB_SIZE}
        />
      ) : null}

      {page === 'overview' ? (
        <OverviewPage
          isConnected={isConnected}
          setFilter={setFilter}
          onSetFilterChange={setSetFilter}
          setSort={setSort}
          onSetSortChange={setSetSort}
          selectedTags={selectedTags}
          sortedTags={sortedTags}
          tagCounts={tagCounts}
          onToggleFilterTag={toggleFilterTag}
          onClearFilters={clearSetFilters}
          filteredSets={filteredSets}
          totalSets={metadata.sets.length}
          onOpenSet={handleOpenSet}
          cardThumbSize={CARD_THUMB_SIZE}
        />
      ) : null}

      {page === 'slideshow' ? (
        <SlideshowPage
          isConnected={isConnected}
          slideshowSets={slideshowSets}
          slideshowFavoriteFilter={slideshowFavoriteFilter}
          onSlideshowFavoriteFilterChange={setSlideshowFavoriteFilter}
          onStartSlideshow={handleStartSlideshow}
          isLoadingSlideshow={isLoadingSlideshow}
          onClearSlideshowTags={clearSlideshowTags}
          sortedTags={sortedTags}
          slideshowIncludeTags={slideshowIncludeTags}
          slideshowExcludeTags={slideshowExcludeTags}
          onToggleIncludeTag={toggleSlideshowIncludeTag}
          onToggleExcludeTag={toggleSlideshowExcludeTag}
          slideshowStarted={slideshowStarted}
          viewerIndexProgress={viewerIndexProgress}
          slideshowImages={slideshowImages}
          slideshowImageSetMap={slideshowImageSetRef.current}
          setsById={setsById}
          onToggleFavoriteImage={toggleFavoriteImage}
          thumbSize={THUMB_SIZE}
          onLoadMoreSlideshow={handleLoadMoreSlideshow}
          onLoadMoreClick={handleLoadMoreClick}
          slideshowPageSize={slideshowPageSize}
        />
      ) : null}

      {page === 'set' ? (
        <SetViewerPage
          activeSet={activeSet}
          isConnected={isConnected}
          isSaving={isSaving}
          isRefreshingSet={isRefreshingSet}
          setViewerTab={setViewerTab}
          onSetViewerTab={handleSetViewerTab}
          viewerQuickTags={viewerQuickTags}
          onToggleActiveSetTag={toggleActiveSetTag}
          favoriteIds={favoriteIds}
          favoritesCount={favoritesCount}
          nonFavoritesCount={nonFavoritesCount}
          allImagesCount={allImagesCount}
          sampleImages={sampleImages}
          favoriteImages={favoriteImages}
          nonFavoriteImages={nonFavoriteImages}
          activeImages={activeImages}
          viewerIndexProgress={viewerIndexProgress}
          isLoadingSample={isLoadingSample}
          isLoadingFavorites={isLoadingFavorites}
          isLoadingNonFavorites={isLoadingNonFavorites}
          isLoadingImages={isLoadingImages}
          isLoadingMore={isLoadingMore}
          totalImagesKnown={totalImagesKnown}
          samplePendingExtra={samplePendingExtra}
          nonFavoritesPendingExtra={nonFavoritesPendingExtra}
          favoritesPendingExtra={favoritesPendingExtra}
          pendingExtra={pendingExtra}
          remainingImages={remainingImages}
          onLoadMoreSample={handleLoadMoreSample}
          onLoadAllSample={handleLoadAllSample}
          onLoadMoreNonFavorites={handleLoadMoreNonFavorites}
          onLoadAllNonFavorites={handleLoadAllNonFavorites}
          onLoadMoreFavorites={handleLoadMoreFavorites}
          onLoadAllFavorites={handleLoadAllFavorites}
          onLoadMoreImages={handleLoadMoreImages}
          onLoadAllPreloaded={handleLoadAllPreloaded}
          onToggleFavoriteImage={toggleFavoriteImage}
          onSetThumbnail={handleSetThumbnail}
          onUpdateSetName={(value) => {
            if (!activeSet) {
              return;
            }
            void handleUpdateSet(activeSet.id, {
              name: value.trim() || activeSet.name,
            });
          }}
          onRefreshSet={handleRefreshSet}
          onDeleteSet={handleDeleteSet}
          onLoadMoreClick={handleLoadMoreClick}
          thumbSize={THUMB_SIZE}
          viewerThumbSize={VIEWER_THUMB_SIZE}
          sampleGridRef={sampleGridRef}
          allGridRef={allGridRef}
          sectionRef={setViewerRef}
        />
      ) : null}

        <ToastStack toasts={toasts} />
        <ScrollControls
          canScrollUp={canScrollUp}
          canScrollDown={canScrollDown}
          onScrollTop={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          onScrollBottom={() =>
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: 'smooth',
            })
          }
        />
      </div>
    </ModalStateProvider>
  );
}
