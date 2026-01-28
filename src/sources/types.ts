export type SourceConfigDocument = {
  version: 1;
  sources: SourceConfig[];
};

export type SourceConfig = {
  id: string;
  name: string;
  baseUrl: string;
  sourceType?: 'overview-based' | 'search-based';
  list: {
    endpoint: string;
    prevItems: number;
    pageParam: string;
    queryParam: string;
    queryTemplate?: string;
    ajax?: boolean;
    responseType?: 'html' | 'json';
    extraParams?: Record<string, string>;
  };
  selectors: {
    setItem: string;
    setLink: string;
    setTitle: string;
    setThumb: string;
  };
  album: {
    pathTemplate: string;
    titleFromHrefParam?: string;
    titleFromQuery?: boolean;
    listFallback?: boolean;
  };
  albumSelectors: {
    imageItem: string;
    imageIdAttr: string;
    imageThumbAttr: string;
    imageFullAttr?: string;
    albumTitle: string;
  };
  photo: {
    endpoint: string;
    iframePathTemplate: string;
    spiritRegex: string;
    spiritSeed: string;
    spiritKey: number;
  };
};

export type SourceStateDocument = {
  version: 1;
  sources: Record<
    string,
    {
      subdir?: string;
      downloadedSets: string[];
      hiddenSets: string[];
      downloadedImages: Record<string, string[]>;
      hiddenImages: Record<string, string[]>;
    }
  >;
};

export type SourceSet = {
  id: string;
  title: string;
  thumbUrl: string | null;
  href: string;
};

export type SourceImage = {
  id: string;
  thumbUrl: string;
  fullUrl?: string;
  width?: number;
  height?: number;
  title?: string;
  href?: string;
};
