import type { DriveFile } from './types';

async function ensureOk(response: Response, label: string) {
  if (response.ok) {
    return;
  }
  if (response.status === 401) {
    throw new Error('Not connected to Google Drive. Click Connect to continue.');
  }
  throw new Error(`${label} failed: ${response.status}`);
}

export async function driveList(
  params: Record<string, string>,
  fields = 'nextPageToken,files(id,name,mimeType,parents,thumbnailLink)'
): Promise<DriveFile[]> {
  const response = await fetch('/api/drive/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ params, fields }),
  });

  await ensureOk(response, 'Drive list');

  const data = (await response.json()) as { files: DriveFile[] };
  return data.files ?? [];
}

export async function driveGetFile(fileId: string, fields: string): Promise<DriveFile> {
  const response = await fetch(
    `/api/drive/file/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`
  );
  await ensureOk(response, 'Drive get');
  return (await response.json()) as DriveFile;
}

export async function driveDownloadText(
  fileId: string,
  onProgress?: (progress: { loaded: number }) => void
) {
  const response = await fetch(`/api/drive/download/${encodeURIComponent(fileId)}`);
  await ensureOk(response, 'Drive download');
  if (!response.body) {
    return response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      loaded += value.length;
      result += decoder.decode(value, { stream: true });
      if (onProgress) {
        onProgress({ loaded });
      }
    }
  }
  result += decoder.decode();
  return result;
}

export async function driveDownloadBlob(fileId: string) {
  const response = await fetch(`/api/drive/download/${encodeURIComponent(fileId)}`);
  await ensureOk(response, 'Drive download');
  return response.blob();
}

export async function driveUploadText(
  folderId: string,
  fileId: string | null,
  filename: string,
  content: string
) {
  const response = await fetch('/api/drive/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ folderId, fileId, filename, content }),
  });
  await ensureOk(response, 'Drive upload');
  return response.json() as Promise<{ id: string }>;
}

export async function driveRotateImage(fileId: string, angle: 90 | -90) {
  const response = await fetch('/api/drive/rotate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId, angle }),
  });
  await ensureOk(response, 'Drive rotate');
  return response.json() as Promise<{ ok: boolean }>;
}
