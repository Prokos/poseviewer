export function createProxyThumbUrl(
  fileId: string,
  size: number,
  cacheKey?: number,
  options?: { fresh?: boolean }
) {
  const cacheParam = typeof cacheKey === 'number' ? `&v=${cacheKey}` : '';
  const freshParam = options?.fresh ? '&fresh=1' : '';
  return `/api/thumb/${encodeURIComponent(fileId)}?size=${size}${cacheParam}${freshParam}`;
}

export function createProxyMediaUrl(fileId: string, cacheKey?: number) {
  const cacheParam = typeof cacheKey === 'number' ? `?v=${cacheKey}` : '';
  return `/api/media/${encodeURIComponent(fileId)}${cacheParam}`;
}
