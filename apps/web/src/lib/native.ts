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

async function shareDownload(href: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await blobToBase64(await res.blob());
    const { uri } = await Filesystem.writeFile({
      path: `downloads/${safeFileName(fileName)}`,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: fileName, files: [uri] });
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

  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
