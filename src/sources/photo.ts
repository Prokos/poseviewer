import type { SourceConfig } from './types';
import { fetchSource } from './api';

function annihilate(input: string, key: number) {
  let result = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i) ^ key;
    result += String.fromCharCode(code);
  }
  return result;
}

export function buildSpirit(config: SourceConfig) {
  return annihilate(config.photo.spiritSeed, config.photo.spiritKey);
}

export async function fetchPhotoInfo(config: SourceConfig, photoId: string) {
  let spiritSeed = config.photo.spiritSeed;
  let spiritKey = config.photo.spiritKey;
  if (config.photo.iframePathTemplate) {
    try {
      const iframeUrl = new URL(
        config.photo.iframePathTemplate.replace('{id}', photoId),
        config.baseUrl
      );
      const response = await fetchSource(iframeUrl.toString(), {
        headers: {
          Accept: 'text/html, */*; q=0.9',
          Referer: config.baseUrl,
          'User-Agent': navigator.userAgent,
        },
      });
      const html = await response.text();
      let match: RegExpMatchArray | null = null;
      if (config.photo.spiritRegex) {
        const regex = new RegExp(config.photo.spiritRegex);
        match = html.match(regex);
      }
      if (!match) {
        match = html.match(/annihilate\((['"])(.*?)\1\s*,\s*(\d+)\)/);
      }
      if (match && match[2]) {
        spiritSeed = match[2];
        const parsedKey = Number(match[3]);
        if (!Number.isNaN(parsedKey)) {
          spiritKey = parsedKey;
        }
      }
    } catch {
      // Fall back to configured seed.
    }
  }
  const spirit = buildSpirit({
    ...config,
    photo: { ...config.photo, spiritSeed, spiritKey },
  });
  const url = new URL(config.photo.endpoint, config.baseUrl);
  url.searchParams.set('spirit', spirit);
  url.searchParams.set('photo', photoId);
  const response = await fetchSource(url.toString(), {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: config.baseUrl,
      'User-Agent': navigator.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  const data = (await response.json()) as [string, string, string];
  return {
    url: data[0],
    width: Number(data[1]),
    height: Number(data[2]),
  };
}
