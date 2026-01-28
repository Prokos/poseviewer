import { driveDownloadText, driveList, driveUploadText } from '../drive/api';
import type { SourceConfigDocument, SourceStateDocument } from './types';
import { DEFAULT_SOURCE_CONFIG } from './defaults';
import type { SourceConfig, SourceConfigDocument } from './types';

const CONFIG_FILE_NAME = 'sources_config.json';
const STATE_FILE_NAME = 'sources_state.json';

export const SOURCES_ROOT_FOLDER_ID = '1YwRXWdy9CKURpAhUCtNMoJ5pwI8hJZY4';

export function createEmptyState(): SourceStateDocument {
  return { version: 1, sources: {} };
}

function mergeSourceConfig(source: SourceConfig, fallback: SourceConfig): SourceConfig {
  return {
    ...fallback,
    ...source,
    list: { ...fallback.list, ...source.list },
    selectors: { ...fallback.selectors, ...source.selectors },
    album: { ...fallback.album, ...source.album },
    albumSelectors: { ...fallback.albumSelectors, ...source.albumSelectors },
    photo: { ...fallback.photo, ...source.photo },
  };
}

function normalizeSourceConfig(raw: SourceConfigDocument): SourceConfigDocument {
  const fallbackById = new Map(DEFAULT_SOURCE_CONFIG.sources.map((source) => [source.id, source]));
  const mergedSources = raw.sources.map((source) => {
    const fallback = fallbackById.get(source.id);
    return fallback ? mergeSourceConfig(source, fallback) : source;
  });
  for (const fallback of DEFAULT_SOURCE_CONFIG.sources) {
    if (!mergedSources.find((source) => source.id === fallback.id)) {
      mergedSources.push(fallback);
    }
  }
  return {
    version: 1,
    sources: mergedSources,
  };
}

async function findFileId(folderId: string, name: string) {
  const files = await driveList(
    {
      q: `'${folderId}' in parents and name='${name}' and trashed=false`,
      pageSize: '1',
    },
    'nextPageToken,files(id,name)'
  );
  return files[0]?.id ?? null;
}

export async function loadSourceConfig() {
  const fileId = await findFileId(SOURCES_ROOT_FOLDER_ID, CONFIG_FILE_NAME);
  if (!fileId) {
    const created = await driveUploadText(
      SOURCES_ROOT_FOLDER_ID,
      null,
      CONFIG_FILE_NAME,
      JSON.stringify(DEFAULT_SOURCE_CONFIG, null, 2)
    );
    return { fileId: created.id, config: DEFAULT_SOURCE_CONFIG };
  }
  const raw = await driveDownloadText(fileId);
  try {
    const parsed = JSON.parse(raw) as SourceConfigDocument;
    if (parsed?.version === 1 && Array.isArray(parsed.sources)) {
      return { fileId, config: normalizeSourceConfig(parsed) };
    }
  } catch {
    // fall back to default
  }
  return { fileId, config: DEFAULT_SOURCE_CONFIG };
}

export async function loadSourceState() {
  const fileId = await findFileId(SOURCES_ROOT_FOLDER_ID, STATE_FILE_NAME);
  if (!fileId) {
    const empty = createEmptyState();
    const created = await driveUploadText(
      SOURCES_ROOT_FOLDER_ID,
      null,
      STATE_FILE_NAME,
      JSON.stringify(empty, null, 2)
    );
    return { fileId: created.id, state: empty };
  }
  const raw = await driveDownloadText(fileId);
  try {
    const parsed = JSON.parse(raw) as SourceStateDocument;
    if (parsed?.version === 1 && parsed.sources) {
      return { fileId, state: parsed };
    }
  } catch {
    // fall back to empty state
  }
  return { fileId, state: createEmptyState() };
}

export async function saveSourceState(fileId: string | null, state: SourceStateDocument) {
  const content = JSON.stringify(state, null, 2);
  const result = await driveUploadText(
    SOURCES_ROOT_FOLDER_ID,
    fileId,
    STATE_FILE_NAME,
    content
  );
  return result.id ?? fileId;
}
