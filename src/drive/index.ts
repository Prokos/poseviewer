import { driveDownloadText, driveList, driveUploadText } from './api';
import { listImagesRecursive } from './scan';
import type { DriveImage } from './types';

const INDEX_NAME = 'poseviewer-index.json';

type PoseIndexItem = {
  id: string;
  name: string;
  time?: string;
  createdTime?: string;
  folderPath?: string;
};

export type PoseIndexDocument = {
  version: 2;
  updatedAt: string;
  count: number;
  items: PoseIndexItem[];
};

type PoseIndexDocumentV1 = {
  version: 1;
  updatedAt?: string;
  count?: number;
  items: PoseIndexItem[];
};

function normalizeIndexDocument(raw: unknown): PoseIndexDocument | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const parsed = raw as Partial<PoseIndexDocument | PoseIndexDocumentV1>;
  if (parsed.version === 2 && Array.isArray(parsed.items) && typeof parsed.count === 'number') {
    return parsed as PoseIndexDocument;
  }
  if (parsed.version === 1 && Array.isArray(parsed.items)) {
    return {
      version: 2,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      count: typeof parsed.count === 'number' ? parsed.count : parsed.items.length,
      items: parsed.items,
    };
  }
  return null;
}

export async function loadSetIndex(
  folderId: string,
  onProgress?: (progress: { loaded: number }) => void
) {
  const files = await driveList(
    {
      q: `'${folderId}' in parents and name='${INDEX_NAME}' and trashed=false`,
      pageSize: '1',
    },
    'nextPageToken,files(id,name)'
  );

  if (files.length === 0) {
    return null;
  }

  const fileId = files[0].id;
  const text = await driveDownloadText(fileId, onProgress);

  try {
    const parsed = JSON.parse(text) as PoseIndexDocument | PoseIndexDocumentV1;
    const normalized = normalizeIndexDocument(parsed);
    if (normalized) {
      return { fileId, data: normalized };
    }
  } catch {
    // fall through to null
  }

  return null;
}

export async function loadSetIndexById(
  fileId: string,
  onProgress?: (progress: { loaded: number }) => void
) {
  const text = await driveDownloadText(fileId, onProgress);
  try {
    const parsed = JSON.parse(text) as PoseIndexDocument | PoseIndexDocumentV1;
    const normalized = normalizeIndexDocument(parsed);
    if (normalized) {
      return { fileId, data: normalized };
    }
  } catch {
    return null;
  }
  return null;
}

export async function findSetIndexFileId(folderId: string) {
  const files = await driveList(
    {
      q: `'${folderId}' in parents and name='${INDEX_NAME}' and trashed=false`,
      pageSize: '1',
    },
    'nextPageToken,files(id)'
  );

  return files[0]?.id ?? null;
}

export async function saveSetIndex(folderId: string, fileId: string | null, items: PoseIndexItem[]) {
  const data: PoseIndexDocument = {
    version: 2,
    updatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  const content = JSON.stringify(data, null, 2);
  const result = await driveUploadText(folderId, fileId, INDEX_NAME, content);
  return result.id ?? fileId;
}

export async function buildSetIndex(
  folderId: string,
  onProgress?: (progress: { folders: number; images: number }) => void
) {
  const images = await listImagesRecursive(folderId, Infinity, onProgress);
  return images.map((image) => ({
    id: image.id,
    name: image.name,
    time: image.imageMediaMetadata?.time,
    createdTime: image.createdTime,
    folderPath: image.folderPath,
  }));
}

export function indexItemsToImages(items: PoseIndexItem[]): DriveImage[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: 'image/jpeg',
    imageMediaMetadata: item.time ? { time: item.time } : undefined,
    createdTime: item.createdTime,
    folderPath: item.folderPath,
  }));
}
