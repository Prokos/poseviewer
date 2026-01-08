import { createContext, useContext } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { DriveImage } from '../../drive/types';
import type { PoseSet } from '../../metadata';

type ViewerQuickTags = {
  active: string[];
  inactive: string[];
};

export type SetViewerContextValue = {
  activeSet: PoseSet | null;
  isConnected: boolean;
  isSaving: boolean;
  isRefreshingSet: boolean;
  setViewerTab: 'samples' | 'favorites' | 'nonfavorites' | 'all';
  onSetViewerTab: (tab: 'samples' | 'favorites' | 'nonfavorites' | 'all') => void;
  viewerSort: 'random' | 'chronological';
  onViewerSortChange: (value: 'random' | 'chronological') => void;
  viewerQuickTags: ViewerQuickTags;
  onToggleActiveSetTag: (tag: string) => void;
  favoriteIds: string[];
  favoritesCount: number;
  nonFavoritesCount?: number;
  allImagesCount: number;
  sampleImages: DriveImage[];
  favoriteImages: DriveImage[];
  nonFavoriteImages: DriveImage[];
  activeImages: DriveImage[];
  viewerIndexProgress: string;
  isLoadingSample: boolean;
  isLoadingFavorites: boolean;
  isLoadingNonFavorites: boolean;
  isLoadingImages: boolean;
  isLoadingMore: boolean;
  totalImagesKnown?: number;
  samplePendingExtra: number;
  nonFavoritesPendingExtra: number;
  favoritesPendingExtra: number;
  pendingExtra: number;
  remainingImages?: number;
  onLoadMoreSample: () => void | Promise<void>;
  onLoadAllSample: () => void | Promise<void>;
  onLoadMoreNonFavorites: () => void | Promise<void>;
  onLoadAllNonFavorites: () => void | Promise<void>;
  onLoadMoreFavorites: () => void | Promise<void>;
  onLoadAllFavorites: () => void | Promise<void>;
  onLoadMoreImages: () => void | Promise<void>;
  onLoadAllPreloaded: () => void | Promise<void>;
  onToggleFavoriteImage: (setId: string, imageId: string) => void;
  onSetThumbnail: (setId: string, imageId: string) => void;
  onUpdateSetName: (value: string) => void;
  onRefreshSet: (set: PoseSet) => void;
  onDeleteSet: (set: PoseSet) => void;
  thumbSize: number;
  viewerThumbSize: number;
  sampleGridRef: RefObject<HTMLDivElement>;
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
