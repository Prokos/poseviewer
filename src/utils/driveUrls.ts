export function createProxyThumbUrl(
  fileId: string,
  size: number,
  cacheKey?: number,
  options?: { fresh?: boolean; version?: number }
) {
  const params = new URLSearchParams({ size: String(size) });
  if (typeof cacheKey === 'number') {
    params.set('v', String(cacheKey));
  }
  if (typeof options?.version === 'number' && options.version > 0) {
    params.set('iv', String(options.version));
  }
  if (options?.fresh) {
    params.set('fresh', '1');
  }
  return `/api/thumb/${encodeURIComponent(fileId)}?${params.toString()}`;
}

export function createProxyMediaUrl(
  fileId: string,
  cacheKey?: number,
  options?: { fresh?: boolean; version?: number }
) {
  const params = new URLSearchParams();
  if (typeof cacheKey === 'number') {
    params.set('v', String(cacheKey));
  }
  if (typeof options?.version === 'number' && options.version > 0) {
    params.set('iv', String(options.version));
  }
  if (options?.fresh) {
    params.set('fresh', '1');
  }
  const query = params.toString();
  return `/api/media/${encodeURIComponent(fileId)}${query ? `?${query}` : ''}`;
}
