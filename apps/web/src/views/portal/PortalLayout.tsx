import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePortalAuthStore } from '@/store/portalAuth';
import { PortalNav } from './PortalNav';

/**
 * Guard that wraps every authenticated portal route. Two responsibilities:
 *
 *   1. Block navigation when the session is missing or expired — bounce to
 *      `/portal/login` with the `next` and `reason` query parameters so the
 *      user can come back to where they were.
 *   2. Run a 60-second watchdog that catches the case where the JWT expires
 *      while the tab is open but idle. Without this the user clicks a
 *      stale page and gets a confusing 401 rather than a clean redirect.
 *
 * The 401 interceptor in `portalApi` already clears the store on response
 * failure; this component handles the navigation that follows.
 */
export function PortalLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = usePortalAuthStore((s) => s.token);
  const expiresAt = usePortalAuthStore((s) => s.expiresAt);
  const clear = usePortalAuthStore((s) => s.clear);

  // 60-second background watchdog. The token's `expiresAt` is an ISO timestamp;
  // we compare against now() and pre-empt the 401 the next request would get.
  useEffect(() => {
    if (!token || !expiresAt) return;
    function check(): void {
      const exp = new Date(expiresAt!).getTime();
      // 5-second skew window — covers small clock drift between client/server.
      if (exp - Date.now() < 5_000) {
        clear();
        const next = location.pathname + location.search;
        navigate(`/portal/login?reason=expired&next=${encodeURIComponent(next)}`, { replace: true });
      }
    }
    check();
    const handle = window.setInterval(check, 60_000);
    return () => window.clearInterval(handle);
  }, [token, expiresAt, clear, navigate, location.pathname, location.search]);

  if (!token) {
    const next = location.pathname + location.search;
    return (
      <Navigate
        to={`/portal/login?reason=signed_out&next=${encodeURIComponent(next)}`}
        replace
      />
    );
  }

  return (
    <>
      <PortalNav />
      <Outlet />
    </>
  );
}
