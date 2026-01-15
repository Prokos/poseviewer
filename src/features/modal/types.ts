import type { DriveImage } from '../../drive/types';

export type ModalOpenOptions = {
  contextSetId?: string;
  contextItems?: DriveImage[];
  initialLimit?: number;
};
