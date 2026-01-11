import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type ImageCacheContextValue = {
  cacheKey: number;
  bumpCacheKey: () => void;
};

const ImageCacheContext = createContext<ImageCacheContextValue | null>(null);
const CACHE_KEY_STORAGE = 'poseviewer-cache-key';

function readInitialCacheKey() {
  if (typeof window === 'undefined') {
    return 0;
  }
  const raw = window.localStorage.getItem(CACHE_KEY_STORAGE);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  const initial = Date.now();
  window.localStorage.setItem(CACHE_KEY_STORAGE, String(initial));
  return initial;
}

type ImageCacheProviderProps = {
  children: ReactNode;
};

export function ImageCacheProvider({ children }: ImageCacheProviderProps) {
  const [cacheKey, setCacheKey] = useState(() => readInitialCacheKey());
  const bumpCacheKey = useCallback(() => {
    setCacheKey((value) => value + 1);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(CACHE_KEY_STORAGE, String(cacheKey));
  }, [cacheKey]);
  const value = useMemo(() => ({ cacheKey, bumpCacheKey }), [cacheKey, bumpCacheKey]);
  return <ImageCacheContext.Provider value={value}>{children}</ImageCacheContext.Provider>;
}

export function useImageCache() {
  const context = useContext(ImageCacheContext);
  if (!context) {
    throw new Error('useImageCache must be used within ImageCacheProvider');
  }
  return context;
}
