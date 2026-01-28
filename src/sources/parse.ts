import type { SourceConfig, SourceImage, SourceSet } from './types';

function createContainer(html: string) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

function resolveAbsoluteUrl(baseUrl: string, url: string | null) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

const IMAGE_URL_ATTRS = [
  'src',
  'data-src',
  'data-original',
  'data-lazy',
  'data-lazy-src',
  'data-srcset',
  'srcset',
];

function readSrcset(value: string) {
  const first = value.split(',')[0]?.trim();
  if (!first) {
    return null;
  }
  return first.split(' ')[0] ?? null;
}

function readImageUrl(element: Element | null) {
  if (!element) {
    return null;
  }
  for (const attr of IMAGE_URL_ATTRS) {
    const value = element.getAttribute(attr);
    if (!value) {
      continue;
    }
    if (attr.endsWith('srcset')) {
      const resolved = readSrcset(value);
      if (resolved) {
        return resolved;
      }
      continue;
    }
    return value;
  }
  return null;
}

export function parseSourceSets(config: SourceConfig, html: string): SourceSet[] {
  const container = createContainer(html);
  const items = Array.from(container.querySelectorAll(config.selectors.setItem));
  const mapped = items
    .map((item) => {
      const link = item.querySelector<HTMLAnchorElement>(config.selectors.setLink);
      const titleNode = item.querySelector<HTMLElement>(config.selectors.setTitle);
      const titleText = titleNode?.textContent?.trim() ?? '';
      const altText =
        titleNode instanceof HTMLImageElement ? titleNode.alt?.trim() ?? '' : '';
      const thumb = item.querySelector<HTMLImageElement>(config.selectors.setThumb);
      const href = link?.getAttribute('href') ?? '';
      if (!href) {
        return null;
      }
      const idMatch = href.match(/\/album\/(\d+)/);
      const id = idMatch ? idMatch[1] : href;
      return {
        id,
        title: titleText || altText || 'Untitled set',
        thumbUrl: resolveAbsoluteUrl(config.baseUrl, readImageUrl(thumb)),
        href,
      };
    })
    .filter((item): item is SourceSet => Boolean(item));
  if (mapped.length > 0) {
    return mapped;
  }
  const fallbackImages = Array.from(container.querySelectorAll<HTMLImageElement>('a[href] img'));
  const fallbackSets = fallbackImages
    .map((img) => {
      const link = img.closest<HTMLAnchorElement>('a[href]');
      const href = link?.getAttribute('href') ?? '';
      if (!href) {
        return null;
      }
      const idMatch = href.match(/\/album\/(\d+)/);
      const id = idMatch ? idMatch[1] : href;
      const title = img.alt?.trim() ?? 'Untitled set';
      const thumbUrl = readImageUrl(img);
      if (!thumbUrl) {
        return null;
      }
      return {
        id,
        title,
        thumbUrl: resolveAbsoluteUrl(config.baseUrl, thumbUrl),
        href,
      } satisfies SourceSet;
    })
    .filter((item): item is SourceSet => Boolean(item));
  if (fallbackSets.length === 0) {
    return mapped;
  }
  const unique = new Map<string, SourceSet>();
  for (const item of fallbackSets) {
    unique.set(item.id, item);
  }
  return Array.from(unique.values());
}

export function parseAlbumImages(config: SourceConfig, html: string) {
  const container = createContainer(html);
  const titleNode = container.querySelector<HTMLElement>(config.albumSelectors.albumTitle);
  const title = titleNode?.textContent?.trim() ?? '';
  const items = Array.from(container.querySelectorAll(config.albumSelectors.imageItem));
  const images = items
    .map((item) => {
      const id =
        item.getAttribute(config.albumSelectors.imageIdAttr) ??
        (item instanceof HTMLImageElement ? readImageUrl(item) : null);
      const thumb =
        item.getAttribute(config.albumSelectors.imageThumbAttr) ??
        readImageUrl(item) ??
        item.getAttribute('src');
      const fullAttr = config.albumSelectors.imageFullAttr;
      const fullCandidate = fullAttr ? item.getAttribute(fullAttr) ?? undefined : undefined;
      const width =
        item instanceof HTMLImageElement ? Number(item.getAttribute('width')) : undefined;
      const height =
        item instanceof HTMLImageElement ? Number(item.getAttribute('height')) : undefined;
      if (!id || !thumb) {
        return null;
      }
      const fullUrl =
        fullCandidate && fullCandidate !== thumb
          ? resolveAbsoluteUrl(config.baseUrl, fullCandidate) ?? undefined
          : undefined;
      return {
        id,
        thumbUrl: resolveAbsoluteUrl(config.baseUrl, thumb) ?? thumb,
        fullUrl,
        width: Number.isFinite(width) ? width : undefined,
        height: Number.isFinite(height) ? height : undefined,
      } satisfies SourceImage;
    })
    .filter((item): item is SourceImage => Boolean(item));
  return { title, images };
}
