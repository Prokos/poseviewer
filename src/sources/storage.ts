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

async function findFileId(folderId: string, name: string, orderBy?: string) {
  const files = await driveList(
    {
      q: `'${folderId}' in parents and name='${name}' and trashed=false`,
      ...(orderBy ? { orderBy } : {}),
      pageSize: '1',
    },
    'nextPageToken,files(id,name,modifiedTime)'
  );
  return files[0]?.id ?? null;
}

async function listFilesByName(folderId: string, name: string, orderBy?: string) {
  return driveList(
    {
      q: `'${folderId}' in parents and name='${name}' and trashed=false`,
      ...(orderBy ? { orderBy } : {}),
      pageSize: '100',
    },
    'nextPageToken,files(id,name,modifiedTime)'
  );
}

function mergeStringList(base: string[] = [], incoming: string[] = []) {
  if (incoming.length === 0) {
    return base.slice();
  }
  const seen = new Set(base);
  const merged = base.slice();
  for (const value of incoming) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

function mergeImageMap(
  base: Record<string, string[]> = {},
  incoming: Record<string, string[]> = {}
) {
  const merged: Record<string, string[]> = { ...base };
  for (const [setId, list] of Object.entries(incoming)) {
    merged[setId] = mergeStringList(merged[setId] ?? [], list ?? []);
  }
  return merged;
}

function mergeSourceStateDocuments(
  base: SourceStateDocument,
  incoming: SourceStateDocument
): SourceStateDocument {
  const mergedSources: SourceStateDocument['sources'] = { ...base.sources };
  for (const [sourceId, entry] of Object.entries(incoming.sources ?? {})) {
    const existing = mergedSources[sourceId] ?? {
      subdir: '',
      downloadedSets: [],
      hiddenSets: [],
      downloadedImages: {},
      hiddenImages: {},
    };
    const nextSubdir = existing.subdir?.trim() ? existing.subdir : entry.subdir ?? '';
    mergedSources[sourceId] = {
      subdir: nextSubdir,
      downloadedSets: mergeStringList(existing.downloadedSets, entry.downloadedSets),
      hiddenSets: mergeStringList(existing.hiddenSets, entry.hiddenSets),
      downloadedImages: mergeImageMap(existing.downloadedImages, entry.downloadedImages),
      hiddenImages: mergeImageMap(existing.hiddenImages, entry.hiddenImages),
    };
  }
  return { version: 1, sources: mergedSources };
}

export async function loadSourceConfig() {
  const fileId = await findFileId(
    SOURCES_ROOT_FOLDER_ID,
    CONFIG_FILE_NAME,
    'modifiedTime desc'
  );
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
  const files = await listFilesByName(
    SOURCES_ROOT_FOLDER_ID,
    STATE_FILE_NAME,
    'modifiedTime desc'
  );
  const fileId = files[0]?.id ?? null;
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
  let merged = createEmptyState();
  let validCount = 0;
  for (const file of files) {
    if (!file.id) {
      continue;
    }
    try {
      const raw = await driveDownloadText(file.id);
      const parsed = JSON.parse(raw) as SourceStateDocument;
      if (parsed?.version === 1 && parsed.sources) {
        merged = mergeSourceStateDocuments(merged, parsed);
        validCount += 1;
      }
    } catch {
      // Ignore invalid entries and keep merging.
    }
  }
  if (validCount > 1) {
    try {
      await driveUploadText(
        SOURCES_ROOT_FOLDER_ID,
        fileId,
        STATE_FILE_NAME,
        JSON.stringify(merged, null, 2)
      );
    } catch {
      // Ignore failures; we still return the merged view.
    }
  }
  if (validCount > 0) {
    return { fileId, state: merged };
  }
  return { fileId, state: createEmptyState() };
}

export async function saveSourceState(fileId: string | null, state: SourceStateDocument) {
  const files = await listFilesByName(
    SOURCES_ROOT_FOLDER_ID,
    STATE_FILE_NAME,
    'modifiedTime desc'
  );
  let merged = createEmptyState();
  let validCount = 0;
  for (const file of files) {
    if (!file.id) {
      continue;
    }
    try {
      const raw = await driveDownloadText(file.id);
      const parsed = JSON.parse(raw) as SourceStateDocument;
      if (parsed?.version === 1 && parsed.sources) {
        merged = mergeSourceStateDocuments(merged, parsed);
        validCount += 1;
      }
    } catch {
      // Ignore invalid entries and keep merging.
    }
  }
  merged = mergeSourceStateDocuments(merged, state);
  const content = JSON.stringify(merged, null, 2);
  const resolvedId = fileId ?? files[0]?.id ?? null;
  const result = await driveUploadText(
    SOURCES_ROOT_FOLDER_ID,
    resolvedId,
    STATE_FILE_NAME,
    content
  );
  return result.id ?? resolvedId ?? fileId;
}
