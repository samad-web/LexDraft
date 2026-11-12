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
async function shareBlobNative(blob: Blob, fileName: string, text?: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({
    path: `downloads/${safeFileName(fileName)}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: fileName, text, files: [uri] });
}

/**
 * Hand a file to the device's share sheet (WhatsApp, mail, Drive...).
 * 'fallback' = this browser can't share files (or the click's user activation
 * expired while the file was being prepared); the caller should download it instead.
 */
export async function shareFile(blob: Blob, fileName: string, text?: string): Promise<'shared' | 'cancelled' | 'fallback'> {
  try {
    if (Capacitor.isNativePlatform()) {
      await shareBlobNative(blob, fileName, text);
      return 'shared';
    }
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) return 'fallback';
    await navigator.share({ files: [file], text });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || /cancel/i.test(err.message))) return 'cancelled';
    return 'fallback';
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
