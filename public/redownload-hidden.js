(function () {
  const MAX_SET_SEARCH_PAGES = 20;
  const MAX_ALBUM_PAGES = 200;
  const MAX_IMAGES_TOTAL = 10;
  const LOG_LEVEL = 'important';
  const log = (level, ...args) => {
    if (LOG_LEVEL === 'all') {
    console.log(...args);
    return;
  }
  if (LOG_LEVEL === 'important' && level === 'important') {
    console.log(...args);
  }
};
  const MAX_PHOTOINFO_ATTEMPTS = 3;
  const REQUEST_DELAY_MS = 50;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const findReactRoot = () => {
    const root = document.querySelector('#root');
    if (!root) {
      throw new Error('No #root element found');
    }
    const reactKey = Object.keys(root).find(
      (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$')
    );
    if (!reactKey) {
      throw new Error('React root not found');
    }
    return root[reactKey]?.current ?? root[reactKey];
  };

  const findSetViewerContext = (root) => {
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      const value = node?.memoizedProps?.value;
      if (value?.hiddenIds && Array.isArray(value.hiddenIds)) {
        return value;
      }
      if (node?.child) {
        queue.push(node.child);
      }
      if (node?.sibling) {
        queue.push(node.sibling);
      }
    }
    return null;
  };

  const fetchDriveFile = async (fileId, fields) => {
    log('all', '[redownload] drive file', fileId);
    const response = await fetch(`/api/drive/file/${fileId}?fields=${encodeURIComponent(fields)}`);
    if (response.status === 404) {
      console.warn('[redownload] drive file missing', fileId);
      return null;
    }
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  };

  const resolveSourceNameFromSet = async (setFolderId, sourceNames) => {
    const seen = new Set();
    let current = await fetchDriveFile(setFolderId, 'id,name,parents');
    let steps = 0;
    while (current && steps < 10) {

      if (current.name && sourceNames.has(current.name.toLowerCase())) {
        return current.name;
      }

      const parentId = current.parents?.[0];
      if (!parentId || seen.has(parentId)) {
        break;
      }
      seen.add(parentId);
      const parent = await fetchDriveFile(parentId, 'id,name,parents');
      if (!parent) {
        break;
      }
      const name = parent.name?.toLowerCase();
      if (name && sourceNames.has(name)) {
        return parent.name;
      }
      current = parent;
      steps += 1;
    }
    return null;
  };

  const fetchSource = async (url, headers) => {
    log('all', '[redownload] source fetch', url);
    const response = await fetch('/api/source/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers }),
    });
    if (!response.ok) {
      const message = await response.text();
      console.warn('[redownload] source fetch failed', url, message);
      throw new Error(message);
    }
    return response;
  };

  const buildQueryString = (query) => {
    const trimmed = query.trim();
    return trimmed ? `search=${encodeURIComponent(trimmed)}` : '';
  };

  const parseSourceSets = (source, html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = Array.from(doc.querySelectorAll(source.selectors.setItem));
    return items
      .map((item) => {
        const link = item.querySelector(source.selectors.setLink);
        const titleNode = item.querySelector(source.selectors.setTitle);
        const thumb = item.querySelector(source.selectors.setThumb);
        const href = link?.getAttribute('href') ?? '';
        if (!href) {
          return null;
        }
        const idMatch = href.match(/\/album\/(\d+)/);
        const id = idMatch ? idMatch[1] : href;
        return {
          id,
          title: titleNode?.textContent?.trim() ?? 'Untitled set',
          thumbUrl: thumb?.getAttribute('src') ?? null,
          href,
        };
      })
      .filter(Boolean);
  };

  const parseAlbumImages = (source, html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = Array.from(doc.querySelectorAll(source.albumSelectors.imageItem));
    const images = items
      .map((item) => {
        const id = item.getAttribute(source.albumSelectors.imageIdAttr);
        const thumb =
          item.getAttribute(source.albumSelectors.imageThumbAttr) ??
          item.getAttribute('src');
        if (!id || !thumb) {
          return null;
        }
        return { id, thumbUrl: thumb };
      })
      .filter(Boolean);
    return { images };
  };

  const annihilate = (input, key) => {
    let result = '';
    for (let i = 0; i < input.length; i += 1) {
      result += String.fromCharCode(input.charCodeAt(i) ^ key);
    }
    return result;
  };

  const extractSpirit = (source, html, fallbackSeed, fallbackKey) => {
    let match = null;
    if (source.photo.spiritRegex) {
      try {
        const regex = new RegExp(source.photo.spiritRegex);
        match = html.match(regex);
      } catch {
        match = null;
      }
    }
    if (!match) {
      match = html.match(/giraffe\.annihilate\((['"])(.*?)\1\s*,\s*(\d+)\)/);
    }
    if (!match) {
      match = html.match(/annihilate\((['"])(.*?)\1\s*,\s*(\d+)\)/);
    }
    if (match && match[2]) {
      const nextKey = Number(match[3]);
      return {
        seed: match[2],
        key: Number.isNaN(nextKey) ? fallbackKey : nextKey,
      };
    }
    return { seed: fallbackSeed, key: fallbackKey };
  };

  const fetchPhotoInfo = async (source, photoId) => {
    log('all', '[redownload] photo info', photoId);
    let spiritSeed = source.photo.spiritSeed;
    let spiritKey = source.photo.spiritKey;
    let iframeUrl = null;
    if (source.photo.iframePathTemplate) {
      iframeUrl = new URL(
        source.photo.iframePathTemplate.replace('{id}', photoId),
        source.baseUrl
      ).toString();
    }
    log('all', '[redownload] photo config', {
      iframeUrl,
      spiritSeed,
      spiritKey,
    });

    const refreshSpiritFromIframe = async () => {
      if (!iframeUrl) {
        return;
      }
      log('all', '[redownload] iframe', iframeUrl);
      const iframeResponse = await fetchSource(iframeUrl, {
        Accept: 'text/html, */*; q=0.9',
        Referer: source.baseUrl,
        'User-Agent': navigator.userAgent,
        'Accept-Language': navigator.language || 'en-US',
      });
      const html = await iframeResponse.text();
      const spirit = extractSpirit(source, html, spiritSeed, spiritKey);
      spiritSeed = spirit.seed;
      spiritKey = spirit.key;
      log('all', '[redownload] spirit', spiritSeed, spiritKey);
    };

    await refreshSpiritFromIframe();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const spirit = annihilate(spiritSeed, spiritKey);
      const url = new URL(source.photo.endpoint, source.baseUrl);
      url.searchParams.set('spirit', spirit);
      url.searchParams.set('photo', photoId);

      log('all', '[redownload] backend', url.toString());
      const response = await fetchSource(url.toString(), {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: iframeUrl || source.baseUrl,
        'User-Agent': navigator.userAgent,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': navigator.language || 'en-US',
        Origin: source.baseUrl,
      });
      const text = await response.text();
      const trimmed = text.trim();
      log('all', '[redownload] backend response', {
        length: text.length,
        preview: trimmed.slice(0, 120),
      });
      if (!trimmed) {
        console.warn('[redownload] backend empty', url.toString());
      }
      if (trimmed) {
        try {
          const data = JSON.parse(trimmed);
          return {
            url: data[0],
            width: Number(data[1]),
            height: Number(data[2]),
            referer: iframeUrl || source.baseUrl,
            spirit,
            photoId,
          };
        } catch (error) {
          console.warn('[redownload] backend json parse failed', trimmed.slice(0, 120), error);
        }
      }
      await delay(REQUEST_DELAY_MS);
      await refreshSpiritFromIframe();
    }
    throw new Error(`Empty backend.php response for photo ${photoId}`);
  };

  const findSetByTitle = async (source, title) => {
    for (let page = 1; page <= MAX_SET_SEARCH_PAGES; page += 1) {
      const url = new URL(source.list.endpoint, source.baseUrl);
      url.searchParams.set(source.list.queryParam, buildQueryString(title));
      url.searchParams.set('prev_items', String(source.list.prevItems));
      url.searchParams.set(source.list.pageParam, String(page));
      const response = await fetchSource(url.toString(), {
        Accept: '*/*',
        Referer: source.baseUrl,
        'User-Agent': navigator.userAgent,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': navigator.language || 'en-US',
      });
      const html = await response.text();
      const sets = parseSourceSets(source, html);
      if (!sets.length) {
        return null;
      }
      const normalized = title.trim().toLowerCase();
      const exact = sets.find((set) => set.title.trim().toLowerCase() === normalized);
      if (exact) {
        return exact;
      }
      const loose = sets.find((set) => set.title.toLowerCase().includes(normalized));
      if (loose) {
        return loose;
      }
      await delay(REQUEST_DELAY_MS);
    }
    return null;
  };

  const fetchAlbumPage = async (source, setId, page) => {
    if (page === 1) {
      const albumUrl = new URL(
        source.album.pathTemplate.replace('{id}', setId),
        source.baseUrl
      );
      const response = await fetchSource(albumUrl.toString(), {
        Accept: 'text/html, */*; q=0.9',
        Referer: source.baseUrl,
        'User-Agent': navigator.userAgent,
        'Accept-Language': navigator.language || 'en-US',
      });
      const html = await response.text();
      const parsed = parseAlbumImages(source, html);
      if (parsed.images.length > 0) {
        return parsed;
      }
    }
    const url = new URL(source.list.endpoint, source.baseUrl);
    url.searchParams.set(source.list.queryParam, `album=${setId}`);
    url.searchParams.set('prev_items', String(source.list.prevItems));
    url.searchParams.set(source.list.pageParam, String(page));
    const response = await fetchSource(url.toString(), {
      Accept: '*/*',
      Referer: source.baseUrl,
      'User-Agent': navigator.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': navigator.language || 'en-US',
    });
    const html = await response.text();
    return parseAlbumImages(source, html);
  };

  const downloadImage = async (folderId, filename, url, referers) => {
    const listResponse = await fetch('/api/drive/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: {
          q: `'${folderId}' in parents and name='${filename.replace(/'/g, "\\'")}' and trashed=false`,
          pageSize: '50',
        },
        fields: 'files(id,name)',
      }),
    });
    let existing = [];
    if (listResponse.ok) {
      const data = await listResponse.json();
      existing = data.files ?? [];
    }
    const referer = referers[0];
    const response = await fetch('/api/drive/upload-binary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, filename, url, referer }),
    });
    if (!response.ok) {
      const message = await response.text();
      console.warn('[redownload] upload failed', response.status);
      throw new Error(message || `Upload failed: ${response.status}`);
    }
    let uploadedId = null;
    try {
      const data = await response.json();
      uploadedId = data?.id ?? null;
    } catch {
      uploadedId = null;
    }
    if (existing.length > 0) {
      log('important', '[redownload] deleting existing', existing.map((file) => file.id));
      for (const file of existing) {
        await fetch('/api/drive/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: file.id }),
        });
      }
    }
    return uploadedId;
  };

  const run = async () => {
    log('important', '[redownload] start');
    const root = findReactRoot();
    const ctx = findSetViewerContext(root);
    if (!ctx?.activeSet) {
      throw new Error('Set viewer context not found');
    }
    const hiddenIds = ctx.hiddenIds ?? [];
    if (!hiddenIds.length) {
      throw new Error('No hidden ids found');
    }

    const hiddenFiles = [];
    log('important', '[redownload] limiting to', MAX_IMAGES_TOTAL, 'hidden ids');
    for (const id of hiddenIds) {
      if (hiddenFiles.length >= MAX_IMAGES_TOTAL) {
        break;
      }
      const file = await fetchDriveFile(id, 'id,name,parents');
      if (file) {
        hiddenFiles.push(file);
      } else if (ctx.activeSet?.id && typeof ctx.onToggleHiddenImage === 'function') {
        ctx.onToggleHiddenImage(ctx.activeSet.id, id);
      }
    }
    if (!hiddenFiles.length) {
      console.warn('[redownload] no hidden files available (all missing).');
      log('important', 'Done');
      return;
    }
    log('important', '[redownload] hidden filenames', hiddenFiles.map((file) => file.name));

    const parentNameById = new Map();
    for (const file of hiddenFiles) {
      const parentId = file.parents?.[0];
      if (!parentId || parentNameById.has(parentId)) {
        continue;
      }
      const parent = await fetchDriveFile(parentId, 'id,name,parents');
      if (parent) {
        parentNameById.set(parentId, parent.name || '');
      }
    }

    const albumGroups = new Map();
    for (const file of hiddenFiles) {
      const parentId = file.parents?.[0] ?? 'unknown';
      const albumName = parentNameById.get(parentId) || 'unknown';
      if (!albumGroups.has(albumName)) {
        albumGroups.set(albumName, { folderId: parentId, files: [] });
      }
      albumGroups.get(albumName).files.push(file);
    }

    log('important', '[redownload] load source config');
    const listResponse = await fetch('/api/drive/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: { q: "name='sources_config.json' and trashed=false" },
        fields: 'files(id,name,parents)',
      }),
    });
    if (!listResponse.ok) {
      throw new Error(await listResponse.text());
    }
    const listData = await listResponse.json();
    if (!listData.files?.length) {
      throw new Error('sources_config.json not found');
    }
    const cfgText = await (await fetch(`/api/drive/download/${listData.files[0].id}`)).text();
    const config = JSON.parse(cfgText);
    if (!ctx.activeSet?.rootFolderId) {
      throw new Error('Active set is missing root folder id.');
    }
    const sourceNames = new Set(
      (config.sources ?? []).map((entry) => entry.name.toLowerCase())
    );
    const sourceName = await resolveSourceNameFromSet(ctx.activeSet.rootFolderId, sourceNames);
    if (!sourceName) {
     console.error('Unable to resolve source folder name from set path.', ctx.activeSet.rootFolderId, sourceNames);
     throw new Error('Source folder name could not be resolved from set path.');
    }
    const source =
      config.sources?.find((entry) => entry.name.toLowerCase() === sourceName.toLowerCase()) ??
      config.sources?.find((entry) => entry.name.toLowerCase().includes(sourceName.toLowerCase()));
    if (!source) {
      throw new Error(`Source not found: ${sourceName}`);
    }
    log('all', '[redownload] source config', source);

    log('important', '[redownload] album groups', albumGroups);
    for (const [albumName, group] of albumGroups.entries()) {
      log('important', '[redownload] album', albumName, group);
      const albumTitle = albumName;
      log('all', '[redownload] album title', albumTitle);
      const targetSet = await findSetByTitle(source, albumTitle);
      if (!targetSet) {
        console.warn('Album not found for title:', albumTitle);
        continue;
      }
      log('important', '[redownload] album set', targetSet);
      const remaining = new Map();
      const targetIndexes = new Map();
      for (const file of group.files) {
        remaining.set(file.name, file.id);
        const match = file.name.match(/^full_(\d{3})_/);
        if (match) {
          const index = Number(match[1]);
          if (!Number.isNaN(index)) {
            targetIndexes.set(index, file.name);
          }
        }
      }
      let position = 0;
      let page = 1;
      while (remaining.size > 0 && page <= MAX_ALBUM_PAGES) {
        log('all', '[redownload] album page', page, 'remaining', remaining.size);
        const parsed = await fetchAlbumPage(source, targetSet.id, page);
        if (!parsed.images.length) {
          break;
        }
        if (page === 1) {
          log(
            'all',
            '[redownload] sample thumbs',
            parsed.images.slice(0, 5).map((image) => image.thumbUrl)
          );
        }
        for (const image of parsed.images) {
          if (remaining.size === 0) {
            break;
          }
          position += 1;
          if (targetIndexes.size > 0 && !targetIndexes.has(position)) {
            continue;
          }
          let info;
          try {
            info = await fetchPhotoInfo(source, image.id);
          } catch (error) {
            console.warn('Photo info failed', image.id, error);
            continue;
          }
          const name = info.url.split('/').pop()?.split('?')[0] ?? '';
          if (!remaining.has(name)) {
            continue;
          }
          log('important', '[redownload] candidate', { fullName: name, fullMatch: true });
          try {
            log('important', '[redownload] download', name);
            const uploadedId = await downloadImage(group.folderId, name, info.url, [
              source.baseUrl,
              info.referer || source.baseUrl,
            ]);
            log('important', '[redownload] downloaded', name, uploadedId || '');
            const oldId = remaining.get(name);
            remaining.delete(name);
            if (uploadedId && ctx.activeSet?.id && typeof ctx.onToggleHiddenImage === 'function') {
              if (oldId) {
                ctx.onToggleHiddenImage(ctx.activeSet.id, oldId);
              }
              ctx.onToggleHiddenImage(ctx.activeSet.id, uploadedId);
            }
          } catch (error) {
            console.warn('Download failed', name, error);
          }
          await delay(REQUEST_DELAY_MS);
        }
        page += 1;
      }
      if (remaining.size > 0) {
        console.warn('Still missing files for album:', albumTitle, Array.from(remaining));
      }
    }
    log('important', 'Done');
  };

  window.poseviewerRedownloadHidden = run;
})();
