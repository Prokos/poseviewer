import type { DriveImage } from '../drive/types';
import type { MetadataDocument, MetadataInfo } from '../metadata';

const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_KEY = 'poseviewer-metadata-cache';
const METADATA_CACHE_TIME_KEY = 'poseviewer-metadata-cache-ts';
const METADATA_CACHE_ROOT_KEY = 'poseviewer-metadata-root';
const METADATA_DIRTY_KEY = 'poseviewer-metadata-dirty';
const IMAGE_LIST_CACHE_TTL = 24 * 60 * 60 * 1000;
const IMAGE_LIST_CACHE_PREFIX_V2 = 'poseviewer-set-images:v2:';
const IMAGE_LIST_CACHE_TIME_PREFIX_V2 = 'poseviewer-set-images-ts:v2:';
const IMAGE_LIST_CACHE_PREFIX_V3 = 'poseviewer-set-images:v3:';
const IMAGE_LIST_CACHE_TIME_PREFIX_V3 = 'poseviewer-set-images-ts:v3:';
const IMAGE_LIST_DB_NAME = 'poseviewer-cache';
const IMAGE_LIST_DB_VERSION = 1;
const IMAGE_LIST_STORE = 'imageLists';

type MetadataCache = {
  fileId: string | null;
  data: MetadataDocument;
  md5Checksum?: string;
  modifiedTime?: string;
};

type CachedImageListItem = { id: string; name: string; time?: string; createdTime?: string };
type CachedImageListEntry = {
  setId: string;
  updatedAt: number;
  items: CachedImageListItem[];
};

const imageListMemoryCache = new Map<string, { updatedAt: number; items: DriveImage[] }>();
let legacyImageListCleared = false;
let imageListDbPromise: Promise<IDBDatabase> | null = null;

function ensureLegacyImageListCleared() {
  if (legacyImageListCleared) {
    return;
  }
  legacyImageListCleared = true;
  const prefixes = [
    IMAGE_LIST_CACHE_PREFIX_V2,
    IMAGE_LIST_CACHE_TIME_PREFIX_V2,
    IMAGE_LIST_CACHE_PREFIX_V3,
    IMAGE_LIST_CACHE_TIME_PREFIX_V3,
  ];
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) {
      continue;
    }
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

function toCachedImageItems(images: DriveImage[]): CachedImageListItem[] {
  return images.map((image) => ({
    id: image.id,
    name: image.name,
    time: image.imageMediaMetadata?.time,
    createdTime: image.createdTime,
  }));
}

function fromCachedImageItems(items: CachedImageListItem[]): DriveImage[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: 'image/jpeg',
    imageMediaMetadata: item.time ? { time: item.time } : undefined,
    createdTime: item.createdTime,
  }));
}

function openImageListDb() {
  if (imageListDbPromise) {
    return imageListDbPromise;
  }
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB not available'));
  }
  imageListDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IMAGE_LIST_DB_NAME, IMAGE_LIST_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_LIST_STORE)) {
        db.createObjectStore(IMAGE_LIST_STORE, { keyPath: 'setId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return imageListDbPromise;
}

async function deleteImageListEntry(setId: string) {
  try {
    const db = await openImageListDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMAGE_LIST_STORE, 'readwrite');
      const store = tx.objectStore(IMAGE_LIST_STORE);
      const request = store.delete(setId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch {
    // Ignore cleanup failures.
  }
}

async function persistImageListEntry(entry: CachedImageListEntry) {
  try {
    const db = await openImageListDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMAGE_LIST_STORE, 'readwrite');
      const store = tx.objectStore(IMAGE_LIST_STORE);
      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch {
    // Ignore cache failures.
  }
}

export function readMetadataCache(rootId: string, options?: { allowStale?: boolean }) {
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
    return JSON.parse(cacheData) as MetadataCache;
  } catch {
    return null;
  }
}

export function clearMetadataCache() {
  localStorage.removeItem(METADATA_CACHE_ROOT_KEY);
  localStorage.removeItem(METADATA_CACHE_TIME_KEY);
  localStorage.removeItem(METADATA_CACHE_KEY);
}

export function writeMetadataCache(
  rootId: string,
  fileId: string | null,
  data: MetadataDocument,
  info?: Pick<MetadataInfo, 'md5Checksum' | 'modifiedTime'>
) {
  const payload = JSON.stringify({
    fileId,
    data,
    md5Checksum: info?.md5Checksum,
    modifiedTime: info?.modifiedTime,
  });
  const persist = () => {
    try {
      localStorage.setItem(METADATA_CACHE_KEY, payload);
      localStorage.setItem(METADATA_CACHE_ROOT_KEY, rootId);
      localStorage.setItem(METADATA_CACHE_TIME_KEY, String(Date.now()));
    } catch (error) {
      clearMetadataCache();
      throw error;
    }
  };
  try {
    persist();
    return true;
  } catch {
    clearImageListCache();
    try {
      persist();
      return true;
    } catch {
      return false;
    }
  }
}

export function readMetadataDirtyFlag() {
  return localStorage.getItem(METADATA_DIRTY_KEY) === 'true';
}

export function writeMetadataDirtyFlag(value: boolean) {
  localStorage.setItem(METADATA_DIRTY_KEY, value ? 'true' : 'false');
}

export function readImageListCache(setId: string) {
  const entry = imageListMemoryCache.get(setId);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.updatedAt > IMAGE_LIST_CACHE_TTL) {
    imageListMemoryCache.delete(setId);
    void deleteImageListEntry(setId);
    return null;
  }
  return entry.items;
}

export function clearImageListCache() {
  ensureLegacyImageListCleared();
  imageListMemoryCache.clear();
  void (async () => {
    try {
      const db = await openImageListDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IMAGE_LIST_STORE, 'readwrite');
        const store = tx.objectStore(IMAGE_LIST_STORE);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch {
      // Ignore cache cleanup failures.
    }
  })();
}

export function writeImageListCache(setId: string, images: DriveImage[]) {
  ensureLegacyImageListCleared();
  const updatedAt = Date.now();
  imageListMemoryCache.set(setId, { updatedAt, items: images });
  const entry: CachedImageListEntry = {
    setId,
    updatedAt,
    items: toCachedImageItems(images),
  };
  void persistImageListEntry(entry);
  return true;
}

export async function loadImageListCache(setId: string) {
  ensureLegacyImageListCleared();
  const entry = imageListMemoryCache.get(setId);
  if (entry) {
    if (Date.now() - entry.updatedAt <= IMAGE_LIST_CACHE_TTL) {
      return entry.items;
    }
    imageListMemoryCache.delete(setId);
    void deleteImageListEntry(setId);
  }
  try {
    const db = await openImageListDb();
    const stored = await new Promise<CachedImageListEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(IMAGE_LIST_STORE, 'readonly');
      const store = tx.objectStore(IMAGE_LIST_STORE);
      const request = store.get(setId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as CachedImageListEntry | undefined);
    });
    if (!stored) {
      return null;
    }
    if (Date.now() - stored.updatedAt > IMAGE_LIST_CACHE_TTL) {
      void deleteImageListEntry(setId);
      return null;
    }
    const items = fromCachedImageItems(stored.items ?? []);
    imageListMemoryCache.set(setId, { updatedAt: stored.updatedAt, items });
    return items;
  } catch {
    return null;
  }
}
