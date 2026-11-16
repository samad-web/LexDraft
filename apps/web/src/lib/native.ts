/**
 * Glue for the Capacitor Android build. A no-op in the browser.
 *
 * - Downloads: the Android WebView ignores `<a download>` (blob:, data: and
 *   plain URLs alike), and the app has ~20 call sites that build such an
 *   anchor and click it (plus jsPDF's `save()`, which does the same). Rather
 *   than touch each one, programmatic and real clicks on download anchors are
 *   intercepted here: the file is written to the app cache and handed to the
 *   Android share sheet, from which the advocate saves it to Files/Drive or
 *   sends it on WhatsApp/mail.
 * - Hardware back button: walks the router history, exits on the root screen.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { useLockStore } from './app-lock';
import { BACK_EVENT } from './back-event';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || `lexdraft-${Date.now()}`;
}

/** Write a file to the app cache and open the Android share sheet with it. */
/** Write files to the app cache and open the Android share sheet with them. */
async function shareBlobsNative(files: Array<{ blob: Blob; fileName: string }>, text?: string): Promise<void> {
  const uris: string[] = [];
  for (const f of files) {
    const { uri } = await Filesystem.writeFile({
      path: `downloads/${safeFileName(f.fileName)}`,
      data: await blobToBase64(f.blob),
      directory: Directory.Cache,
      recursive: true,
    });
    uris.push(uri);
  }
  await Share.share({ title: files.length === 1 ? files[0]!.fileName : `${files.length} files`, text, files: uris });
}

const shareBlobNative = (blob: Blob, fileName: string, text?: string) => shareBlobsNative([{ blob, fileName }], text);

/**
 * Hand one or more files to the device's share sheet (WhatsApp, mail, Drive...).
 * 'fallback' = this browser can't share these files (or the click's user activation
 * expired while they were being prepared); the caller should download instead.
 */
export async function shareFiles(
  files: Array<{ blob: Blob; fileName: string }>,
  text?: string,
): Promise<'shared' | 'cancelled' | 'fallback'> {
  try {
    if (Capacitor.isNativePlatform()) {
      await shareBlobsNative(files, text);
      return 'shared';
    }
    const list = files.map((f) => new File([f.blob], f.fileName, { type: f.blob.type || 'application/octet-stream' }));
    if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: list })) return 'fallback';
    await navigator.share({ files: list, text });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || /cancel/i.test(err.message))) return 'cancelled';
    return 'fallback';
  }
}

export const shareFile = (blob: Blob, fileName: string, text?: string) => shareFiles([{ blob, fileName }], text);

/** Whether this device can hand files to a share sheet at all (native app or Web Share with files). */
export function canShareFiles(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  try {
    const probe = new File(['x'], 'x.pdf', { type: 'application/pdf' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

async function shareDownload(href: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await shareBlobNative(await res.blob(), fileName);
  } catch (err) {
    // Share sheet dismissed is not an error worth surfacing.
    if (err instanceof Error && /cancel/i.test(err.message)) return;
    // Remote file we couldn't fetch (e.g. no CORS): let the system browser
    // download it instead.
    if (/^https?:/i.test(href)) {
      window.open(href, '_blank');
      return;
    }
    console.error('[native] download failed', err);
    window.alert('Could not save the file on this device.');
  }
}

function downloadTarget(el: Element | null): HTMLAnchorElement | null {
  const a = el?.closest?.('a');
  return a instanceof HTMLAnchorElement && a.hasAttribute('download') && a.href ? a : null;
}

function nameFor(a: HTMLAnchorElement): string {
  const attr = a.getAttribute('download');
  if (attr) return attr;
  try {
    return decodeURIComponent(new URL(a.href).pathname.split('/').pop() || '') || 'download';
  } catch {
    return 'download';
  }
}

export function initNative(): void {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('native-app');

  // Callers revoke the object URL right after click(); keep it alive long
  // enough for the async fetch above to read it.
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url: string) => {
    setTimeout(() => revoke(url), 60_000);
  };

  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (downloadTarget(this) === this) {
      void shareDownload(this.href, nameFor(this));
      return;
    }
    nativeClick.call(this);
  };

  // The WebView has no pop-up windows: window.open(url) navigates the app
  // itself, which Capacitor diverts to the system browser for external hosts.
  // A blank window (opened to be written into later) would replace the app,
  // so report it as blocked; callers already handle a null return.
  const nativeOpen = window.open.bind(window);
  window.open = (url?: string | URL, ...rest) => {
    const href = url ? String(url) : '';
    if (!href || href === 'about:blank') return null;
    return nativeOpen(href, ...rest);
  };

  // Real taps on a rendered <a download> link.
  document.addEventListener(
    'click',
    (e) => {
      const a = downloadTarget(e.target as Element | null);
      if (!a) return;
      e.preventDefault();
      void shareDownload(a.href, nameFor(a));
    },
    true,
  );

  // The WebView shrinks when the keyboard opens. Mark that on <html> so the
  // bottom dock and floating buttons can step aside instead of covering the
  // field being typed in.
  let fullHeight = window.innerHeight;
  const trackKeyboard = () => {
    fullHeight = Math.max(fullHeight, window.innerHeight);
    document.documentElement.classList.toggle('kb-open', window.innerHeight < fullHeight * 0.75);
  };
  window.addEventListener('resize', trackKeyboard);
  window.addEventListener('orientationchange', () => {
    fullHeight = 0;
    setTimeout(trackKeyboard, 300);
  });

  void App.addListener('backButton', ({ canGoBack }) => {
    // Back on the lock screen leaves the app; it must never reveal it.
    if (useLockStore.getState().locked) void App.exitApp();
    // An open overlay (e.g. the notifications sheet) closes itself instead.
    else if (!window.dispatchEvent(new Event(BACK_EVENT, { cancelable: true }))) return;
    else if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
