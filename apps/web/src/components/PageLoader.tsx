import { Wordmark } from '@/components/brand/Logo';

/**
 * The app's loading screen: DifAi wordmark + a thin indeterminate bar.
 * Shown while a page's code downloads (every route's Suspense fallback).
 * `full` fills the viewport (public pages, onboarding, admin, portal);
 * otherwise it fills the app's content column beside the sidebar.
 * It fades in after a short delay (CSS) so fast loads don't flicker.
 * index.html shows the same look before the app's code has arrived.
 */
export function PageLoader({ full = false }: { full?: boolean }) {
  return (
    <div className={`page-loader${full ? ' page-loader--full' : ''}`} role="status" aria-live="polite">
      <Wordmark height={full ? 34 : 26} />
      <span className="page-loader__bar" aria-hidden="true"><span /></span>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
