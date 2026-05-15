import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/ui';
import { useMfaStatus } from '@/hooks/useMfa';

/**
 * Persistent banner shown at the top of every authenticated route when the
 * user's role mandates MFA but no factor has been enrolled.
 *
 * Two sources are OR-ed:
 *   1. The transient `forceMfaEnrollment` UI flag - set by useSignIn when the
 *      sign-in response carries `mustEnrollMfa`. Survives until the user
 *      completes enrolment (or signs out).
 *   2. The persistent `/me/mfa/status` response - `required && !enrolled`.
 *      This catches the case where the user reloads the page mid-session
 *      (the transient flag is gone but the server still demands enrolment),
 *      and the case where an admin flips the role-MFA policy live.
 *
 * The banner is non-dismissible by design: the only way out is to set up
 * 2FA via the Settings → Security panel.
 */
export function MfaPromptBanner() {
  const navigate = useNavigate();
  const forceMfaEnrollment = useUIStore((s) => s.forceMfaEnrollment);
  const status = useMfaStatus();

  const serverDemands =
    status.data?.required === true && status.data?.enrolled === false;
  const visible = forceMfaEnrollment || serverDemands;

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        // Amber/warning bar - matches the security tone without screaming
        // "danger" the way the oxblood/red tokens would.
        background: 'var(--warning-bg, #fff7e6)',
        borderBottom: '1px solid var(--warning, #b8860b)',
        color: 'var(--text-primary)',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'var(--warning, #b8860b)',
          color: 'var(--bg-base)',
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        !
      </span>
      <span style={{ flex: 1 }}>
        <strong style={{ fontWeight: 600 }}>
          Two-factor authentication required.
        </strong>{' '}
        <span style={{ color: 'var(--text-secondary)' }}>
          Your role requires an authenticator app. Set it up to keep your
          account secure.
        </span>
      </span>
      <button
        type="button"
        className="btn btn-sm"
        style={{
          background: 'var(--text-primary)',
          color: 'var(--bg-base)',
          borderColor: 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}
        onClick={() => navigate('/app/settings')}
      >
        Set up now
      </button>
    </div>
  );
}
