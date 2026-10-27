import { Capacitor } from '@capacitor/core';

/** True when an <iframe>/<embed> can display a PDF inline. Android (the app's
 *  WebView and mobile Chrome) has no built-in viewer and shows a blank frame;
 *  use <PdfPages> there instead. */
export function canEmbedPdf(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  return (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
}
