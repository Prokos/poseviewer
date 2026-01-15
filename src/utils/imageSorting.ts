import type { DriveImage } from '../drive/types';
import { hashStringToUnit } from './random';

function parseTimestamp(value: string | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

function compareImageNames(a: DriveImage, b: DriveImage) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortImagesChronological(images: DriveImage[]) {
  return [...images].sort((a, b) => {
    const aExif = parseTimestamp(a.imageMediaMetadata?.time);
    const bExif = parseTimestamp(b.imageMediaMetadata?.time);
    if (aExif !== null || bExif !== null) {
      if (aExif !== null && bExif !== null) {
        if (aExif !== bExif) {
          return aExif - bExif;
        }
        return compareImageNames(a, b);
      }
      return aExif !== null ? -1 : 1;
    }
    const aCreated = parseTimestamp(a.createdTime);
    const bCreated = parseTimestamp(b.createdTime);
    if (aCreated !== null || bCreated !== null) {
      if (aCreated !== null && bCreated !== null) {
        if (aCreated !== bCreated) {
          return aCreated - bCreated;
        }
        return compareImageNames(a, b);
      }
      return aCreated !== null ? -1 : 1;
    }
    return compareImageNames(a, b);
  });
}

export function sortImagesRandomSeeded(images: DriveImage[], seed: string) {
  return [...images].sort((a, b) => {
    const aWeight = hashStringToUnit(`${seed}|${a.id}`);
    const bWeight = hashStringToUnit(`${seed}|${b.id}`);
    if (aWeight !== bWeight) {
      return aWeight - bWeight;
    }
    return a.id.localeCompare(b.id);
  });
}
