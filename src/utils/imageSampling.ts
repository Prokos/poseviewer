import { pickRandom } from './random';
import type { DriveImage } from '../drive/types';

export type SeenMap = Map<string, Set<string>>;
export type FavoriteFilterMode = 'all' | 'favorites' | 'nonfavorites';
export type HiddenFilterMode = 'all' | 'hidden' | 'visible';

export function pickNextBatch(
  setId: string,
  images: DriveImage[],
  count: number,
  seenMap: SeenMap
) {
  if (images.length === 0) {
    seenMap.set(setId, new Set());
    return [];
  }
  const seen = seenMap.get(setId) ?? new Set<string>();
  const availableIds = new Set(images.map((image) => image.id));
  for (const id of seen) {
    if (!availableIds.has(id)) {
      seen.delete(id);
    }
  }
  if (seen.size >= images.length) {
    seen.clear();
  }
  const unseen = images.filter((image) => !seen.has(image.id));
  const pool = unseen.length > 0 ? unseen : images;
  const sample = pickRandom(pool, Math.min(count, pool.length));
  for (const image of sample) {
    seen.add(image.id);
  }
  seenMap.set(setId, seen);
  return sample;
}

export function createBatchPicker(seenMap: SeenMap) {
  return (setId: string, images: DriveImage[], count: number) =>
    pickNextBatch(setId, images, count, seenMap);
}

export function filterImagesByFavoriteStatus(
  images: DriveImage[],
  favoriteIds: string[],
  mode: FavoriteFilterMode
) {
  if (mode === 'all') {
    return images;
  }
  if (favoriteIds.length === 0) {
    return mode === 'favorites' ? [] : images;
  }
  const favorites = new Set(favoriteIds);
  return images.filter((image) =>
    mode === 'favorites' ? favorites.has(image.id) : !favorites.has(image.id)
  );
}

export function filterImagesByHiddenStatus(
  images: DriveImage[],
  hiddenIds: string[],
  mode: HiddenFilterMode
) {
  if (mode === 'all') {
    return images;
  }
  if (hiddenIds.length === 0) {
    return mode === 'hidden' ? [] : images;
  }
  const hidden = new Set(hiddenIds);
  return images.filter((image) =>
    mode === 'hidden' ? hidden.has(image.id) : !hidden.has(image.id)
  );
}

export function appendUniqueImages(current: DriveImage[], next: DriveImage[]) {
  if (next.length === 0) {
    return current;
  }
  const existingIds = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of next) {
    if (!existingIds.has(item.id)) {
      merged.push(item);
    }
  }
  return merged;
}
