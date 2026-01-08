import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { DriveImage } from '../../drive/types';
import type { PoseSet } from '../../metadata';

export type SlideshowContextValue = {
  isConnected: boolean;
  slideshowSets: PoseSet[];
  slideshowFavoriteFilter: 'all' | 'favorites' | 'nonfavorites';
  onSlideshowFavoriteFilterChange: (value: 'all' | 'favorites' | 'nonfavorites') => void;
  onStartSlideshow: () => void;
  isLoadingSlideshow: boolean;
  onClearSlideshowTags: () => void;
  sortedTags: string[];
  slideshowIncludeTags: string[];
  slideshowExcludeTags: string[];
  onToggleIncludeTag: (tag: string) => void;
  onToggleExcludeTag: (tag: string) => void;
  slideshowStarted: boolean;
  viewerIndexProgress: string;
  slideshowImages: DriveImage[];
  slideshowImageSetMap: Map<string, string>;
  setsById: Map<string, PoseSet>;
  onToggleFavoriteImage: (setId: string, imageId: string) => void;
  thumbSize: number;
  onLoadMoreSlideshow: () => void | Promise<void>;
  slideshowPageSize: number;
};

const SlideshowContext = createContext<SlideshowContextValue | null>(null);

export function SlideshowProvider({
  value,
  children,
}: {
  value: SlideshowContextValue;
  children: ReactNode;
}) {
  return <SlideshowContext.Provider value={value}>{children}</SlideshowContext.Provider>;
}

export function useSlideshow() {
  const context = useContext(SlideshowContext);
  if (!context) {
    throw new Error('useSlideshow must be used within a SlideshowProvider');
  }
  return context;
}
