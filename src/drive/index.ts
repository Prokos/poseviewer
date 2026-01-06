import { driveDownloadText, driveList, driveUploadText } from './api';
import { listImagesRecursive } from './scan';
import type { DriveImage } from './types';

const INDEX_NAME = 'poseviewer-index.json';

type PoseIndexItem = {
  id: string;
  name: string;
};

export type PoseIndexDocument = {
  version: 1;
  updatedAt: string;
  count: number;
  items: PoseIndexItem[];
};

export async function loadSetIndex(token: string, folderId: string) {
  const files = await driveList(
    token,
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
  const text = await driveDownloadText(token, fileId);

  try {
    const parsed = JSON.parse(text) as PoseIndexDocument;
    if (
      parsed?.version === 1 &&
      Array.isArray(parsed.items) &&
      typeof parsed.count === 'number'
    ) {
      return { fileId, data: parsed };
    }
  } catch {
    // fall through to null
  }

  return null;
}

export async function findSetIndexFileId(token: string, folderId: string) {
  const files = await driveList(
    token,
    {
      q: `'${folderId}' in parents and name='${INDEX_NAME}' and trashed=false`,
      pageSize: '1',
    },
    'nextPageToken,files(id)'
  );

  return files[0]?.id ?? null;
}

export async function saveSetIndex(
  token: string,
  folderId: string,
  fileId: string | null,
  items: PoseIndexItem[]
) {
  const data: PoseIndexDocument = {
    version: 1,
    updatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  const content = JSON.stringify(data, null, 2);
  const result = await driveUploadText(token, folderId, fileId, INDEX_NAME, content);
  return result.id ?? fileId;
}

export async function buildSetIndex(token: string, folderId: string) {
  const images = await listImagesRecursive(token, folderId);
  return images.map((image) => ({ id: image.id, name: image.name }));
}

export function indexItemsToImages(items: PoseIndexItem[]): DriveImage[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: 'image/jpeg',
  }));
}
