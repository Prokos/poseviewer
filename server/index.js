import express from 'express';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const CACHE_DIR = process.env.CACHE_DIR
  ? path.resolve(process.env.CACHE_DIR)
  : path.resolve(process.cwd(), '.cache');
const THUMB_CACHE_DIR = path.join(CACHE_DIR, 'thumbs');
const MEDIA_CACHE_DIR = path.join(CACHE_DIR, 'media');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SIZE = 320;
const MAX_SIZE = 1600;

await fs.mkdir(THUMB_CACHE_DIR, { recursive: true });
await fs.mkdir(MEDIA_CACHE_DIR, { recursive: true });

function parseCookies(header) {
  if (!header) {
    return {};
  }
  return header.split(';').reduce((acc, part) => {
    const [key, ...valueParts] = part.trim().split('=');
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(valueParts.join('='));
    return acc;
  }, {});
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

async function fetchDriveThumbnail(fileId, token) {
  const metaResponse = await fetch(
    `${DRIVE_BASE}/files/${fileId}?fields=thumbnailLink&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
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

  const thumbUrl = new URL(thumbLink);
  if (!thumbUrl.searchParams.get('access_token')) {
    thumbUrl.searchParams.set('access_token', token);
  }

  const thumbResponse = await fetch(thumbUrl.toString());
  if (!thumbResponse.ok) {
    return null;
  }

  const arrayBuffer = await thumbResponse.arrayBuffer();
  const contentType = thumbResponse.headers.get('content-type') ?? 'image/jpeg';
  return { data: Buffer.from(arrayBuffer), contentType };
}

app.get('/api/thumb/:fileId', async (req, res) => {
  const sizeParam = Number(req.query.size);
  const size = clampSize(sizeParam || DEFAULT_SIZE);
  const { fileId } = req.params;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.poseviewer_token;

  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    return;
  }

  const cachePath = path.join(THUMB_CACHE_DIR, `${fileId}-${size}.webp`);
  const cacheMetaPath = path.join(THUMB_CACHE_DIR, `${fileId}-${size}.json`);
  const cached = await readCacheWithMeta(cachePath, cacheMetaPath);
  if (cached) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    res.type(cached.meta.contentType || 'image/webp').send(cached.data);
    return;
  }

  const legacyCached = await readCache(cachePath);
  if (legacyCached) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    res.type('image/webp').send(legacyCached);
    return;
  }

  try {
    const thumbResult = await fetchDriveThumbnail(fileId, token);
    if (thumbResult) {
      await writeCacheWithMeta(cachePath, cacheMetaPath, thumbResult.data, {
        contentType: thumbResult.contentType,
      });
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
    const output = await sharp(buffer)
      .resize({ width: size, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await writeCacheWithMeta(cachePath, cacheMetaPath, output, {
      contentType: 'image/webp',
    });

    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    res.type('image/webp').send(output);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error && error.message) || 'Unknown error' });
  }
});

app.get('/api/media/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.poseviewer_token;

  if (!token) {
    res.status(401).json({ error: 'Missing access token.' });
    return;
  }

  const cachePath = path.join(MEDIA_CACHE_DIR, `${fileId}.bin`);
  const metaPath = path.join(MEDIA_CACHE_DIR, `${fileId}.json`);
  const cached = await readCacheWithMeta(cachePath, metaPath);
  if (cached) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'HIT');
    res.type(cached.meta.contentType || 'application/octet-stream').send(cached.data);
    return;
  }

  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).send(text);
      return;
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await writeCacheWithMeta(cachePath, metaPath, buffer, { contentType });

    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    res.type(contentType).send(buffer);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error && error.message) || 'Unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`Pose Viewer proxy running on http://localhost:${PORT}`);
});
