import type { DriveFile } from './types';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export async function driveList(
  token: string,
  params: Record<string, string>,
  fields = 'nextPageToken,files(id,name,mimeType,parents,thumbnailLink)'
): Promise<DriveFile[]> {
  const searchParams = new URLSearchParams({
    fields,
    pageSize: '1000',
    ...params,
  });

  const files: DriveFile[] = [];
  let pageToken = '';

  do {
    if (pageToken) {
      searchParams.set('pageToken', pageToken);
    } else {
      searchParams.delete('pageToken');
    }

    const response = await fetch(`${DRIVE_BASE}/files?${searchParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Drive list failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };

    files.push(...data.files);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  return files;
}

export async function driveGetFile(
  token: string,
  fileId: string,
  fields: string
): Promise<DriveFile> {
  const response = await fetch(
    `${DRIVE_BASE}/files/${fileId}?fields=${encodeURIComponent(fields)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Drive get failed: ${response.status}`);
  }

  return (await response.json()) as DriveFile;
}

export async function driveDownloadText(token: string, fileId: string) {
  const response = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Drive download failed: ${response.status}`);
  }

  return response.text();
}

export async function driveDownloadBlob(token: string, fileId: string) {
  const response = await fetch(
    `${DRIVE_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Drive download failed: ${response.status}`);
  }

  return response.blob();
}

export async function driveUploadText(
  token: string,
  folderId: string,
  fileId: string | null,
  filename: string,
  content: string
) {
  const metadata = {
    name: filename,
    parents: fileId ? undefined : [folderId],
    mimeType: 'text/plain',
  };

  const boundary = 'poseviewer-boundary';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const url = fileId
    ? `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;

  const method = fileId ? 'PATCH' : 'POST';

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Drive upload failed: ${response.status}`);
  }

  return response.json() as Promise<{ id: string }>;
}
