import { driveDownloadText, driveList, driveUploadText } from './drive/api';

export type PoseSet = {
  id: string;
  name: string;
  rootFolderId: string;
  rootPath: string;
  tags: string[];
  thumbnailFileId?: string;
};

export type MetadataDocument = {
  version: 1;
  sets: PoseSet[];
};

const METADATA_NAME = 'metadata.txt';

export async function loadMetadata(token: string, rootId: string) {
  const files = await driveList(token, {
    q: `'${rootId}' in parents and name='${METADATA_NAME}' and trashed=false`,
    pageSize: '1',
  });

  if (files.length === 0) {
    return { fileId: null, data: emptyMetadata() };
  }

  const fileId = files[0].id;
  const text = await driveDownloadText(token, fileId);

  try {
    const parsed = JSON.parse(text) as MetadataDocument;
    if (parsed?.version === 1 && Array.isArray(parsed.sets)) {
      return { fileId, data: parsed };
    }
  } catch {
    // fall through to empty
  }

  return { fileId, data: emptyMetadata() };
}

export async function saveMetadata(
  token: string,
  rootId: string,
  fileId: string | null,
  data: MetadataDocument
) {
  const content = JSON.stringify(data, null, 2);
  const result = await driveUploadText(token, rootId, fileId, METADATA_NAME, content);
  return result.id ?? fileId;
}

export function emptyMetadata(): MetadataDocument {
  return { version: 1, sets: [] };
}

export function createPoseSet(partial: Omit<PoseSet, 'id'>): PoseSet {
  return {
    id: crypto.randomUUID(),
    ...partial,
  };
}
