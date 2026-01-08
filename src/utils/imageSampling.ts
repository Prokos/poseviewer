import { pickRandom } from './random';
import type { DriveImage } from '../drive/types';

export type SeenMap = Map<string, Set<string>>;

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
