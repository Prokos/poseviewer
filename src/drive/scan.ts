import { driveGetFile, driveList } from './api';
import type { DriveFile, DriveImage } from './types';

export type FolderPath = {
  id: string;
  name: string;
  path: string;
  parentId?: string;
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';

type FolderScanOptions = {
  excludeIds?: Set<string>;
  maxCount?: number;
};

export async function listFolderPaths(
  token: string,
  rootId: string,
  options: FolderScanOptions = {}
) {
  const root = await driveGetFile(token, rootId, 'id,name');
  const excludeIds = options.excludeIds ?? new Set<string>();
  const maxCount = options.maxCount ?? 50;

  const folders: FolderPath[] = [];
  const rootPath = {
    id: root.id,
    name: root.name,
    path: root.name,
  };

  const queue: FolderPath[] = [rootPath];

  while (queue.length > 0) {
    if (folders.length >= maxCount) {
      break;
    }
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (excludeIds.has(current.id)) {
      continue;
    }

    folders.push(current);

    if (folders.length >= maxCount) {
      break;
    }

    const children = await driveList(token, {
      q: `'${current.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    });

    for (const child of children) {
      const childPath = {
        id: child.id,
        name: child.name,
        path: `${current.path}/${child.name}`,
        parentId: current.id,
      };
      if (!excludeIds.has(child.id)) {
        queue.push(childPath);
      }
    }
  }

  return folders;
}

export async function listImagesRecursive(
  token: string,
  folderId: string,
  maxCount = Infinity
) {
  const images: DriveImage[] = [];
  const queue: string[] = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }

    const children = await driveList(token, {
      q: `'${currentId}' in parents and trashed=false`,
    });

    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        queue.push(child.id);
      } else if (child.mimeType.startsWith('image/')) {
        images.push(child as DriveImage);
      }
    }
  }

  images.sort((a, b) => a.name.localeCompare(b.name));
  if (Number.isFinite(maxCount)) {
    return images.slice(0, maxCount);
  }
  return images;
}

export function filterImages(files: DriveFile[]): DriveImage[] {
  return files.filter(
    (file) => file.mimeType !== FOLDER_MIME && file.mimeType.startsWith('image/')
  ) as DriveImage[];
}
