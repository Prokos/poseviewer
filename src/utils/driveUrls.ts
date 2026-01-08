export function createProxyThumbUrl(fileId: string, size: number) {
  return `/api/thumb/${encodeURIComponent(fileId)}?size=${size}`;
}

export function createProxyMediaUrl(fileId: string) {
  return `/api/media/${encodeURIComponent(fileId)}`;
}
