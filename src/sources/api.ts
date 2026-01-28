type SourceFetchOptions = {
  headers?: Record<string, string>;
};

export async function fetchSource(url: string, options: SourceFetchOptions = {}) {
  const response = await fetch('/api/source/fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, headers: options.headers }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Source fetch failed: ${response.status}`);
  }
  return response;
}
