export function formatIndexProgress(progress: { folders: number; images: number }) {
  return `Indexing… ${progress.folders} folders • ${progress.images} images`;
}

export function formatDownloadProgress(progress: { loaded: number }) {
  const kb = progress.loaded / 1024;
  if (kb < 1024) {
    return `Loading index… ${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `Loading index… ${mb.toFixed(2)} MB`;
}

export function startIndexTimer(setter: (value: string) => void) {
  const startedAt = Date.now();
  setter('Checking index… 0s');
  const id = window.setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    setter(`Checking index… ${seconds}s`);
  }, 1000);
  return () => window.clearInterval(id);
}
