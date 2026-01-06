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
  excludePaths?: string[];
  ignoreIds?: Set<string>;
  ignorePaths?: string[];
  maxCount?: number;
  maxConcurrent?: number;
  onProgress?: (count: number, currentPath: string) => void;
};

export async function listFolderPaths(
  token: string,
  rootId: string,
  options: FolderScanOptions = {}
) {
  const root = await driveGetFile(token, rootId, 'id,name');
  const excludeIds = options.excludeIds ?? new Set<string>();
  const excludePaths = options.excludePaths ?? [];
  const ignoreIds = options.ignoreIds ?? new Set<string>();
  const ignorePaths = options.ignorePaths ?? [];
  const maxCount = options.maxCount ?? 50;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const onProgress = options.onProgress;

  const folders: FolderPath[] = [];
  const rootPath = {
    id: root.id,
    name: root.name,
    path: root.name,
  };

  const queue: FolderPath[] = [rootPath];
  let stop = false;

  const worker = async () => {
    while (!stop) {
      const current = queue.shift();
      if (!current) {
        return;
      }

      const isRoot = current.id === root.id;
      const isExcluded =
        excludeIds.has(current.id) ||
        excludePaths.some(
          (prefix) => current.path === prefix || current.path.startsWith(`${prefix}/`)
        );
      const isIgnored = ignoreIds.has(current.id) || ignorePaths.includes(current.path);

      if (isExcluded && !isRoot) {
        continue;
      }

      if (!isExcluded && !isIgnored && !stop) {
        if (folders.length < maxCount) {
          folders.push(current);
          if (onProgress) {
            onProgress(folders.length, current.path);
          }
          if (folders.length >= maxCount) {
            stop = true;
          }
        } else {
          stop = true;
        }
      }

      if (stop) {
        continue;
      }

      if (!isExcluded || isRoot) {
        const children = await driveList(
          token,
          {
            q: `'${current.id}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
          },
          'nextPageToken,files(id,name,mimeType)'
        );

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
    }
  };

  const workers = Array.from({ length: Math.max(1, maxConcurrent) }, () => worker());
  await Promise.all(workers);
  return folders.slice(0, maxCount);
}

export async function listImagesRecursive(
  token: string,
  folderId: string,
  maxCount = Infinity
) {
  const images: Array<DriveImage & { folderPath: string }> = [];
  const queue: Array<{ id: string; path: string }> = [{ id: folderId, path: '' }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const children = await driveList(
      token,
      {
        q: `'${current.id}' in parents and trashed=false`,
      },
      'nextPageToken,files(id,name,mimeType)'
    );

    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        const nextPath = current.path ? `${current.path}/${child.name}` : child.name;
        queue.push({ id: child.id, path: nextPath });
      } else if (child.mimeType.startsWith('image/')) {
        images.push({ ...(child as DriveImage), folderPath: current.path });
      }
    }
  }

  images.sort((a, b) => {
    const pathDiff = a.folderPath.localeCompare(b.folderPath, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (pathDiff !== 0) {
      return pathDiff;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
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
