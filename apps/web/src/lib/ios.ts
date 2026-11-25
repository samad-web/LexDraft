// ios-web-app: telling iPhone / iPad apart. iPadOS 13+ Safari reports itself as a
// Mac ("Macintosh" user agent), so an iPad is a "Mac" with a touch screen.

export function isIosDevice(nav: { userAgent: string; platform?: string; maxTouchPoints?: number } = navigator): boolean {
  if (/iphone|ipad|ipod/i.test(nav.userAgent)) return true;
  return (nav.platform === 'MacIntel' || /macintosh/i.test(nav.userAgent)) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Opened from the Home Screen (full-screen, like an app). */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true;
}
