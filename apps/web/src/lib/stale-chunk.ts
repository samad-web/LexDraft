// After a deploy the old hashed JS files are gone. A page (or the Android
// app's WebView) opened before the deploy then fails to load a lazy screen
// with "Failed to fetch dynamically imported module". The fix is to reload
// once so the page picks up the new index.html and file names. A
// sessionStorage stamp stops a reload loop if the file is truly missing.

const KEY = 'difai:stale-chunk-reload';
const WINDOW_MS = 30_000;

const STALE_CHUNK = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i;

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  return STALE_CHUNK.test(msg);
}

/** Reload once for a stale-file error. Returns true when a reload was started. */
export function reloadForStaleChunk(err: unknown, now = Date.now()): boolean {
  if (!isStaleChunkError(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < WINDOW_MS) return false; // already tried: show the error instead of looping
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Storage blocked: still reload once; without storage a loop is possible
    // only if the file is truly missing, which the server would also show.
  }
  window.location.reload();
  return true;
}

/** Vite fires vite:preloadError when a lazy chunk or its CSS fails to load. */
export function initStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const err = (event as Event & { payload?: unknown }).payload;
    if (reloadForStaleChunk(err ?? new Error('Failed to fetch dynamically imported module'))) event.preventDefault();
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (reloadForStaleChunk(event.reason)) event.preventDefault();
  });
}
