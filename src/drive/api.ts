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

export async function driveDownloadText(fileId: string) {
  const response = await fetch(`/api/drive/download/${encodeURIComponent(fileId)}`);
  await ensureOk(response, 'Drive download');
  return response.text();
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
