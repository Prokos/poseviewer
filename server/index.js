import 'dotenv/config';
import express from 'express';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_BASE = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${PORT}/api/auth/callback`;
const CACHE_DIR = process.env.CACHE_DIR
  ? path.resolve(process.env.CACHE_DIR)
  : path.resolve(process.cwd(), '.cache');
const THUMB_CACHE_DIR = path.join(CACHE_DIR, 'thumbs');
const MEDIA_CACHE_DIR = path.join(CACHE_DIR, 'media');
const TOKEN_CACHE_PATH = path.join(CACHE_DIR, 'oauth.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL_MS = Number(process.env.CACHE_CLEANUP_MS ?? 60 * 60 * 1000);
const MAX_MEDIA_CACHE_BYTES = Number(process.env.MEDIA_CACHE_MAX_MB ?? 10000) * 1024 * 1024;
const MAX_THUMB_CACHE_BYTES = Number(process.env.THUMB_CACHE_MAX_MB ?? 2000) * 1024 * 1024;
const DEFAULT_SIZE = 320;
const MAX_SIZE = 1600;
const MAX_MEDIA_CONCURRENCY = Number(process.env.MEDIA_CONCURRENCY ?? 6);
const MAX_MEDIA_QUEUE = Number(process.env.MEDIA_QUEUE ?? 120);
const MAX_THUMB_CONCURRENCY = Number(process.env.THUMB_CONCURRENCY ?? 6);
const MAX_THUMB_QUEUE = Number(process.env.THUMB_QUEUE ?? 50);
const MEDIA_TIMEOUT_MS = Number(process.env.MEDIA_TIMEOUT_MS ?? 20000);

await fs.mkdir(THUMB_CACHE_DIR, { recursive: true });
await fs.mkdir(MEDIA_CACHE_DIR, { recursive: true });

async function pruneCacheDir(dir, dataExt, maxBytes) {
  let entries = [];
  let totalBytes = 0;
  const expiredBefore = Date.now() - CACHE_TTL_MS;
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const dataFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(dataExt));
    for (const entry of dataFiles) {
      const dataPath = path.join(dir, entry.name);
      const metaPath = path.join(dir, `${entry.name.replace(dataExt, '')}.json`);
      try {
        const stat = await fs.stat(dataPath);
        const size = stat.size;
        totalBytes += size;
        entries.push({
          dataPath,
          metaPath,
          size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Ignore missing stat failures.
      }
    }
  } catch {
    return;
  }

  const expired = entries.filter((entry) => entry.mtimeMs < expiredBefore);
  for (const entry of expired) {
    try {
      await fs.rm(entry.dataPath, { force: true });
      await fs.rm(entry.metaPath, { force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }

  entries = entries.filter((entry) => entry.mtimeMs >= expiredBefore);
  totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes <= maxBytes) {
    return;
  }

  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of entries) {
    if (totalBytes <= maxBytes) {
      break;
    }
    try {
      await fs.rm(entry.dataPath, { force: true });
      await fs.rm(entry.metaPath, { force: true });
    } catch {
      // Ignore cleanup failures.
    } finally {
      totalBytes -= entry.size;
    }
  }
}

async function pruneAllCaches() {
  await pruneCacheDir(MEDIA_CACHE_DIR, '.bin', MAX_MEDIA_CACHE_BYTES);
  await pruneCacheDir(THUMB_CACHE_DIR, '.webp', MAX_THUMB_CACHE_BYTES);
}

void pruneAllCaches();
setInterval(() => {
  void pruneAllCaches();
}, CACHE_CLEANUP_INTERVAL_MS);

function createSemaphore(limit, maxQueue = Infinity) {
  let active = 0;
  const queue = [];
  const acquire = () =>
    new Promise((resolve, reject) => {
      if (active < limit) {
        active += 1;
        resolve();
        return;
      }
      if (queue.length >= maxQueue) {
        reject(new Error('Queue full'));
        return;
      }
      queue.push(resolve);
    });
  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return { acquire, release };
}

const mediaSemaphore = createSemaphore(MAX_MEDIA_CONCURRENCY, MAX_MEDIA_QUEUE);
const thumbSemaphore = createSemaphore(MAX_THUMB_CONCURRENCY, MAX_THUMB_QUEUE);

async function fetchWithTimeout(url, options, timeoutMs, signal) {
  const controller = new AbortController();
  const handleAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
  }
}

function clampSize(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIZE;
  }
  return Math.max(64, Math.min(MAX_SIZE, value));
}

async function readCache(filePath) {
  try {
    const stat = await fs.stat(filePath);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) {
      return null;
    }
    const data = await fs.readFile(filePath);
    return data;
  } catch {
    return null;
  }
}

async function readCacheWithMeta(filePath, metaPath) {
  try {
    const stat = await fs.stat(filePath);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) {
      return null;
    }
    const [data, meta] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(metaPath, 'utf-8'),
    ]);
    return { data, meta: JSON.parse(meta) };
  } catch {
    return null;
  }
}

async function writeCacheWithMeta(filePath, metaPath, data, meta) {
  await fs.writeFile(filePath, data);
  await fs.writeFile(metaPath, JSON.stringify(meta));
}

let tokenCache = null;
const oauthState = new Set();

async function readTokenCache() {
  try {
    const text = await fs.readFile(TOKEN_CACHE_PATH, 'utf-8');
    tokenCache = JSON.parse(text);
  } catch {
    tokenCache = null;
  }
}

async function writeTokenCache(next) {
  tokenCache = next;
  await fs.writeFile(TOKEN_CACHE_PATH, JSON.stringify(next, null, 2));
}

async function getAccessToken() {
  if (!tokenCache) {
    await readTokenCache();
  }
  if (!tokenCache?.access_token || !tokenCache?.expires_at) {
    return null;
  }
  if (Date.now() < tokenCache.expires_at - 60 * 1000) {
    return tokenCache.access_token;
  }
  if (!tokenCache.refresh_token || !CLIENT_ID || !CLIENT_SECRET) {
    return null;
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokenCache.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetch(OAUTH_TOKEN_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  const expiresAt = Date.now() + (data.expires_in ?? 0) * 1000;
  await writeTokenCache({
    ...tokenCache,
    access_token: data.access_token,
    expires_at: expiresAt,
    refresh_token: data.refresh_token ?? tokenCache.refresh_token,
  });
  return data.access_token;
}

async function fetchDriveThumbnail(fileId, token, size, signal) {
  const metaResponse = await fetch(
    `${DRIVE_BASE}/files/${fileId}?fields=thumbnailLink&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal,
    }
  );

  if (!metaResponse.ok) {
    return null;
  }

  const meta = await metaResponse.json();
  const thumbLink = meta?.thumbnailLink;
  if (!thumbLink) {
    return null;
  }

  let thumbHref = thumbLink;
  if (Number.isFinite(size)) {
    if (/=s\d+/.test(thumbHref)) {
      thumbHref = thumbHref.replace(/=s\d+/, `=s${size}`);
    } else if (/=w\d+-h\d+/.test(thumbHref)) {
      thumbHref = thumbHref.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
    }
  }

  const thumbUrl = new URL(thumbHref);
  if (!thumbUrl.searchParams.get('access_token')) {
    thumbUrl.searchParams.set('access_token', token);
  }

  const thumbResponse = await fetch(thumbUrl.toString(), { signal });
  if (!thumbResponse.ok) {
    return null;
  }

  const arrayBuffer = await thumbResponse.arrayBuffer();
  const contentType = thumbResponse.headers.get('content-type') ?? 'image/jpeg';
  return { data: Buffer.from(arrayBuffer), contentType };
}

app.get('/api/thumb/:fileId', async (req, res) => {
  const controller = new AbortController();
  const handleClose = () => {
    controller.abort();
  };
  req.on('close', handleClose);
  req.on('aborted', handleClose);
  res.on('close', handleClose);
  try {
    await thumbSemaphore.acquire();
  } catch {
    res.status(429).json({ error: 'Thumb queue full.' });
    return;
  }
  if (controller.signal.aborted) {
    thumbSemaphore.release();
    return;
  }
  const sizeParam = Number(req.query.size);
  const size = clampSize(sizeParam || DEFAULT_SIZE);
  const { fileId } = req.params;
  const token = await getAccessToken();

  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    thumbSemaphore.release();
    return;
  }

  const cachePath = path.join(THUMB_CACHE_DIR, `${fileId}-${size}.webp`);
  const cacheMetaPath = path.join(THUMB_CACHE_DIR, `${fileId}-${size}.json`);
  const cached = await readCacheWithMeta(cachePath, cacheMetaPath);
  if (cached) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    res.type(cached.meta.contentType || 'image/webp').send(cached.data);
    thumbSemaphore.release();
    return;
  }

  const legacyCached = await readCache(cachePath);
  if (legacyCached) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    res.type('image/webp').send(legacyCached);
    thumbSemaphore.release();
    return;
  }

  try {
    const thumbResult = await fetchDriveThumbnail(fileId, token, size, controller.signal);
    if (thumbResult) {
      await writeCacheWithMeta(cachePath, cacheMetaPath, thumbResult.data, {
        contentType: thumbResult.contentType,
      });
      if (controller.signal.aborted) {
        return;
      }
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Cache', 'MISS');
      res.type(thumbResult.contentType).send(thumbResult.data);
      return;
    }

    let buffer;
    {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).send(text);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }
    if (controller.signal.aborted) {
      return;
    }
    const output = await sharp(buffer)
      .resize({ width: size, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await writeCacheWithMeta(cachePath, cacheMetaPath, output, {
      contentType: 'image/webp',
    });

    if (controller.signal.aborted) {
      return;
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    res.type('image/webp').send(output);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    res.status(500).json({ error: (error instanceof Error && error.message) || 'Unknown error' });
  } finally {
    thumbSemaphore.release();
  }
});

app.get('/api/media/:fileId', async (req, res) => {
  const controller = new AbortController();
  const handleClose = () => {
    controller.abort();
  };
  req.on('close', handleClose);
  req.on('aborted', handleClose);
  res.on('close', handleClose);
  try {
    await mediaSemaphore.acquire();
  } catch {
    res.status(429).json({ error: 'Media queue full.' });
    return;
  }
  if (controller.signal.aborted) {
    mediaSemaphore.release();
    return;
  }
  const { fileId } = req.params;
  const token = await getAccessToken();

  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    mediaSemaphore.release();
    return;
  }

  const cachePath = path.join(MEDIA_CACHE_DIR, `${fileId}.bin`);
  const metaPath = path.join(MEDIA_CACHE_DIR, `${fileId}.json`);
  const cached = await readCacheWithMeta(cachePath, metaPath);
  if (cached) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    res.type(cached.meta.contentType || 'application/octet-stream').send(cached.data);
    mediaSemaphore.release();
    return;
  }

  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetchWithTimeout(
          url,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          MEDIA_TIMEOUT_MS,
          controller.signal
        );
        break;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError' && attempt === 0) {
          continue;
        }
        throw error;
      }
    }

    if (!response) {
      res.status(504).send('Upstream timeout');
      return;
    }
    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).send(text);
      return;
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    if (controller.signal.aborted) {
      return;
    }
    const buffer = Buffer.from(arrayBuffer);

    await writeCacheWithMeta(cachePath, metaPath, buffer, { contentType });

    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    res.type(contentType).send(buffer);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    res.status(500).json({ error: (error instanceof Error && error.message) || 'Unknown error' });
  } finally {
    mediaSemaphore.release();
  }
});

app.use(express.json({ limit: '10mb' }));

app.get('/api/auth/start', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).send('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.');
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  oauthState.add(state);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  res.redirect(`${OAUTH_BASE}?${params.toString()}`);
});

app.get('/api/auth/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code || typeof code !== 'string') {
    res.status(400).send('Missing code.');
    return;
  }
  if (!state || typeof state !== 'string' || !oauthState.has(state)) {
    res.status(400).send('Invalid state.');
    return;
  }
  oauthState.delete(state);
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).send('Missing OAuth configuration.');
    return;
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });
    const response = await fetch(OAUTH_TOKEN_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      res.status(500).send(text);
      return;
    }
    const data = await response.json();
    const expiresAt = Date.now() + (data.expires_in ?? 0) * 1000;
    await writeTokenCache({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
    });
    res.send(
      '<html><body><h2>Pose Viewer connected.</h2><p>You can close this window.</p></body></html>'
    );
  } catch (error) {
    res.status(500).send((error instanceof Error && error.message) || 'Unknown error');
  }
});

app.get('/api/auth/status', async (_req, res) => {
  const token = await getAccessToken();
  res.json({ connected: Boolean(token) });
});

app.post('/api/drive/list', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    return;
  }
  const { params, fields } = req.body ?? {};
  const searchParams = new URLSearchParams({
    fields: fields ?? 'nextPageToken,files(id,name,mimeType,parents,thumbnailLink)',
    pageSize: '1000',
    ...params,
  });

  const files = [];
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
      const text = await response.text();
      res.status(response.status).send(text);
      return;
    }
    const data = await response.json();
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  res.json({ files });
});

app.get('/api/drive/file/:fileId', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    return;
  }
  const fields = req.query.fields;
  const fileId = req.params.fileId;
  const response = await fetch(
    `${DRIVE_BASE}/files/${fileId}?fields=${encodeURIComponent(
      fields ?? 'id,name,mimeType,parents,thumbnailLink'
    )}&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    const text = await response.text();
    res.status(response.status).send(text);
    return;
  }
  res.json(await response.json());
});

app.get('/api/drive/download/:fileId', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    return;
  }
  const fileId = req.params.fileId;
  const response = await fetch(
    `${DRIVE_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    const text = await response.text();
    res.status(response.status).send(text);
    return;
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    res.set('Content-Length', contentLength);
  }
  res.set('Content-Type', response.headers.get('content-type') ?? 'application/octet-stream');
  if (!response.body) {
    res.send(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      res.write(Buffer.from(value));
    }
  }
  res.end();
});

app.post('/api/drive/upload', async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    return;
  }
  const { folderId, fileId, filename, content } = req.body ?? {};
  if (!folderId || !filename || typeof content !== 'string') {
    res.status(400).json({ error: 'Missing upload parameters.' });
    return;
  }
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
    ? `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&supportsAllDrives=true`;

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
    const text = await response.text();
    res.status(response.status).send(text);
    return;
  }

  res.json(await response.json());
});

app.listen(PORT, () => {
  console.log(`Pose Viewer proxy running on http://localhost:${PORT}`);
});
