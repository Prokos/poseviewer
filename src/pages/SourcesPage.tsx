import {
  IconArrowUpRight,
  IconDownload,
  IconEyeOff,
  IconFolder,
  IconRefresh,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { driveCreateFolder, driveList, driveUploadBinaryFromUrl } from '../drive/api';
import { fetchSource } from '../sources/api';
import { DEFAULT_SOURCE_CONFIG } from '../sources/defaults';
import { fetchPhotoInfo } from '../sources/photo';
import { parseAlbumImages, parseSourceSets } from '../sources/parse';
import {
  createEmptyState,
  loadSourceConfig,
  loadSourceState,
  saveSourceState,
  SOURCES_ROOT_FOLDER_ID,
} from '../sources/storage';
import type { SourceImage, SourceSet, SourceStateDocument } from '../sources/types';
import { SourceThumb } from '../components/SourceThumb';
import { SourceModalViewer } from '../components/SourceModalViewer';

type SourcesPageProps = {
  isConnected: boolean;
};

type DownloadProgress = {
  total: number;
  completed: number;
};

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

function sanitizeName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Untitled';
  }
  return trimmed.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
}

function buildQueryString(query: string, template?: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return '';
  }
  if (template) {
    return template.replace('{query}', encodeURIComponent(trimmed));
  }
  return `search=${encodeURIComponent(trimmed)}`;
}

function readHrefParam(href: string, key: string) {
  try {
    const url = new URL(href, window.location.origin);
    const direct = url.searchParams.get(key);
    if (direct) {
      return direct;
    }
    if (url.hash) {
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      return hashParams.get(key);
    }
  } catch {
    // Ignore invalid URLs.
  }
  return null;
}

function ensureSourceState(state: SourceStateDocument, sourceId: string) {
  if (!state.sources[sourceId]) {
    state.sources[sourceId] = {
      subdir: '',
      downloadedSets: [],
      hiddenSets: [],
      downloadedImages: {},
      hiddenImages: {},
    };
  }
  return state.sources[sourceId];
}

function getSourceStateEntry(state: SourceStateDocument, sourceId: string) {
  return (
    state.sources[sourceId] ?? {
      subdir: '',
      downloadedSets: [],
      hiddenSets: [],
      downloadedImages: {},
      hiddenImages: {},
    }
  );
}

function buildImageProxyUrl(url: string, referer: string) {
  const proxy = new URL('/api/source/image', window.location.origin);
  proxy.searchParams.set('url', url);
  proxy.searchParams.set('referer', referer);
  return proxy.toString();
}

function withFreepikFullSize(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('w', '4096');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function SourcesPage({ isConnected }: SourcesPageProps) {
  const [config, setConfig] = useState(DEFAULT_SOURCE_CONFIG);
  const [state, setState] = useState<SourceStateDocument>(createEmptyState());
  const [stateFileId, setStateFileId] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string>('');
  const [sets, setSets] = useState<SourceSet[]>([]);
  const [setPage, setSetPage] = useState(1);
  const [hasMoreSets, setHasMoreSets] = useState(true);
  const [isLoadingSets, setIsLoadingSets] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeSet, setActiveSet] = useState<SourceSet | null>(null);
  const [albumTitle, setAlbumTitle] = useState('');
  const [images, setImages] = useState<SourceImage[]>([]);
  const [imagePage, setImagePage] = useState(1);
  const [hasMoreImages, setHasMoreImages] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [modalImageId, setModalImageId] = useState<string | null>(null);
  const [showHiddenImages, setShowHiddenImages] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadSetId, setDownloadSetId] = useState<string | null>(null);
  const [downloadImageIds, setDownloadImageIds] = useState<Set<string>>(() => new Set());
  const isSavingStateRef = useRef(false);
  const folderCacheRef = useRef<Map<string, string>>(new Map());
  const pendingRemovalIdsRef = useRef<Set<string>>(new Set());

  const activeSource = useMemo(() => {
    if (!config.sources.length) {
      return undefined;
    }
    return config.sources.find((source) => source.id === activeSourceId) ?? config.sources[0];
  }, [activeSourceId, config.sources]);

  const activeSourceSubdir = useMemo(() => {
    if (!activeSource) {
      return '';
    }
    return getSourceStateEntry(state, activeSource.id).subdir ?? '';
  }, [activeSource, state]);

  const persistState = useCallback(
    async (next: SourceStateDocument) => {
      if (!isConnected) {
        return;
      }
      if (isSavingStateRef.current) {
        return;
      }
      isSavingStateRef.current = true;
      try {
        const nextId = await saveSourceState(stateFileId, next);
        setStateFileId(nextId);
      } finally {
        isSavingStateRef.current = false;
      }
    },
    [isConnected, stateFileId]
  );

  const updateState = useCallback(
    (updater: (draft: SourceStateDocument) => void) => {
      setState((prev) => {
        const next = structuredClone(prev);
        updater(next);
        void persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const isSetHidden = useCallback(
    (setId: string) => {
      const entry = getSourceStateEntry(state, activeSource?.id ?? '');
      return entry.hiddenSets.includes(setId) || entry.downloadedSets.includes(setId);
    },
    [activeSource?.id, state.sources]
  );

  const isImageHidden = useCallback(
    (setId: string, imageId: string) => {
      const entry = getSourceStateEntry(state, activeSource?.id ?? '');
      const hidden = entry.hiddenImages[setId] ?? [];
      return hidden.includes(imageId);
    },
    [activeSource?.id, state.sources]
  );

  const isImageDownloaded = useCallback(
    (setId: string, imageId: string) => {
      const entry = getSourceStateEntry(state, activeSource?.id ?? '');
      const downloaded = entry.downloadedImages[setId] ?? [];
      return downloaded.includes(imageId);
    },
    [activeSource?.id, state.sources]
  );

  const hiddenImageCount = useMemo(() => {
    if (!activeSet) {
      return 0;
    }
    const entry = getSourceStateEntry(state, activeSource?.id ?? '');
    return entry.hiddenImages[activeSet.id]?.length ?? 0;
  }, [activeSet, activeSource?.id, state]);

  const downloadedImageIdSet = useMemo(() => {
    if (!activeSet) {
      return new Set<string>();
    }
    const entry = getSourceStateEntry(state, activeSource?.id ?? '');
    return new Set(entry.downloadedImages[activeSet.id] ?? []);
  }, [activeSet, activeSource?.id, state]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    let isMounted = true;
    Promise.all([loadSourceConfig(), loadSourceState()])
      .then(([configResult, stateResult]) => {
        if (!isMounted) {
          return;
        }
        setConfig(configResult.config);
        setState(stateResult.state);
        setStateFileId(stateResult.fileId);
        const freepik = configResult.config.sources.find((source) => source.id === 'freepik');
        setActiveSourceId(freepik?.id ?? configResult.config.sources[0]?.id ?? '');
      })
      .catch(() => {
        // Keep defaults on failure.
      });
    return () => {
      isMounted = false;
    };
  }, [isConnected]);

  const loadSets = useCallback(
    async (page: number, mode: 'append' | 'replace') => {
      if (!activeSource) {
        return;
      }
      const fetchPage = async (nextPage: number) => {
        const url = new URL(activeSource.list.endpoint, activeSource.baseUrl);
        url.searchParams.set(
          activeSource.list.queryParam,
          buildQueryString(query, activeSource.list.queryTemplate)
        );
        if (activeSource.list.responseType !== 'json') {
          url.searchParams.set('prev_items', String(activeSource.list.prevItems));
        }
        url.searchParams.set(activeSource.list.pageParam, String(nextPage));
        if (activeSource.list.extraParams) {
          for (const [key, value] of Object.entries(activeSource.list.extraParams)) {
            url.searchParams.set(key, value);
          }
        }
        const headers: Record<string, string> = {
          Accept:
            activeSource.list.responseType === 'json'
              ? 'application/json, text/plain, */*'
              : activeSource.list.ajax === false
                ? 'text/html, */*; q=0.9'
                : '*/*',
          Referer: activeSource.baseUrl,
          'User-Agent': navigator.userAgent,
        };
        if (activeSource.list.ajax !== false && activeSource.list.responseType !== 'json') {
          headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const response = await fetchSource(url.toString(), { headers });
        if (activeSource.list.responseType === 'json') {
          const data = (await response.json()) as {
            items?: Array<{
              id?: number | string;
              name?: string;
              url?: string;
              preview?: { url?: string };
            }>;
            pagination?: { currentPage?: number; lastPage?: number };
          };
          const items = data.items ?? [];
          const allSets = items
            .map((item) => {
              const href = item.url ?? '';
              const id = item.id ? String(item.id) : href;
              const thumbUrl = item.preview?.url ?? null;
              if (!href || !thumbUrl) {
                return null;
              }
              return {
                id,
                title: item.name ?? 'Untitled set',
                thumbUrl,
                href,
              };
            })
            .filter((item): item is SourceSet => Boolean(item));
          const visibleSets = allSets.filter((set) => !isSetHidden(set.id));
          const currentPage = data.pagination?.currentPage ?? nextPage;
          const lastPage = data.pagination?.lastPage ?? currentPage;
          return { allSets, visibleSets, hasMore: currentPage < lastPage };
        }
        const html = await response.text();
        const allSets = parseSourceSets(activeSource, html);
        const visibleSets = allSets.filter((set) => !isSetHidden(set.id));
        return { allSets, visibleSets, hasMore: allSets.length > 0 };
      };

      setIsLoadingSets(true);
      setError('');
      try {
        let nextPage = page;
        let collected: SourceSet[] = [];
        let rawCount = 0;
        let attempts = 0;
        let lastHasMore = false;
        const maxAttempts = 10;
        while (attempts < maxAttempts) {
          attempts += 1;
          const { allSets, visibleSets, hasMore } = await fetchPage(nextPage);
          lastHasMore = hasMore;
          rawCount = allSets.length;
          if (visibleSets.length > 0) {
            collected = visibleSets;
            break;
          }
          if (rawCount === 0) {
            break;
          }
          nextPage += 1;
          if (!hasMore) {
            break;
          }
        }
        setHasMoreSets(lastHasMore && rawCount > 0);
        setSets((prev) => {
          if (mode === 'replace') {
            return collected;
          }
          const existing = new Map(prev.map((item) => [item.id, item]));
          for (const item of collected) {
            existing.set(item.id, item);
          }
          return Array.from(existing.values());
        });
        setSetPage(nextPage);
      } catch (loadError) {
        setError((loadError as Error).message);
        setHasMoreSets(false);
      } finally {
        setIsLoadingSets(false);
      }
    },
    [activeSource, isSetHidden, query]
  );

  const fetchAlbumPage = useCallback(
    async (page: number, set: SourceSet) => {
      if (!activeSource) {
        return { title: '', images: [] };
      }
      if (activeSource.sourceType === 'search-based') {
        if (page > 1) {
          return { title: activeSource.album.titleFromQuery ? query.trim() : '', images: [] };
        }
        const resourceUrl = new URL(
          `/api/resources/${encodeURIComponent(set.id)}`,
          activeSource.baseUrl
        );
        resourceUrl.searchParams.set('locale', 'en');
        const response = await fetchSource(resourceUrl.toString(), {
          headers: {
            Accept: 'application/json, text/plain, */*',
            Referer: activeSource.baseUrl,
            'User-Agent': navigator.userAgent,
          },
        });
        const data = (await response.json()) as {
          id?: number | string;
          name?: string;
          preview?: { url?: string; width?: number; height?: number };
          dimensions?: { width?: number; height?: number };
          relatedResources?: {
            relatedPhotos?: Array<{
              id?: number | string;
              name?: string;
              url?: string;
              preview?: { url?: string; width?: number; height?: number };
            }>;
          };
        };
        const primaryId = data.id ? String(data.id) : set.id;
        const primaryUrl = data.preview?.url ?? set.thumbUrl;
        const width = data.dimensions?.width ?? data.preview?.width;
        const height = data.dimensions?.height ?? data.preview?.height;
        const images: SourceImage[] = [];
        if (primaryUrl) {
          const fullUrl = withFreepikFullSize(primaryUrl);
          images.push({
            id: primaryId,
            thumbUrl: primaryUrl,
            fullUrl,
            width,
            height,
            title: data.name,
            href: data.url ?? set.href,
          });
        }
        const related = data.relatedResources?.relatedPhotos ?? [];
        for (const item of related) {
          const url = item.preview?.url;
          if (!item.id || !url) {
            continue;
          }
          const fullUrl = withFreepikFullSize(url);
          images.push({
            id: String(item.id),
            thumbUrl: url,
            fullUrl,
            width: item.preview?.width,
            height: item.preview?.height,
            title: item.name,
            href: item.url,
          });
        }
        const titleFromQuery = activeSource.album.titleFromQuery ? query.trim() : '';
        return {
          title: titleFromQuery || data.name || set.title,
          images,
        };
      }
      let html = '';
      if (page === 1) {
        const albumUrl = new URL(
          activeSource.album.pathTemplate.replace('{id}', set.id),
          activeSource.baseUrl
        );
        const response = await fetchSource(albumUrl.toString(), {
          headers: {
            Accept: 'text/html, */*; q=0.9',
            Referer: activeSource.baseUrl,
            'User-Agent': navigator.userAgent,
          },
        });
        html = await response.text();
        const parsed = parseAlbumImages(activeSource, html);
        if (parsed.images.length > 0) {
          const titleParam = activeSource.album.titleFromHrefParam;
          const titleFromHref = titleParam ? readHrefParam(set.href, titleParam) : null;
          const titleFromQuery = activeSource.album.titleFromQuery ? query.trim() : '';
          return {
            ...parsed,
            title: titleFromQuery || titleFromHref || parsed.title,
          };
        }
      }
      if (activeSource.album.listFallback === false) {
        return { title: activeSource.album.titleFromQuery ? query.trim() : '', images: [] };
      }
      const url = new URL(activeSource.list.endpoint, activeSource.baseUrl);
      url.searchParams.set(activeSource.list.queryParam, `album=${set.id}`);
      url.searchParams.set('prev_items', String(activeSource.list.prevItems));
      url.searchParams.set(activeSource.list.pageParam, String(page));
      const listHeaders: Record<string, string> = {
        Accept: activeSource.list.ajax === false ? 'text/html, */*; q=0.9' : '*/*',
        Referer: activeSource.baseUrl,
        'User-Agent': navigator.userAgent,
      };
      if (activeSource.list.ajax !== false) {
        listHeaders['X-Requested-With'] = 'XMLHttpRequest';
      }
      const response = await fetchSource(url.toString(), { headers: listHeaders });
      html = await response.text();
      const parsed = parseAlbumImages(activeSource, html);
      const titleParam = activeSource.album.titleFromHrefParam;
      const titleFromHref = titleParam ? readHrefParam(set.href, titleParam) : null;
      const titleFromQuery = activeSource.album.titleFromQuery ? query.trim() : '';
      return {
        ...parsed,
        title: titleFromQuery || titleFromHref || parsed.title,
      };
    },
    [activeSource, query]
  );

  const loadImages = useCallback(
    async (page: number, mode: 'append' | 'replace', set: SourceSet) => {
      if (!activeSource) {
        return;
      }
      setIsLoadingImages(true);
      setError('');
      try {
        const parsed = await fetchAlbumPage(page, set);
        const filtered = parsed.images.filter((image) => {
          if (isImageDownloaded(set.id, image.id)) {
            return false;
          }
          if (showHiddenImages) {
            return true;
          }
          return !isImageHidden(set.id, image.id);
        });
        setAlbumTitle(parsed.title || set.title);
        setHasMoreImages(
          parsed.images.length > 0 &&
            parsed.images.length >= (activeSource?.list.prevItems ?? parsed.images.length)
        );
        setImages((prev) => {
          if (mode === 'replace') {
            return filtered;
          }
          const existing = new Map(prev.map((item) => [item.id, item]));
          for (const item of filtered) {
            existing.set(item.id, item);
          }
          return Array.from(existing.values());
        });
        setImagePage(page);
      } catch (loadError) {
        setError((loadError as Error).message);
        setHasMoreImages(false);
      } finally {
        setIsLoadingImages(false);
      }
    },
    [activeSource, fetchAlbumPage, isImageHidden, isImageDownloaded, showHiddenImages]
  );

  const loadAllImages = useCallback(async () => {
    if (!activeSource || !activeSet) {
      return images;
    }
    let page = imagePage;
    let merged = [...images];
    let more = hasMoreImages;
    while (more) {
      const nextPage = page + 1;
      const parsed = await fetchAlbumPage(nextPage, activeSet);
      const filtered = parsed.images.filter((image) => {
        if (isImageDownloaded(activeSet.id, image.id)) {
          return false;
        }
        if (showHiddenImages) {
          return true;
        }
        return !isImageHidden(activeSet.id, image.id);
      });
      if (
        parsed.images.length === 0 ||
        parsed.images.length < (activeSource?.list.prevItems ?? parsed.images.length)
      ) {
        more = false;
        break;
      }
      const existing = new Map(merged.map((item) => [item.id, item]));
      for (const item of filtered) {
        existing.set(item.id, item);
      }
      merged = Array.from(existing.values());
      page = nextPage;
    }
    setImages(merged);
    setImagePage(page);
    setHasMoreImages(more);
    return merged;
  }, [
    activeSet,
    activeSource,
    fetchAlbumPage,
    hasMoreImages,
    imagePage,
    images,
    isImageHidden,
    isImageDownloaded,
    showHiddenImages,
  ]);

  const lastSourceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeSource || !isConnected) {
      return;
    }
    if (lastSourceIdRef.current && lastSourceIdRef.current !== activeSource.id) {
      setActiveSet(null);
      setImages([]);
      setAlbumTitle('');
      setHasMoreImages(false);
    }
    lastSourceIdRef.current = activeSource.id;
    void loadSets(1, 'replace');
  }, [activeSource, isConnected, loadSets]);

  useEffect(() => {
    if (modalIndex === null) {
      if (pendingRemovalIdsRef.current.size > 0) {
        const pending = new Set(pendingRemovalIdsRef.current);
        pendingRemovalIdsRef.current.clear();
        setImages((prev) => prev.filter((item) => !pending.has(item.id)));
      }
      return;
    }
    if (modalIndex >= images.length) {
      setModalIndex(images.length > 0 ? images.length - 1 : null);
    }
  }, [images.length, modalIndex]);

  useEffect(() => {
    if (modalIndex === null || !modalImageId) {
      return;
    }
    const nextIndex = images.findIndex((image) => image.id === modalImageId);
    if (nextIndex >= 0 && nextIndex !== modalIndex) {
      setModalIndex(nextIndex);
      return;
    }
    if (nextIndex === -1 && images.length === 0) {
      setModalIndex(null);
      setModalImageId(null);
    }
  }, [images, modalImageId, modalIndex]);

  useEffect(() => {
    if (!activeSet) {
      return;
    }
    void loadImages(1, 'replace', activeSet);
  }, [activeSet, loadImages]);

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadSets(1, 'replace');
  };

  const handleReloadSets = () => {
    void loadSets(1, 'replace');
  };

  const handleSubdirChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeSource) {
      return;
    }
    const nextValue = event.target.value;
    updateState((draft) => {
      const entry = ensureSourceState(draft, activeSource.id);
      entry.subdir = nextValue;
    });
  };

  const handleSubdirBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!activeSource) {
      return;
    }
    if (event.currentTarget.value.trim()) {
      return;
    }
    void (async () => {
      try {
        const nextSubdir = await resolveDefaultSubdir(activeSource.name);
        if (!nextSubdir) {
          return;
        }
        updateState((draft) => {
          const entry = ensureSourceState(draft, activeSource.id);
          if (!entry.subdir || !entry.subdir.trim()) {
            entry.subdir = nextSubdir;
          }
        });
      } catch {
        // Ignore failures.
      }
    })();
  };

  const handleOpenSet = (set: SourceSet) => {
    setActiveSet(set);
    setImages([]);
    const titleFromQuery = activeSource?.album.titleFromQuery ? query.trim() : '';
    setAlbumTitle(titleFromQuery || set.title);
    setHasMoreImages(false);
    setImagePage(1);
    setShowHiddenImages(false);
  };

  const handleOpenSetFromImage = (image: SourceImage) => {
    if (!activeSource || activeSource.sourceType !== 'search-based') {
      return;
    }
    const nextSet: SourceSet = {
      id: image.id,
      title: image.title ?? activeSet?.title ?? 'Untitled set',
      thumbUrl: image.thumbUrl,
      href: image.href ?? '',
    };
    setModalIndex(null);
    setModalImageId(null);
    handleOpenSet(nextSet);
  };

  const handleBackToSets = () => {
    setActiveSet(null);
    setImages([]);
    setAlbumTitle('');
    setHasMoreImages(false);
    setModalIndex(null);
  };

  const ensureFolderId = useCallback(async (parentId: string, name: string) => {
    const folderName = sanitizeName(name);
    const cacheKey = `${parentId}:${folderName}`;
    const cached = folderCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }
    const files = await driveList(
      {
        q: `'${parentId}' in parents and name='${folderName}' and trashed=false and mimeType='${DRIVE_FOLDER_MIME}'`,
        pageSize: '1',
      },
      'nextPageToken,files(id,name)'
    );
    if (files[0]?.id) {
      folderCacheRef.current.set(cacheKey, files[0].id);
      return files[0].id;
    }
    const created = await driveCreateFolder(parentId, folderName);
    folderCacheRef.current.set(cacheKey, created.id);
    return created.id;
  }, []);

  const ensureSetFolderId = useCallback(
    async (sourceName: string, subdirName: string, setName: string) => {
      const sourceFolderId = await ensureFolderId(SOURCES_ROOT_FOLDER_ID, sourceName);
      const resolvedSubdir = subdirName.trim() ? subdirName : 'Default';
      const subdirFolderId = await ensureFolderId(sourceFolderId, resolvedSubdir);
      return ensureFolderId(subdirFolderId, setName);
    },
    [ensureFolderId]
  );

  const resolveDefaultSubdir = useCallback(
    async (sourceName: string) => {
      const sourceFolderId = await ensureFolderId(SOURCES_ROOT_FOLDER_ID, sourceName);
      const folders = await driveList(
        {
          q: `'${sourceFolderId}' in parents and trashed=false and mimeType='${DRIVE_FOLDER_MIME}'`,
          orderBy: 'name',
          pageSize: '1',
        },
        'files(id,name)'
      );
      return folders[0]?.name ?? 'Default';
    },
    [ensureFolderId]
  );

  useEffect(() => {
    if (!activeSource || !isConnected) {
      return;
    }
    if (activeSourceSubdir.trim()) {
      return;
    }
    let isMounted = true;
    void (async () => {
      try {
        const nextSubdir = await resolveDefaultSubdir(activeSource.name);
        if (!isMounted || !nextSubdir) {
          return;
        }
        updateState((draft) => {
          const entry = ensureSourceState(draft, activeSource.id);
          if (!entry.subdir || !entry.subdir.trim()) {
            entry.subdir = nextSubdir;
          }
        });
      } catch {
        // Ignore failures and let the user pick a subdir manually.
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [activeSource, activeSourceSubdir, isConnected, resolveDefaultSubdir, updateState]);

  const resolveFilename = (url: string, fallbackId: string) => {
    try {
      const parsed = new URL(url);
      const name = parsed.pathname.split('/').pop();
      if (name) {
        return sanitizeName(decodeURIComponent(name));
      }
    } catch {
      // Ignore URL parse errors.
    }
    return `${fallbackId}.jpg`;
  };

  const requestFullImage = useCallback(
    async (image: SourceImage) => {
      if (!activeSource) {
        return null;
      }
      if (activeSource.sourceType === 'search-based') {
        return {
          url: image.fullUrl ?? withFreepikFullSize(image.thumbUrl),
          width: image.width,
          height: image.height,
        };
      }
      if (image.fullUrl && image.fullUrl !== image.thumbUrl) {
        return {
          url: image.fullUrl,
          width: image.width,
          height: image.height,
        };
      }
      const info = await fetchPhotoInfo(activeSource, image.id);
      setImages((prev) =>
        prev.map((item) =>
          item.id === image.id
            ? {
                ...item,
                fullUrl: info.url,
                width: info.width,
                height: info.height,
              }
            : item
        )
      );
      return info;
    },
    [activeSource]
  );

  const handleHideSet = (setId: string) => {
    updateState((draft) => {
      const entry = ensureSourceState(draft, activeSource?.id ?? '');
      if (!entry.hiddenSets.includes(setId)) {
        entry.hiddenSets.push(setId);
      }
    });
    setSets((prev) => prev.filter((item) => item.id !== setId));
  };

  const handleHideImage = (image: SourceImage) => {
    if (!activeSet) {
      return;
    }
    updateState((draft) => {
      const entry = ensureSourceState(draft, activeSource?.id ?? '');
      const list = entry.hiddenImages[activeSet.id] ?? [];
      if (list.includes(image.id)) {
        entry.hiddenImages[activeSet.id] = list.filter((id) => id !== image.id);
        return;
      }
      entry.hiddenImages[activeSet.id] = [...list, image.id];
    });
    if (!showHiddenImages) {
      setImages((prev) => prev.filter((item) => item.id !== image.id));
    }
  };

  const handleDownloadImage = async (image: SourceImage) => {
    if (!activeSet || !activeSource) {
      return;
    }
    if (downloadImageIds.has(image.id)) {
      return;
    }
    setDownloadImageIds((current) => new Set(current).add(image.id));
    try {
      const info = await requestFullImage(image);
      const fullUrl = info?.url ?? image.fullUrl ?? image.thumbUrl;
      const folderId = await ensureSetFolderId(
        activeSource.name,
        activeSourceSubdir,
        albumTitle || activeSet.title
      );
      const filename = resolveFilename(fullUrl, image.id);
      await driveUploadBinaryFromUrl(folderId, filename, fullUrl, undefined, activeSource.baseUrl);
      updateState((draft) => {
        const entry = ensureSourceState(draft, activeSource.id);
        const list = entry.downloadedImages[activeSet.id] ?? [];
        if (!list.includes(image.id)) {
          entry.downloadedImages[activeSet.id] = [...list, image.id];
        }
      });
      if (modalIndex !== null) {
        pendingRemovalIdsRef.current.add(image.id);
      } else {
        setImages((prev) => prev.filter((item) => item.id !== image.id));
      }
    } catch (downloadError) {
      setError((downloadError as Error).message);
    } finally {
      setDownloadImageIds((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
    }
  };

  const handleDownloadSet = async () => {
    if (!activeSet || !activeSource || downloadSetId) {
      return;
    }
    const sourceImages = hasMoreImages ? await loadAllImages() : images;
    const remaining = sourceImages.filter((image) => !isImageHidden(activeSet.id, image.id));
    if (remaining.length === 0) {
      return;
    }
    setDownloadSetId(activeSet.id);
    setDownloadProgress({ total: remaining.length, completed: 0 });
    try {
      const folderId = await ensureSetFolderId(
        activeSource.name,
        activeSourceSubdir,
        albumTitle || activeSet.title
      );
      let completed = 0;
      for (const image of remaining) {
        const info = await requestFullImage(image);
        const fullUrl = info?.url ?? image.fullUrl ?? image.thumbUrl;
        const filename = resolveFilename(fullUrl, image.id);
        await driveUploadBinaryFromUrl(
          folderId,
          filename,
          fullUrl,
          undefined,
          activeSource.baseUrl
        );
        completed += 1;
        setDownloadProgress({ total: remaining.length, completed });
      }
      updateState((draft) => {
        const entry = ensureSourceState(draft, activeSource.id);
        if (!entry.downloadedSets.includes(activeSet.id)) {
          entry.downloadedSets.push(activeSet.id);
        }
      });
      setSets((prev) => prev.filter((item) => item.id !== activeSet.id));
      setActiveSet(null);
    } catch (downloadError) {
      setError((downloadError as Error).message);
    } finally {
      setDownloadSetId(null);
      setDownloadProgress(null);
    }
  };

  const modalImage = modalIndex !== null ? images[modalIndex] : null;
  const modalLabel = modalImage ? `${albumTitle || activeSet?.title || ''}` : '';
  const resolveThumbUrl = useCallback(
    (url: string) => {
      if (!activeSource) {
        return url;
      }
      if (!/^https?:/i.test(url)) {
        return url;
      }
      return buildImageProxyUrl(url, activeSource.baseUrl);
    },
    [activeSource]
  );

  if (!activeSource) {
    return (
      <section className="panel">
        <div className="panel-header panel-header--row panel-header--overview">
          <div className="overview-title">
            <div className="overview-title-row">
              <h2>Sources</h2>
            </div>
          </div>
        </div>
        <div className="panel-body">
          <p className="muted">No sources configured yet.</p>
        </div>
      </section>
    );
  }

  if (!isConnected) {
    return (
      <section className="panel">
        <div className="panel-header panel-header--row panel-header--overview">
          <div className="overview-title">
            <div className="overview-title-row">
              <h2>Sources</h2>
            </div>
          </div>
        </div>
        <div className="panel-body">
          <p className="muted">Connect to Google Drive to use sources.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header panel-header--row panel-header--overview">
        <div className="overview-title">
          <div className="overview-title-row">
            <h2>Sources</h2>
          </div>
        </div>
      </div>
      {error ? (
        <div className="panel-header panel-header--row">
          <span className="error">{error}</span>
        </div>
      ) : null}
      <div className="panel-header panel-header--row panel-header--overview">
        <div className="overview-controls">
          <label className="field field--inline">
            <span>Source</span>
            <select
              value={activeSource?.id}
              onChange={(event) => setActiveSourceId(event.target.value)}
            >
              {config.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span>Subdir</span>
            <input
              type="text"
              value={activeSourceSubdir}
              onChange={handleSubdirChange}
              onBlur={handleSubdirBlur}
              placeholder="Subdir"
            />
          </label>
          {!activeSet ? (
            <>
              <form className="field field--inline" onSubmit={handleSearchSubmit}>
                <span>Search</span>
                <div className="field-actions">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search source"
                  />
                  <button type="submit" className="ghost" disabled={isLoadingSets}>
                    <IconRefresh size={16} />
                    Search
                  </button>
                </div>
              </form>
              <button
                type="button"
                className="ghost"
                onClick={handleReloadSets}
                disabled={isLoadingSets}
              >
                <IconRefresh size={16} />
                Reload
              </button>
            </>
          ) : null}
        </div>
      </div>
      {activeSet ? (
        <>
          <div className="panel-header panel-header--row panel-header--overview">
            <div className="overview-controls">
              <button type="button" className="ghost" onClick={handleBackToSets}>
                <IconFolder size={16} />
                Back to sets
              </button>
              <div className="pill">{albumTitle || activeSet.title}</div>
              <button
                type="button"
                className={`ghost ${showHiddenImages ? 'is-active' : ''}`}
                onClick={() => setShowHiddenImages((current) => !current)}
                disabled={hiddenImageCount === 0}
              >
                <IconEyeOff size={16} />
                {showHiddenImages ? 'Hide hidden' : `Show hidden (${hiddenImageCount})`}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  handleHideSet(activeSet.id);
                  handleBackToSets();
                }}
              >
                <IconEyeOff size={16} />
                Hide set
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleDownloadSet}
                disabled={downloadSetId === activeSet.id || images.length === 0}
              >
                <IconDownload size={16} />
                Download set
              </button>
            </div>
          </div>
          {downloadProgress ? (
            <div className="panel-header panel-header--row">
              <span className="muted">
                Downloading {downloadProgress.completed} / {downloadProgress.total} images…
              </span>
            </div>
          ) : null}
          <div className="panel-body">
            <div className="image-grid">
              {images.map((image, index) => (
                <div key={image.id} className="image-tile">
                  <button
                    type="button"
                    className="image-button"
                    onClick={() => {
                      setModalIndex(index);
                      setModalImageId(image.id);
                    }}
                  >
                    <SourceThumb
                      url={resolveThumbUrl(image.thumbUrl)}
                      alt={albumTitle || activeSet.title}
                    />
                  </button>
                  <button
                    type="button"
                    className="thumb-action thumb-action--hide"
                    onClick={() => handleHideImage(image)}
                    aria-label="Hide image"
                  >
                    <IconEyeOff size={16} />
                  </button>
                  {activeSource?.sourceType === 'search-based' ? (
                    <button
                      type="button"
                      className="thumb-action thumb-action--open-set"
                      onClick={() => handleOpenSetFromImage(image)}
                      aria-label="Open image set"
                    >
                      <IconArrowUpRight size={16} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="thumb-action thumb-action--download"
                    onClick={() => void handleDownloadImage(image)}
                    aria-label="Download image"
                    disabled={downloadImageIds.has(image.id) || Boolean(downloadSetId)}
                  >
                    <IconDownload size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="panel-actions">
              <button
                type="button"
                className={`ghost ${showHiddenImages ? 'is-active' : ''}`}
                onClick={() => setShowHiddenImages((current) => !current)}
                disabled={hiddenImageCount === 0}
              >
                <IconEyeOff size={16} />
                {showHiddenImages ? 'Hide hidden' : `Show hidden (${hiddenImageCount})`}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  handleHideSet(activeSet.id);
                  handleBackToSets();
                }}
              >
                <IconEyeOff size={16} />
                Hide set
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleDownloadSet}
                disabled={downloadSetId === activeSet.id || images.length === 0}
              >
                <IconDownload size={16} />
                Download set
              </button>
            </div>
            {hasMoreImages ? (
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void loadImages(imagePage + 1, 'append', activeSet)}
                  disabled={isLoadingImages}
                >
                  {isLoadingImages ? 'Loading…' : 'Load more images'}
                </button>
              </div>
            ) : null}
          </div>
          <SourceModalViewer
            isOpen={modalIndex !== null}
            images={images}
            index={modalIndex ?? 0}
            label={modalLabel}
            downloadImageIdSet={downloadImageIds}
            downloadedImageIdSet={downloadedImageIdSet}
            onClose={() => setModalIndex(null)}
            onPrev={() =>
              setModalIndex((prev) => {
                if (!prev || prev <= 0) {
                  return prev;
                }
                const next = prev - 1;
                const nextImage = images[next];
                if (nextImage) {
                  setModalImageId(nextImage.id);
                }
                return next;
              })
            }
            onNext={() =>
              setModalIndex((prev) => {
                if (prev === null || prev >= images.length - 1) {
                  return prev;
                }
                const next = prev + 1;
                const nextImage = images[next];
                if (nextImage) {
                  setModalImageId(nextImage.id);
                }
                return next;
              })
            }
            onRequestFull={requestFullImage}
            onDownload={(image) => void handleDownloadImage(image)}
            onHide={handleHideImage}
            onOpenSet={
              activeSource?.sourceType === 'search-based' ? handleOpenSetFromImage : undefined
            }
          />
        </>
      ) : (
        <>
          <div className="panel-body">
            <span>
              Listing {sets.length} {sets.length === 1 ? 'set' : 'sets'}
            </span>
            <div className="card-grid">
              {sets.map((set) => (
                <div key={set.id} className="card">
                  <button
                    type="button"
                    className="card--clickable card-hit"
                    onClick={() => handleOpenSet(set)}
                  >
                    <div className="card-thumb">
                      <SourceThumb url={resolveThumbUrl(set.thumbUrl)} alt={set.title} />
                    </div>
                  </button>
                  <div className="card-footer">
                    <div className="card-footer-title">{set.title}</div>
                    <div className="card-footer-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleHideSet(set.id)}
                      >
                        <IconEyeOff size={16} />
                        Hide
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleOpenSet(set)}
                      >
                        <IconFolder size={16} />
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {hasMoreSets ? (
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void loadSets(setPage + 1, 'append')}
                  disabled={isLoadingSets}
                >
                  {isLoadingSets ? 'Loading…' : 'Load more sets'}
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
