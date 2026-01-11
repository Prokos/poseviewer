import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { listFolderPaths, type FolderPath } from './drive/scan';
import { driveRotateImage } from './drive/api';
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
import { hashStringToUnit, pickRandom, shuffleItems, shuffleItemsSeeded } from './utils/random';
import { formatDownloadProgress, formatIndexProgress, startIndexTimer } from './utils/progress';
import { createProxyThumbUrl } from './utils/driveUrls';
import { useImageCache } from './features/imageCache/ImageCacheContext';
import {
  readImageListCache,
  readMetadataCache,
  readMetadataDirtyFlag,
  writeImageListCache,
  writeMetadataCache,
  writeMetadataDirtyFlag,
} from './utils/cache';
import { filterImagesByFavoriteStatus, filterImagesByHiddenStatus } from './utils/imageSampling';
import { AppHeader } from './components/AppHeader';
import { ToastStack } from './components/ToastStack';
import { ScrollControls } from './components/ScrollControls';
import { CreateSetPage } from './pages/CreateSetPage';
import { OverviewPage } from './pages/OverviewPage';
import { SlideshowPage } from './pages/SlideshowPage';
import { SetViewerPage } from './pages/SetViewerPage';
import { ModalActionsProvider } from './features/modal/ModalContext';
import { ModalStateProvider } from './features/modal/ModalStateProvider';
import { useSetViewerGrids } from './features/setViewer/useSetViewerGrids';
import { SetViewerProvider } from './features/setViewer/SetViewerContext';
import { SlideshowProvider } from './features/slideshow/SlideshowContext';
import { useSlideshowState } from './features/slideshow/useSlideshowState';

const ROOT_FOLDER_IDS = (() => {
  const raw = import.meta.env.VITE_ROOT_FOLDER_IDS as string | undefined;
  const legacy = import.meta.env.VITE_ROOT_FOLDER_ID as string | undefined;
  const ids = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length === 0 && legacy) {
    ids.push(legacy);
  }
  return Array.from(new Set(ids));
})();
const DEFAULT_ROOT_ID = ROOT_FOLDER_IDS[0] ?? '';
const IMAGE_PAGE_SIZE = 96;
const THUMB_SIZE = 320;
const CARD_THUMB_SIZE = 500;
const VIEWER_THUMB_SIZE = CARD_THUMB_SIZE;
const THUMB_PREFETCH_MAX_IN_FLIGHT = 3;
const THUMB_PREFETCH_MAX_QUEUE = 80;
const emptyFolders: FolderPath[] = [];
const EXPLICIT_TAG = 'explicit';

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
  const { cacheKey, bumpCacheKey } = useImageCache();
  const [isConnected, setIsConnected] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<string>('');
  const rootId = DEFAULT_ROOT_ID;
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
  const [setSort, setSetSort] = useLocalStorage('poseviewer-set-sort', 'random');
  const defaultSetSortSeed = useMemo(() => `${Math.random()}`, []);
  const [setSortSeed, setSetSortSeed] = useLocalStorage(
    'poseviewer-set-sort-seed',
    defaultSetSortSeed
  );
  const [slideshowIncludeTags, setSlideshowIncludeTags] = useState<string[]>([]);
  const [slideshowExcludeTags, setSlideshowExcludeTags] = useState<string[]>([]);
  const [slideshowFavoriteFilter, setSlideshowFavoriteFilter] = useState<
    'all' | 'favorites' | 'nonfavorites'
  >('all');
  const [showExplicit, setShowExplicit] = useState(false);
  const titleClickCountRef = useRef(0);
  const [selectedFolder, setSelectedFolder] = useState<FolderPath | null>(null);
  const [setName, setSetName] = useState('');
  const [setTags, setSetTags] = useState('');
  const [activeSet, setActiveSet] = useState<PoseSet | null>(null);
  const [activeImages, setActiveImages] = useState<DriveImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRotatingSet, setIsRotatingSet] = useState(false);
  const [rotateSetProgress, setRotateSetProgress] = useState<null | {
    total: number;
    completed: number;
    angle: 90 | -90;
  }>(null);
  const [setViewerTab, setSetViewerTab] = useState<
    'samples' | 'favorites' | 'nonfavorites' | 'hidden' | 'all'
  >('all');
  const [viewerSort, setViewerSort] = useLocalStorage<'random' | 'chronological'>(
    'poseviewer-viewer-sort',
    'random'
  );
  const defaultViewerSortSeed = useMemo(() => `${Math.random()}`, []);
  const [viewerSortSeed, setViewerSortSeed] = useLocalStorage(
    'poseviewer-viewer-sort-seed',
    defaultViewerSortSeed
  );
  const [allColumns, setAllColumns] = useState(1);
  const [previewImages, setPreviewImages] = useState<DriveImage[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewIndexProgress, setPreviewIndexProgress] = useState('');
  const [imageLoadStatus, setImageLoadStatus] = useState('');
  const [viewerIndexProgress, setViewerIndexProgress] = useState('');
  const [imageLimit, setImageLimit] = useState(IMAGE_PAGE_SIZE);
  const [isRefreshingSet, setIsRefreshingSet] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const allGridRef = useRef<HTMLDivElement | null>(null);
  const allImagesOrderRef = useRef<
    Map<string, { mode: 'random' | 'chronological'; ordered: DriveImage[]; seed: string | null }>
  >(new Map());
  const resetFavoritesRef = useRef<null | (() => void)>(null);
  const resetNonFavoritesRef = useRef<null | (() => void)>(null);
  const resetHiddenRef = useRef<null | (() => void)>(null);
  const metadataSaveTimeoutRef = useRef<number | null>(null);
  const pendingSavePromiseRef = useRef<Promise<void> | null>(null);
  const pendingSaveResolveRef = useRef<(() => void) | null>(null);
  const initialNavRef = useRef(parsePathState());
  const appliedNavRef = useRef(false);
  const metadataLoadedRef = useRef(false);
  const pendingSetIdRef = useRef<string | null>(null);
  const pendingSetFetchAttemptedRef = useRef(false);
  const prefetchedThumbsRef = useRef<Set<string>>(new Set());
  const thumbPrefetchQueueRef = useRef<string[]>([]);
  const thumbPrefetchQueuedRef = useRef<Set<string>>(new Set());
  const thumbPrefetchInFlightRef = useRef(0);
  const thumbPrefetchDesiredRef = useRef<Set<string>>(new Set());
  const thumbPrefetchAbortRef = useRef<Map<string, AbortController>>(new Map());
  const prebuiltIndexRef = useRef<{
    folderId: string;
    items: { id: string; name: string }[];
    fileId: string | null;
  } | null>(null);
  const viewerIndexTimerRef = useRef<(() => void) | null>(null);

  const allPageSize = Math.max(1, Math.ceil(IMAGE_PAGE_SIZE / allColumns) * allColumns);
  const slideshowPageSize = 48;
  const metadataRef = useRef<MetadataDocument>(metadata);
  const metadataFileIdRef = useRef<string | null>(metadataFileId);
  const metadataInfoRef = useRef<MetadataInfo>(metadataInfo);
  const metadataDirtyRef = useRef(metadataDirty);
  const openModalRef = useRef<
    (imageId: string, images: DriveImage[], label: string, index?: number) => void
  >(() => {});
  const openModal = useCallback(
    (imageId: string, images: DriveImage[], label: string, index?: number) => {
      openModalRef.current(imageId, images, label, index);
    },
    []
  );
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

  const isExplicitSet = useCallback(
    (set: PoseSet) => set.tags.some((tag) => tag.toLowerCase() === EXPLICIT_TAG),
    []
  );

  const visibleSets = useMemo(() => {
    if (showExplicit) {
      return metadata.sets;
    }
    return metadata.sets.filter((set) => !isExplicitSet(set));
  }, [isExplicitSet, metadata.sets, showExplicit]);

  const handleTitleClick = useCallback(() => {
    titleClickCountRef.current += 1;
    if (titleClickCountRef.current >= 5) {
      titleClickCountRef.current = 0;
      setShowExplicit((current) => !current);
    }
  }, []);

  const filteredFolders = useMemo(() => {
    const query = folderFilter.trim().toLowerCase();
    const setPrefixes = visibleSets.map((set) => set.rootPath);
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
  }, [folderFilter, folderPaths, hiddenFolders, visibleSets]);

  const setRandomWeight = useCallback(
    (setId: string) => hashStringToUnit(`${setSortSeed}|${setId}`),
    [setSortSeed]
  );

  const filteredSets = useMemo(() => {
    const query = setFilter.trim().toLowerCase();
    const selected = selectedTags.map((tag) => tag.toLowerCase());
    const matches = visibleSets.filter((set) => {
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
      case 'random':
        sorted.sort((a, b) => setRandomWeight(a.id) - setRandomWeight(b.id));
        break;
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
  }, [selectedTags, setFilter, setRandomWeight, setSort, visibleSets]);

  const prevSetSortRef = useRef(setSort);
  useEffect(() => {
    if (setSort === 'random' && prevSetSortRef.current !== 'random') {
      setSetSortSeed(`${Math.random()}`);
    }
    prevSetSortRef.current = setSort;
  }, [setSort, setSetSortSeed]);

  const prevViewerSortRef = useRef(viewerSort);
  useEffect(() => {
    if (viewerSort === 'random' && prevViewerSortRef.current !== 'random') {
      setViewerSortSeed(`${Math.random()}`);
    }
    prevViewerSortRef.current = viewerSort;
  }, [setViewerSortSeed, viewerSort]);

  const setsById = useMemo(() => {
    return new Map(visibleSets.map((set) => [set.id, set]));
  }, [visibleSets]);

  const slideshowTagFilters = useMemo(() => {
    const include = slideshowIncludeTags.map((tag) => tag.toLowerCase());
    const exclude = slideshowExcludeTags.map((tag) => tag.toLowerCase());
    return { include, exclude };
  }, [slideshowExcludeTags, slideshowIncludeTags]);

  const slideshowSets = useMemo(() => {
    const { include, exclude } = slideshowTagFilters;
    return visibleSets.filter((set) => {
      const tags = set.tags.map((tag) => tag.toLowerCase());
      if (include.length > 0 && !include.every((tag) => tags.includes(tag))) {
        return false;
      }
      if (exclude.length > 0 && exclude.some((tag) => tags.includes(tag))) {
        return false;
      }
      return true;
    });
  }, [slideshowTagFilters, visibleSets]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const set of visibleSets) {
      for (const tag of set.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [visibleSets]);

  const tagUsageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const set of visibleSets) {
      for (const tag of set.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  }, [visibleSets]);

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
    const baseSet = visibleSets.filter((set) => matchesQuery(set));

    for (const tag of availableTags) {
      const lower = tag.toLowerCase();
      const nextTags = selected.includes(lower)
        ? selected
        : [...selected, lower];
      counts[tag] = baseSet.filter((set) => matchesSelected(set, nextTags)).length;
    }
    return counts;
  }, [availableTags, selectedTags, setFilter, visibleSets]);

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
  }, [cacheKey]);

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
      const maxCount = 50;
      const folders: FolderPath[] = [];
      for (const scanRootId of ROOT_FOLDER_IDS) {
        if (folders.length >= maxCount) {
          break;
        }
        const baseCount = folders.length;
        const next = await listFolderPaths(scanRootId, {
          excludeIds,
          excludePaths,
          ignoreIds,
          ignorePaths,
          maxCount: maxCount - baseCount,
          onProgress: (count, path) => {
            setScanCount(baseCount + count);
            setScanPath(path);
          },
        });
        folders.push(...next);
      }
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
      setSetViewerTab('all');
    }
  }, [activeSet?.id]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    if (setViewerTab !== 'all' || !activeSet || isLoadingImages || isLoadingMore) {
      return;
    }
    if (activeImages.length === 0) {
      setImageLimit(allPageSize);
      void loadSetImages(activeSet, allPageSize, false);
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
    isConnected,
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
    const updateAll = () => setAllColumns(readColumns(allGridRef.current));
    updateAll();
    const observer = new ResizeObserver(() => {
      updateAll();
    });
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
      source = await resolveSetImages(set, true);
    }
    if (activeSet?.id === setId) {
      updateFavoriteImagesFromSource(setId, source, next, set.hiddenImageIds ?? [], {
        keepLength: true,
      });
    }
    await handleUpdateSet(setId, { favoriteImageIds: next });
  };

  const toggleHiddenImage = async (setId: string, imageId: string) => {
    const set = metadata.sets.find((item) => item.id === setId);
    if (!set) {
      return;
    }
    const current = set.hiddenImageIds ?? [];
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
    if (activeSet?.id === setId && source) {
      updateFavoriteImagesFromSource(setId, source, set.favoriteImageIds ?? [], next, {
        keepLength: true,
      });
      updateHiddenImagesFromSource(setId, source, set.favoriteImageIds ?? [], next, {
        keepLength: true,
      });
      setSampleImages((currentImages) =>
        filterImagesByHiddenStatus(currentImages, next, 'visible')
      );
      const hiddenSet = new Set(next);
      const visible = filterImagesByHiddenStatus(source, next, 'visible');
      let ordered = visible;
      if (viewerSort === 'random') {
        const cached = allImagesOrderRef.current.get(setId);
        if (cached && cached.mode === 'random' && cached.seed === viewerSortSeed) {
          const sourceIds = new Set(source.map((image) => image.id));
          const hasMissing = cached.ordered.some((image) => !sourceIds.has(image.id));
          if (hasMissing) {
            const refreshed = shuffleItemsSeeded(source, `${viewerSortSeed}|${setId}`);
            allImagesOrderRef.current.set(setId, {
              mode: 'random',
              ordered: refreshed,
              seed: viewerSortSeed,
            });
            ordered = refreshed.filter((image) => !hiddenSet.has(image.id));
          } else if (cached.ordered.length < source.length) {
            const known = new Set(cached.ordered.map((image) => image.id));
            const additions = source.filter((image) => !known.has(image.id));
            const extended = cached.ordered.concat(
              shuffleItemsSeeded(additions, `${viewerSortSeed}|${setId}|append`)
            );
            allImagesOrderRef.current.set(setId, {
              mode: 'random',
              ordered: extended,
              seed: viewerSortSeed,
            });
            ordered = extended.filter((image) => !hiddenSet.has(image.id));
          } else {
            ordered = cached.ordered.filter((image) => !hiddenSet.has(image.id));
          }
        } else {
          const seeded = shuffleItemsSeeded(source, `${viewerSortSeed}|${setId}`);
          allImagesOrderRef.current.set(setId, {
            mode: 'random',
            ordered: seeded,
            seed: viewerSortSeed,
          });
          ordered = seeded.filter((image) => !hiddenSet.has(image.id));
        }
      } else {
        ordered = getOrderedAllImages(setId, visible);
      }
      setActiveImages(ordered.slice(0, imageLimit));
    }
    await handleUpdateSet(setId, { hiddenImageIds: next });
  };

  const rotateImage = useCallback(async (fileId: string, angle: 90 | -90) => {
    await driveRotateImage(fileId, angle);
  }, []);

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
    const prebuilt = prebuiltIndexRef.current;
    if (!prebuilt || prebuilt.folderId !== selectedFolder.id) {
      return;
    }
    setIsLoadingPreview(true);
    setPreviewIndexProgress('');
    const images = indexItemsToImages(prebuilt.items);
    setPreviewImages(pickRandom(images, 8));
    setPreviewCount(images.length);
    setIsLoadingPreview(false);
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

  const handleRotateSet = useCallback(
    async (set: PoseSet, angle: 90 | -90) => {
      if (isRotatingSet) {
        return;
      }
      setIsRotatingSet(true);
      setRotateSetProgress({ total: 0, completed: 0, angle });
      try {
        const images = await resolveSetImages(set, true);
        if (images.length === 0) {
          setError('No images found in this set.');
          setRotateSetProgress(null);
          return;
        }
        const ok = window.confirm(
          `Rotate ${images.length} image${images.length === 1 ? '' : 's'} ${
            angle === 90 ? 'clockwise' : 'counter clockwise'
          }?`
        );
        if (!ok) {
          setRotateSetProgress(null);
          return;
        }
        const total = images.length;
        const concurrency = Math.min(4, total);
        let completed = 0;
        let nextIndex = 0;
        setRotateSetProgress({ total, completed, angle });

        const wait = (ms: number) =>
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, ms);
          });

        const rotateWithRetry = async (imageId: string) => {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
              await rotateImage(imageId, angle);
              return;
            } catch (error) {
              const message = (error as Error).message ?? '';
              const shouldRetry = /429|503|timeout/i.test(message);
              if (!shouldRetry || attempt >= 3) {
                throw error;
              }
              await wait(400 * 2 ** attempt);
            }
          }
        };

        const worker = async () => {
          while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= total) {
              return;
            }
            const image = images[index];
            await rotateWithRetry(image.id);
            completed += 1;
            setRotateSetProgress({ total, completed, angle });
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        bumpCacheKey();
        window.setTimeout(() => {
          setRotateSetProgress(null);
        }, 1200);
      } catch (error) {
        setError((error as Error).message);
        setRotateSetProgress(null);
      } finally {
        setIsRotatingSet(false);
      }
    },
    [bumpCacheKey, isRotatingSet, resolveSetImages, rotateImage, setError]
  );

  const getOrderedAllImages = useCallback(
    (setId: string, images: DriveImage[]) => {
      if (viewerSort === 'chronological') {
        allImagesOrderRef.current.set(setId, { mode: viewerSort, ordered: images, seed: null });
        return images;
      }
      const cached = allImagesOrderRef.current.get(setId);
      if (cached && cached.mode === viewerSort && cached.seed === viewerSortSeed) {
        if (cached.ordered.length === images.length) {
          return cached.ordered;
        }
        const currentIds = new Set(images.map((image) => image.id));
        const missing = cached.ordered.some((image) => !currentIds.has(image.id));
        if (missing) {
          const reordered = shuffleItemsSeeded(images, `${viewerSortSeed}|${setId}`);
          allImagesOrderRef.current.set(setId, {
            mode: viewerSort,
            ordered: reordered,
            seed: viewerSortSeed,
          });
          return reordered;
        }
        const known = new Set(cached.ordered.map((image) => image.id));
        const additions = images.filter((image) => !known.has(image.id));
        if (additions.length === 0) {
          return cached.ordered;
        }
        const extended = cached.ordered.concat(
          shuffleItemsSeeded(additions, `${viewerSortSeed}|${setId}|append`)
        );
        allImagesOrderRef.current.set(setId, {
          mode: viewerSort,
          ordered: extended,
          seed: viewerSortSeed,
        });
        return extended;
      }
      const ordered =
        viewerSort === 'random'
          ? shuffleItemsSeeded(images, `${viewerSortSeed}|${setId}`)
          : images;
      allImagesOrderRef.current.set(setId, {
        mode: viewerSort,
        ordered,
        seed: viewerSort === 'random' ? viewerSortSeed : null,
      });
      return ordered;
    },
    [viewerSort, viewerSortSeed]
  );

  const {
    sampleImages,
    setSampleImages,
    favoriteImages,
    setFavoriteImages,
    nonFavoriteImages,
    setNonFavoriteImages,
    hiddenImages,
    setHiddenImages,
    isLoadingSample,
    isLoadingFavorites,
    isLoadingNonFavorites,
    isLoadingHidden,
    samplePageSize,
    sampleGridRef,
    pickNext,
    updateFavoriteImagesFromSource,
    updateHiddenImagesFromSource,
    handleLoadMoreSample,
    handleLoadAllSample,
    handleLoadMoreFavorites,
    handleLoadAllFavorites,
    handleLoadMoreNonFavorites,
    handleLoadAllNonFavorites,
    handleLoadMoreHidden,
    handleLoadAllHidden,
    handleResetFavorites,
    handleResetNonFavorites,
    handleResetHidden,
  } = useSetViewerGrids({
    activeSet,
    isConnected,
    setViewerTab,
    viewerSort,
    viewerSortSeed,
    resolveSetImages,
    setError,
    setViewerIndexProgress,
    sampleBaseCount: 48,
  });

  useEffect(() => {
    resetFavoritesRef.current = () => {
      void handleResetFavorites();
    };
    resetNonFavoritesRef.current = () => {
      void handleResetNonFavorites();
    };
    resetHiddenRef.current = () => {
      void handleResetHidden();
    };
  }, [handleResetFavorites, handleResetHidden, handleResetNonFavorites]);

  useEffect(() => {
    allImagesOrderRef.current.clear();
    if (!activeSet) {
      return;
    }
    if (setViewerTab === 'all') {
      setImageLimit(allPageSize);
      void loadSetImages(activeSet, allPageSize, false);
      return;
    }
    if (setViewerTab === 'favorites') {
      resetFavoritesRef.current?.();
      return;
    }
    if (setViewerTab === 'nonfavorites') {
      resetNonFavoritesRef.current?.();
      return;
    }
    if (setViewerTab === 'hidden') {
      resetHiddenRef.current?.();
    }
  }, [activeSet?.id, allPageSize, setViewerTab, viewerSort]);

  const {
    slideshowImages,
    isLoadingSlideshow,
    slideshowStarted,
    slideshowImagesRef,
    slideshowImageSetRef,
    loadSlideshowBatch,
    handleLoadMoreSlideshow,
    handleStartSlideshow,
  } = useSlideshowState({
    page,
    isConnected,
    slideshowSets,
    slideshowFavoriteFilter,
    slideshowTagFilters,
    resolveSetImages,
    setViewerIndexProgress,
    setError,
    openModalRef,
    slideshowPageSize,
  });

  const flushThumbPrefetch = useCallback(() => {
    while (
      thumbPrefetchInFlightRef.current < THUMB_PREFETCH_MAX_IN_FLIGHT &&
      thumbPrefetchQueueRef.current.length > 0
    ) {
      const nextId = thumbPrefetchQueueRef.current.shift();
      if (!nextId) {
        continue;
      }
      thumbPrefetchQueuedRef.current.delete(nextId);
      if (prefetchedThumbsRef.current.has(nextId)) {
        continue;
      }
      if (!thumbPrefetchDesiredRef.current.has(nextId)) {
        continue;
      }
      prefetchedThumbsRef.current.add(nextId);
      thumbPrefetchInFlightRef.current += 1;
      const controller = new AbortController();
      thumbPrefetchAbortRef.current.set(nextId, controller);
      const url = createProxyThumbUrl(nextId, THUMB_SIZE, cacheKey);
      const finalize = () => {
        thumbPrefetchInFlightRef.current = Math.max(
          0,
          thumbPrefetchInFlightRef.current - 1
        );
        thumbPrefetchAbortRef.current.delete(nextId);
        flushThumbPrefetch();
      };
      fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Thumb preload failed: ${response.status}`);
          }
          return response.blob();
        })
        .then(() => {
          finalize();
        })
        .catch((error) => {
          if ((error as Error).name === 'AbortError') {
            prefetchedThumbsRef.current.delete(nextId);
            finalize();
            return;
          }
          prefetchedThumbsRef.current.delete(nextId);
          finalize();
        });
    }
  }, []);

  const prefetchThumbs = useCallback(
    (images: DriveImage[]) => {
      const nextDesired = new Set<string>();
      for (const image of images) {
        nextDesired.add(image.id);
      }
      thumbPrefetchDesiredRef.current = nextDesired;

      thumbPrefetchQueueRef.current = thumbPrefetchQueueRef.current.filter((id) =>
        nextDesired.has(id)
      );
      thumbPrefetchQueuedRef.current.forEach((id) => {
        if (!nextDesired.has(id)) {
          thumbPrefetchQueuedRef.current.delete(id);
        }
      });

      thumbPrefetchAbortRef.current.forEach((controller, id) => {
        if (!nextDesired.has(id)) {
          controller.abort();
          thumbPrefetchAbortRef.current.delete(id);
        }
      });

      for (const id of nextDesired) {
        if (prefetchedThumbsRef.current.has(id)) {
          continue;
        }
        if (thumbPrefetchQueuedRef.current.has(id)) {
          continue;
        }
        if (thumbPrefetchQueueRef.current.length >= THUMB_PREFETCH_MAX_QUEUE) {
          break;
        }
        thumbPrefetchQueueRef.current.push(id);
        thumbPrefetchQueuedRef.current.add(id);
      }
      flushThumbPrefetch();
    },
    [flushThumbPrefetch]
  );

  const handleSetThumbnail = async (setId: string, fileId: string) => {
    await handleUpdateSet(setId, { thumbnailFileId: fileId, thumbnailPos: 50 });
  };

  const handleSetThumbnailPosition = useCallback(
    (setId: string, pos: number) => {
      void handleUpdateSet(setId, { thumbnailPos: pos });
    },
    [handleUpdateSet]
  );

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
      const hiddenIds = set.hiddenImageIds ?? [];
      if (cached && cached.length >= limit) {
        if (favoriteIds.length > 0) {
          const cachedIds = new Set(cached.map((image) => image.id));
          const missingFavorite = favoriteIds.some((id) => !cachedIds.has(id));
          if (missingFavorite) {
            // Fall through to index load to ensure favorites are included.
          } else {
            setImageLoadStatus('Images: using local cache');
            updateFavoriteImagesFromSource(set.id, cached, favoriteIds, hiddenIds, {
              keepLength: true,
            });
            updateHiddenImagesFromSource(set.id, cached, favoriteIds, hiddenIds, {
              keepLength: true,
            });
            const visible = filterImagesByHiddenStatus(cached, hiddenIds, 'visible');
            const ordered = getOrderedAllImages(set.id, visible);
            setActiveImages(ordered.slice(0, limit));
            return;
          }
        } else {
          setImageLoadStatus('Images: using local cache');
          setFavoriteImages([]);
          updateHiddenImagesFromSource(set.id, cached, favoriteIds, hiddenIds, {
            keepLength: true,
          });
          const visible = filterImagesByHiddenStatus(cached, hiddenIds, 'visible');
          const ordered = getOrderedAllImages(set.id, visible);
          setActiveImages(ordered.slice(0, limit));
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
        updateFavoriteImagesFromSource(set.id, images, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        updateHiddenImagesFromSource(set.id, images, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        const visible = filterImagesByHiddenStatus(images, hiddenIds, 'visible');
        const ordered = getOrderedAllImages(set.id, visible);
        setActiveImages(ordered.slice(0, limit));
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
        updateFavoriteImagesFromSource(set.id, images, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        updateHiddenImagesFromSource(set.id, images, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        const visible = filterImagesByHiddenStatus(images, hiddenIds, 'visible');
        const ordered = getOrderedAllImages(set.id, visible);
        setActiveImages(ordered.slice(0, limit));
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
    if (!showExplicit && isExplicitSet(set)) {
      return;
    }
    const nextSet =
      !set.indexFileId && prebuiltIndexRef.current?.folderId === set.rootFolderId
        ? { ...set, indexFileId: prebuiltIndexRef.current.fileId ?? undefined }
        : set;
    const isSameSet = activeSet?.id === nextSet.id;
    setActiveSet(nextSet);
    setPage('set');
    if (!isSameSet) {
      setImageLimit(0);
      setActiveImages([]);
      setFavoriteImages([]);
      setSampleImages([]);
      setNonFavoriteImages([]);
      setImageLoadStatus('');
      if (setViewerTab === 'all') {
        setImageLimit(allPageSize);
        void loadSetImages(nextSet, allPageSize, false);
      }
    }
    if (!set.indexFileId && nextSet.indexFileId) {
      await handleUpdateSet(set.id, { indexFileId: nextSet.indexFileId });
    }
  };

  useEffect(() => {
    if (!showExplicit && activeSet && isExplicitSet(activeSet)) {
      setActiveSet(null);
      setActiveImages([]);
      setFavoriteImages([]);
      setImageLoadStatus('');
      setPage('overview');
    }
  }, [activeSet, isExplicitSet, showExplicit]);

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
  }, [handleOpenSet, isLoadingMetadata, visibleSets]);

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
  }, [handleOpenSet, visibleSets]);

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
    const match = visibleSets.find((item) => item.id === pendingId);
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
    visibleSets,
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
        updatedSet.hiddenImageIds ?? [],
        { keepLength: true }
      );
      updateHiddenImagesFromSource(
        set.id,
        refreshed,
        updatedSet.favoriteImageIds ?? [],
        updatedSet.hiddenImageIds ?? [],
        { keepLength: true }
      );
      const visible = filterImagesByHiddenStatus(refreshed, updatedSet.hiddenImageIds ?? [], 'visible');
      setSampleImages(pickNext.sample(set.id, visible, samplePageSize));
      if (activeImages.length > 0) {
        const ordered = getOrderedAllImages(set.id, visible);
        setActiveImages(ordered.slice(0, imageLimit));
      }
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setIsRefreshingSet(false);
      setViewerIndexProgress('');
    }
  };

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
  };

  const handleLoadAllPreloaded = async () => {
    if (!activeSet || !isConnected) {
      return;
    }
    setIsLoadingMore(true);
    setImageLoadStatus('Images: loading preloaded list');
    try {
      const favoriteIds = activeSet.favoriteImageIds ?? [];
      const hiddenIds = activeSet.hiddenImageIds ?? [];
      const cached = readImageListCache(activeSet.id);
      if (cached) {
        updateFavoriteImagesFromSource(activeSet.id, cached, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        updateHiddenImagesFromSource(activeSet.id, cached, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        const visible = filterImagesByHiddenStatus(cached, hiddenIds, 'visible');
        const ordered = getOrderedAllImages(activeSet.id, visible);
        setActiveImages(ordered);
        setImageLimit(ordered.length);
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
        updateFavoriteImagesFromSource(activeSet.id, images, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        updateHiddenImagesFromSource(activeSet.id, images, favoriteIds, hiddenIds, {
          keepLength: true,
        });
        const visible = filterImagesByHiddenStatus(images, hiddenIds, 'visible');
        const ordered = getOrderedAllImages(activeSet.id, visible);
        setActiveImages(ordered);
        setImageLimit(ordered.length);
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

  const handleEnsureImageInView = useCallback(
    async (imageId: string) => {
      if (!activeSet || !isConnected) {
        return;
      }
      if (viewerSort !== 'chronological') {
        return;
      }
      let images = readImageListCache(activeSet.id);
      if (!images || images.length === 0) {
        images = await resolveSetImages(activeSet, true, { suppressProgress: true });
      }
      if (!images || images.length === 0) {
        return;
      }
      const visible = filterImagesByHiddenStatus(images, activeSet.hiddenImageIds ?? [], 'visible');
      const index = visible.findIndex((image) => image.id === imageId);
      if (index < 0) {
        return;
      }
      const nextLimit = Math.max(
        allPageSize,
        Math.ceil((index + 1) / allPageSize) * allPageSize
      );
      const alreadyLoaded =
        activeImages.length >= nextLimit &&
        activeImages.some((image) => image.id === imageId);
      if (!alreadyLoaded) {
        setImageLimit(nextLimit);
        await loadSetImages(activeSet, nextLimit, false);
      }
    },
    [activeImages, activeSet, allPageSize, isConnected, resolveSetImages, viewerSort, loadSetImages]
  );

  const favoriteIds = activeSet?.favoriteImageIds ?? [];
  const hiddenIds = activeSet?.hiddenImageIds ?? [];
  const hiddenSet = new Set(hiddenIds);
  const cachedCount = activeSet ? readImageListCache(activeSet.id)?.length : undefined;
  const totalImagesKnownRaw = activeSet?.imageCount ?? cachedCount;
  const totalVisibleKnown =
    totalImagesKnownRaw !== undefined
      ? Math.max(0, totalImagesKnownRaw - hiddenIds.length)
      : undefined;
  const totalImagesKnown = totalVisibleKnown;
  const totalImages = totalVisibleKnown ?? activeImages.length;
  const remainingImages =
    totalVisibleKnown !== undefined ? Math.max(0, totalVisibleKnown - activeImages.length) : undefined;
  const pendingExtra =
    totalVisibleKnown !== undefined
      ? Math.max(0, Math.min(allPageSize, remainingImages))
      : allPageSize;
  const favoritesCount = favoriteIds.filter((id) => !hiddenSet.has(id)).length;
  const hiddenCount = hiddenIds.length;
  const allImagesCount = totalVisibleKnown ?? activeImages.length;
  const nonFavoritesCount =
    totalVisibleKnown !== undefined
      ? Math.max(0, totalVisibleKnown - favoritesCount)
      : undefined;
  const favoritesRemaining = Math.max(0, favoritesCount - favoriteImages.length);
  const favoritesPendingExtra = Math.max(0, Math.min(samplePageSize, favoritesRemaining));
  const sampleRemaining =
    totalVisibleKnown !== undefined
      ? Math.max(0, totalVisibleKnown - sampleImages.length)
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
  const hiddenRemaining = Math.max(0, hiddenCount - hiddenImages.length);
  const hiddenPendingExtra = Math.max(0, Math.min(samplePageSize, hiddenRemaining));

  const handleSetViewerTab = useCallback(
    (tab: 'samples' | 'favorites' | 'nonfavorites' | 'hidden' | 'all') => {
      setSetViewerTab(tab);
    },
    []
  );

  const handleViewerSortChange = useCallback(
    (value: 'random' | 'chronological') => {
      setViewerSort(value);
    },
    []
  );

  const handleUpdateSetName = useCallback(
    (value: string) => {
      if (!activeSet) {
        return;
      }
      void handleUpdateSet(activeSet.id, {
        name: value.trim() || activeSet.name,
      });
    },
    [activeSet, handleUpdateSet]
  );

  const setViewerValue = {
    activeSet,
    isConnected,
    isSaving,
    isRefreshingSet,
    setViewerTab,
    onSetViewerTab: handleSetViewerTab,
    viewerSort,
    onViewerSortChange: handleViewerSortChange,
    viewerQuickTags,
    onToggleActiveSetTag: toggleActiveSetTag,
    favoriteIds,
    hiddenIds,
    favoritesCount,
    hiddenCount,
    nonFavoritesCount,
    allImagesCount,
    sampleImages,
    favoriteImages,
    nonFavoriteImages,
    hiddenImages,
    activeImages,
    viewerIndexProgress,
    isLoadingSample,
    isLoadingFavorites,
    isLoadingNonFavorites,
    isLoadingHidden,
    isLoadingImages,
    isLoadingMore,
    totalImagesKnown,
    samplePendingExtra,
    nonFavoritesPendingExtra,
    favoritesPendingExtra,
    hiddenPendingExtra,
    pendingExtra,
    remainingImages,
    onLoadMoreSample: handleLoadMoreSample,
    onLoadAllSample: handleLoadAllSample,
    onLoadMoreNonFavorites: handleLoadMoreNonFavorites,
    onLoadAllNonFavorites: handleLoadAllNonFavorites,
    onLoadMoreFavorites: handleLoadMoreFavorites,
    onLoadAllFavorites: handleLoadAllFavorites,
    onLoadMoreHidden: handleLoadMoreHidden,
    onLoadAllHidden: handleLoadAllHidden,
    onLoadMoreImages: handleLoadMoreImages,
    onLoadAllPreloaded: handleLoadAllPreloaded,
    onEnsureImageInView: handleEnsureImageInView,
    onToggleFavoriteImage: toggleFavoriteImage,
    onToggleHiddenImage: toggleHiddenImage,
    onSetThumbnail: handleSetThumbnail,
    onSetThumbnailPosition: handleSetThumbnailPosition,
    onUpdateSetName: handleUpdateSetName,
    onRefreshSet: handleRefreshSet,
    onDeleteSet: handleDeleteSet,
    onRotateSet: handleRotateSet,
    isRotatingSet,
    rotateSetProgress,
    thumbSize: THUMB_SIZE,
    viewerThumbSize: VIEWER_THUMB_SIZE,
    sampleGridRef,
    allGridRef,
  };

  const modalDeps = {
    activeSet,
    setsById,
    viewerSort,
    activeImages,
    setActiveImages,
    setImageLimit,
    allPageSize,
    samplePageSize,
    favoriteImages,
    setFavoriteImages,
    setSampleImages,
    setNonFavoriteImages,
    setHiddenImages,
    readImageListCache,
    filterImagesByFavoriteStatus,
    filterImagesByHiddenStatus,
    pickNext,
    resolveSetImages,
    updateFavoriteImagesFromSource,
    handleLoadMoreImages,
    isLoadingMore,
    toggleFavoriteImage,
    toggleHiddenImage,
    loadSlideshowBatch,
    slideshowImagesRef,
    slideshowImageSetRef,
    slideshowPageSize,
    prefetchThumbs,
    setError,
    rotateImage,
  };

  const modalActions = useMemo(() => ({ openModal }), [openModal]);

  const slideshowValue = {
    isConnected,
    slideshowSets,
    slideshowFavoriteFilter,
    onSlideshowFavoriteFilterChange: setSlideshowFavoriteFilter,
    onStartSlideshow: handleStartSlideshow,
    isLoadingSlideshow,
    onClearSlideshowTags: clearSlideshowTags,
    sortedTags,
    slideshowIncludeTags,
    slideshowExcludeTags,
    onToggleIncludeTag: toggleSlideshowIncludeTag,
    onToggleExcludeTag: toggleSlideshowExcludeTag,
    slideshowStarted,
    viewerIndexProgress,
    slideshowImages,
    slideshowImageSetMap: slideshowImageSetRef.current,
    setsById,
    onToggleFavoriteImage: toggleFavoriteImage,
    onToggleHiddenImage: toggleHiddenImage,
    thumbSize: THUMB_SIZE,
    onLoadMoreSlideshow: handleLoadMoreSlideshow,
    slideshowPageSize,
  };

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
    <>
      <ModalActionsProvider value={modalActions}>
        <div className={`app ${isLoadingMetadata ? 'app--loading' : ''}`}>
          <AppHeader
            page={page}
            activeSet={activeSet}
            isConnected={isConnected}
            onConnect={handleConnect}
            onTitleClick={handleTitleClick}
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
            totalSets={visibleSets.length}
            onOpenSet={handleOpenSet}
            cardThumbSize={CARD_THUMB_SIZE}
          />
        ) : null}

        {page === 'slideshow' ? (
          <SlideshowProvider value={slideshowValue}>
            <SlideshowPage />
          </SlideshowProvider>
        ) : null}

        {page === 'set' ? (
          <SetViewerProvider value={setViewerValue}>
            <SetViewerPage />
          </SetViewerProvider>
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
      </ModalActionsProvider>
      <ModalStateProvider
        deps={modalDeps}
        thumbSize={THUMB_SIZE}
        onOpenModalReady={(modalOpen) => {
          openModalRef.current = modalOpen;
        }}
      />
    </>
  );
}
