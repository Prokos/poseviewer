import { driveDownloadText, driveGetFile, driveList, driveUploadText } from './drive/api';

export type PoseSet = {
  id: string;
  name: string;
  rootFolderId: string;
  rootPath: string;
  tags: string[];
  thumbnailFileId?: string;
  indexFileId?: string;
  imageCount?: number;
  favoriteImageIds?: string[];
  updatedAt?: number;
};

export type MetadataDocument = {
  version: 1;
  sets: PoseSet[];
};

const METADATA_NAME = 'metadata.txt';

export type MetadataInfo = {
  fileId: string | null;
  md5Checksum?: string;
  modifiedTime?: string;
};

export async function getMetadataInfo(rootId: string): Promise<MetadataInfo> {
  const files = await driveList(
    {
      q: `'${rootId}' in parents and name='${METADATA_NAME}' and trashed=false`,
      pageSize: '1',
    },
    'nextPageToken,files(id,md5Checksum,modifiedTime)'
  );

  if (files.length === 0) {
    return { fileId: null };
  }

  const fileId = files[0].id;
  return {
    fileId,
    md5Checksum: files[0].md5Checksum,
    modifiedTime: files[0].modifiedTime,
  };
}

export async function loadMetadata(rootId: string) {
  const info = await getMetadataInfo(rootId);
  if (!info.fileId) {
    return { fileId: null, data: emptyMetadata() };
  }

  const fileId = info.fileId;
  const text = await driveDownloadText(fileId);

  try {
    const parsed = JSON.parse(text) as MetadataDocument;
    if (parsed?.version === 1 && Array.isArray(parsed.sets)) {
      return { fileId, data: parsed, md5Checksum: info.md5Checksum, modifiedTime: info.modifiedTime };
    }
  } catch {
    // fall through to empty
  }

  return { fileId, data: emptyMetadata(), md5Checksum: info.md5Checksum, modifiedTime: info.modifiedTime };
}

export async function saveMetadata(
  rootId: string,
  fileId: string | null,
  data: MetadataDocument
) {
  const content = JSON.stringify(data, null, 2);
  const result = await driveUploadText(rootId, fileId, METADATA_NAME, content);
  return result.id ?? fileId;
}

export async function saveMetadataWithInfo(
  rootId: string,
  fileId: string | null,
  data: MetadataDocument
) {
  const nextFileId = await saveMetadata(rootId, fileId, data);
  if (!nextFileId) {
    return { fileId: null };
  }
  const file = await driveGetFile(nextFileId, 'id,md5Checksum,modifiedTime');
  return {
    fileId: nextFileId,
    md5Checksum: file.md5Checksum,
    modifiedTime: file.modifiedTime,
  };
}

export function emptyMetadata(): MetadataDocument {
  return { version: 1, sets: [] };
}

export function createPoseSet(partial: Omit<PoseSet, 'id'>): PoseSet {
  return {
    id: crypto.randomUUID(),
    favoriteImageIds: [],
    updatedAt: Date.now(),
    ...partial,
  };
}
