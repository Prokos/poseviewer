import type { DriveImage } from '../drive/types';
import type { MetadataDocument, MetadataInfo } from '../metadata';

const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const METADATA_CACHE_KEY = 'poseviewer-metadata-cache';
const METADATA_CACHE_TIME_KEY = 'poseviewer-metadata-cache-ts';
const METADATA_CACHE_ROOT_KEY = 'poseviewer-metadata-root';
const METADATA_DIRTY_KEY = 'poseviewer-metadata-dirty';
const IMAGE_LIST_CACHE_TTL = 24 * 60 * 60 * 1000;
const IMAGE_LIST_CACHE_PREFIX = 'poseviewer-set-images:v2:';
const IMAGE_LIST_CACHE_TIME_PREFIX = 'poseviewer-set-images-ts:v2:';

type MetadataCache = {
  fileId: string | null;
  data: MetadataDocument;
  md5Checksum?: string;
  modifiedTime?: string;
};

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

export function writeMetadataCache(
  rootId: string,
  fileId: string | null,
  data: MetadataDocument,
  info?: Pick<MetadataInfo, 'md5Checksum' | 'modifiedTime'>
) {
  localStorage.setItem(METADATA_CACHE_ROOT_KEY, rootId);
  localStorage.setItem(METADATA_CACHE_TIME_KEY, String(Date.now()));
  localStorage.setItem(
    METADATA_CACHE_KEY,
    JSON.stringify({
      fileId,
      data,
      md5Checksum: info?.md5Checksum,
      modifiedTime: info?.modifiedTime,
    })
  );
}

export function readMetadataDirtyFlag() {
  return localStorage.getItem(METADATA_DIRTY_KEY) === 'true';
}

export function writeMetadataDirtyFlag(value: boolean) {
  localStorage.setItem(METADATA_DIRTY_KEY, value ? 'true' : 'false');
}

export function readImageListCache(setId: string) {
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

export function clearImageListCache() {
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

export function writeImageListCache(setId: string, images: DriveImage[]) {
  const payload = images.map((image) => ({ id: image.id, name: image.name }));
  const dataKey = `${IMAGE_LIST_CACHE_PREFIX}${setId}`;
  const timeKey = `${IMAGE_LIST_CACHE_TIME_PREFIX}${setId}`;
  const readCacheEntries = () => {
    const entries: Array<{ setId: string; timestamp: number }> = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(IMAGE_LIST_CACHE_TIME_PREFIX)) {
        continue;
      }
      const entrySetId = key.slice(IMAGE_LIST_CACHE_TIME_PREFIX.length);
      const raw = localStorage.getItem(key);
      const timestamp = raw ? Number(raw) : Number.NaN;
      if (!Number.isNaN(timestamp)) {
        entries.push({ setId: entrySetId, timestamp });
      }
    }
    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  };
  try {
    localStorage.setItem(dataKey, JSON.stringify(payload));
    localStorage.setItem(timeKey, String(Date.now()));
    return true;
  } catch {
    const entries = readCacheEntries();
    for (const entry of entries) {
      localStorage.removeItem(`${IMAGE_LIST_CACHE_PREFIX}${entry.setId}`);
      localStorage.removeItem(`${IMAGE_LIST_CACHE_TIME_PREFIX}${entry.setId}`);
      try {
        localStorage.setItem(dataKey, JSON.stringify(payload));
        localStorage.setItem(timeKey, String(Date.now()));
        return true;
      } catch {
        // Keep removing oldest entries until we either succeed or exhaust the list.
      }
    }
    return false;
  }
}
