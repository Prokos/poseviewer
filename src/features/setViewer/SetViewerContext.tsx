import { createContext, useContext } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { DriveImage } from '../../drive/types';
import type { PoseSet } from '../../metadata';
import type { ViewerTabKey, ViewerTabMetricsMap } from './viewerMetrics';

type ViewerQuickTags = {
  active: string[];
  inactive: string[];
};

export type SetViewerContextValue = {
  activeSet: PoseSet | null;
  isConnected: boolean;
  isSaving: boolean;
  isRefreshingSet: boolean;
  isDeletingHidden: boolean;
  hiddenDeleteProgress: null | { total: number; completed: number };
  setViewerTab: ViewerTabKey;
  onSetViewerTab: (tab: ViewerTabKey) => void;
  viewerSort: 'random' | 'chronological';
  viewerSortOrder: 'asc' | 'desc';
  onViewerSortChange: (value: 'random' | 'chronological') => void;
  onShuffleViewerSort: () => void;
  onToggleViewerSortOrder: () => void;
  viewerQuickTags: ViewerQuickTags;
  onToggleActiveSetTag: (tag: string) => void;
  favoriteIds: string[];
  hiddenIds: string[];
  favoritesCount: number;
  hiddenCount: number;
  nonFavoritesCount?: number;
  allImagesCount: number;
  favoriteImages: DriveImage[];
  nonFavoriteImages: DriveImage[];
  hiddenImages: DriveImage[];
  activeImages: DriveImage[];
  viewerIndexProgress: string;
  isLoadingFavorites: boolean;
  isLoadingNonFavorites: boolean;
  isLoadingHidden: boolean;
  isLoadingImages: boolean;
  isLoadingMore: boolean;
  totalImagesKnown?: number;
  allPageSize: number;
  viewerTabMetrics: ViewerTabMetricsMap;
  onLoadMoreActiveTab: () => void | Promise<void>;
  onLoadAllActiveTab: () => void | Promise<void>;
  onDeleteHiddenImages: () => void | Promise<void>;
  onEnsureImageInView: (imageId: string) => void | Promise<void>;
  onToggleFavoriteImage: (setId: string, imageId: string) => void;
  onToggleHiddenImage: (setId: string, imageId: string) => void;
  onSetThumbnail: (setId: string, imageId: string) => void;
  onSetThumbnailPosition: (setId: string, pos: number) => void;
  onUpdateSetName: (value: string) => void;
  onRefreshSet: (set: PoseSet) => void;
  onDeleteSet: (set: PoseSet) => void;
  onRotateSet: (set: PoseSet, angle: 90 | -90) => void;
  isRotatingSet: boolean;
  rotateSetProgress: null | {
    total: number;
    completed: number;
    angle: 90 | -90;
  };
  modalImageId: string | null;
  modalContextLabel: string;
  thumbSize: number;
  viewerThumbSize: number;
  allGridRef: RefObject<HTMLDivElement>;
};

const SetViewerContext = createContext<SetViewerContextValue | null>(null);

export function SetViewerProvider({
  value,
  children,
}: {
  value: SetViewerContextValue;
  children: ReactNode;
}) {
  return <SetViewerContext.Provider value={value}>{children}</SetViewerContext.Provider>;
}

export function useSetViewer() {
  const context = useContext(SetViewerContext);
  if (!context) {
    throw new Error('useSetViewer must be used within a SetViewerProvider');
  }
  return context;
}
