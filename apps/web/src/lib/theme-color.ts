// ios-web-app: Safari tints its status bar / toolbar (and the area shown when a
// page is pulled) with <meta name="theme-color">. It was fixed at near-black, so
// the light theme showed a dark band above the header. Keep it equal to the
// page's real background, whichever theme is on.

const real = (bg: string | undefined) => !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';

export function themeColorOf(root: Element = document.documentElement): string {
  const bg = getComputedStyle(root).backgroundColor;
  return real(bg) ? bg : '#0a0a0a';
}

/** Returns false while the page's styles haven't loaded yet (no background). */
export function syncThemeColor(): boolean {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (!real(getComputedStyle(document.documentElement).backgroundColor)) return false;
  const c = themeColorOf();
  if (meta.content !== c) meta.content = c;
  return true;
}

/** Follow theme switches (data-theme / data-ui / class on <html>) and the
 *  system's light/dark setting. Call once at start. */
export function watchThemeColor(): void {
  if (typeof window === 'undefined') return;
  // At start the stylesheet may not be applied yet: retry briefly until it is.
  let tries = 0;
  const run = () => requestAnimationFrame(() => {
    if (!syncThemeColor() && tries++ < 50) setTimeout(run, 100);
  });
  run();
  new MutationObserver(run).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-ui', 'class'] });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', run);
}
