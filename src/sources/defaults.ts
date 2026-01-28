import type { SourceConfigDocument } from './types';

export const DEFAULT_SOURCE_CONFIG: SourceConfigDocument = {
  version: 1,
  sources: [
    {
      id: 'freepik',
      name: 'Freepik',
      baseUrl: 'https://www.freepik.com',
      sourceType: 'search-based',
      list: {
        endpoint: '/api/regular/search',
        prevItems: 50,
        pageParam: 'page',
        queryParam: 'term',
        queryTemplate: '{query}',
        ajax: false,
        responseType: 'json',
        extraParams: {
          'filters[ai-generated][excluded]': '1',
          'filters[content_type]': 'photo',
          locale: 'en',
        },
      },
      selectors: {
        setItem: '[data-cy="resource-thumbnail"]',
        setLink: 'a[href]',
        setTitle: 'img',
        setThumb: 'img',
      },
      album: {
        pathTemplate: '{id}',
        titleFromHrefParam: 'query',
        titleFromQuery: true,
        listFallback: false,
      },
      albumSelectors: {
        imageItem:
          '[data-cy="resource-detail-preview"] img, a[href*="from_element=cross_selling__photo"] img',
        imageIdAttr: 'src',
        imageThumbAttr: 'src',
        imageFullAttr: 'src',
        albumTitle: 'h1',
      },
      photo: {
        endpoint: '',
        iframePathTemplate: '',
        spiritRegex: '',
        spiritSeed: '',
        spiritKey: 0,
      },
    },
  ],
};
