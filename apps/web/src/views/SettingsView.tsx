import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@lexdraft/ui';
import { useAuthStore } from '@/store/auth';
import { useSignOut } from '@/hooks/useAuth';
import { useMfaStatus, useMfaDisable } from '@/hooks/useMfa';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUIStore } from '@/store/ui';
import { MfaEnrollmentModal } from '@/components/MfaEnrollmentModal';
import { PillNav } from '@/components/PillNav';
import { DeletionConfirmModal } from '@/components/DeletionConfirmModal';
import {
  useCancelDeletion,
  useConsentHistory,
  useDeletionStatus,
  useExportMyData,
  useRequestDeletion,
  type ConsentRecord,
} from '@/hooks/useDpdp';

type TabId = 'account' | 'privacy';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'privacy', label: 'Privacy & Data' },
];

export function SettingsView() {
  // Tabbed layout — "Account" holds the existing identity/security/session
  // cards, "Privacy & Data" holds the DPDP §11 surface (export, consents,
  // deletion). Routing-level deeplinks aren't wired yet; local state is fine
  // since these are sibling concerns on the same screen.
  const [tab, setTab] = useState<TabId>('account');

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Preferences</div>
        <h1 className="heading-xl">Settings</h1>
      </div>

      <PillNav items={TABS} value={tab} onChange={setTab} ariaLabel="Settings section" />

      {tab === 'account' && <AccountPanel />}
      {tab === 'privacy' && <PrivacyPanel />}
    </div>
  );
}

// -- Account tab (existing surface, unchanged behaviourally) ----------------

function AccountPanel() {
  const user = useAuthStore((s) => s.user);
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <div className="col" style={{ gap: 24 }}>
      <Card>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Account</div>
        <div className="col" style={{ gap: 10 }}>
          <Row label="Name" value={user?.name || '—'} />
          <Row label="Email" value={user?.email || '—'} />
          <Row label="Role" value={user?.role || '—'} />
          {user?.firm && <Row label="Firm" value={user.firm} />}
        </div>
      </Card>

      <SecurityPanel />

      <Card>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Session</div>
        <button
          className="btn btn-oxblood"
          onClick={() => {
            signOut();
            navigate('/');
          }}
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted body-sm">{label}</span>
      <span className="body-md">{value}</span>
    </div>
  );
}

// ---- Security & MFA panel -------------------------------------------------

/**
 * Renders one of three states:
 *   - "loading"       — the /me/mfa/status query is in flight (rare; <300ms)
 *   - "not-enrolled"  — CTA to set up. If `required` is also true, an amber
 *                       banner reinforces that the role mandates it.
 *   - "enrolled"      — confirmation strip + disable / regenerate actions
 */
function SecurityPanel() {
  const status = useMfaStatus();
  const disableMfa = useMfaDisable();
  const confirm = useConfirm();
  const showToast = useUIStore((s) => s.showToast);
  const [enrollOpen, setEnrollOpen] = useState(false);

  // Re-running enrolment is the way users "regenerate" backup codes. The
  // server replaces the existing factor + codes atomically, so opening the
  // same modal in an already-enrolled state Just Works.
  const openEnroll = () => setEnrollOpen(true);

  const handleDisable = async () => {
    const ok = await confirm({
      title: 'Disable two-factor authentication?',
      message:
        'Your account will rely on password alone. If your role requires MFA, you will be forced to re-enrol on next sign-in.',
      confirmLabel: 'Disable',
      cancelLabel: 'Keep enabled',
      danger: true,
    });
    if (!ok) return;
    disableMfa.mutate(undefined, {
      onSuccess: () =>
        showToast({ type: 'amber', text: 'Two-factor authentication disabled' }),
      onError: () =>
        showToast({ type: 'vermillion', text: 'Could not disable MFA' }),
    });
  };

  return (
    <>
      <Card>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Security & MFA</div>

        {status.isPending && (
          <div className="muted body-sm">Checking MFA status…</div>
        )}

        {status.data && !status.data.enrolled && (
          <div className="col" style={{ gap: 12 }}>
            {status.data.required && (
              <div
                role="alert"
                style={{
                  background: 'var(--warning-bg, #fff7e6)',
                  border: '1px solid var(--warning, #b8860b)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  fontSize: 13,
                  color: 'var(--text-primary)',
                }}
              >
                <strong>Your role requires two-factor authentication.</strong>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  Set it up now to avoid losing access on next sign-in.
                </span>
              </div>
            )}
            <p className="muted body-sm" style={{ margin: 0 }}>
              Two-factor authentication adds a one-time code from your phone
              on top of your password. It takes about a minute to set up.
            </p>
            <div>
              <button
                type="button"
                className="btn"
                style={{
                  background: 'var(--text-primary)',
                  color: 'var(--bg-base)',
                  borderColor: 'var(--text-primary)',
                }}
                onClick={openEnroll}
              >
                Set up two-factor authentication
              </button>
            </div>
          </div>
        )}

        {status.data && status.data.enrolled && (
          <div className="col" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--success, #2f7a3b)',
                  color: 'var(--bg-base)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
              <span className="body-md" style={{ fontWeight: 500 }}>
                MFA is active
              </span>
              {status.data.enrolledAt && (
                <span className="muted body-sm">
                  · enrolled {formatDate(status.data.enrolledAt)}
                </span>
              )}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={openEnroll}
                title="Re-runs enrolment, which issues a new secret and a new set of backup codes."
              >
                Regenerate backup codes
              </button>
              <button
                type="button"
                className="btn btn-sm btn-oxblood"
                onClick={handleDisable}
                disabled={disableMfa.isPending}
              >
                {disableMfa.isPending ? 'Disabling…' : 'Disable MFA'}
              </button>
            </div>
          </div>
        )}
      </Card>

      <MfaEnrollmentModal open={enrollOpen} onClose={() => setEnrollOpen(false)} />
    </>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ---- Privacy & Data tab (DPDP §11) ----------------------------------------
//
// Four sections, in order, satisfying DPDP §11 (data principal rights —
// access, erasure, grievance). Layout matches the rest of Settings: stack of
// <Card>s separated by 24px vertical gap.

function PrivacyPanel() {
  const user = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const exportMutation = useExportMyData();
  const { data: pendingDeletion } = useDeletionStatus();
  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();
  const { data: consents = [], isLoading: consentsLoading } = useConsentHistory();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <div className="col" style={{ gap: 24 }}>
      {/* a) Export my data --------------------------------------------------- */}
      <Card>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Export</div>
        <h2 className="heading-md" style={{ margin: 0, marginBottom: 6 }}>Export my data</h2>
        <p className="muted body-sm" style={{ margin: 0, marginBottom: 14 }}>
          Download all of your personal data we hold — drafts, profile, audit
          entries, consent history. Honours your right under DPDP §11.
        </p>
        <button
          type="button"
          className="btn"
          disabled={exportMutation.isPending}
          onClick={async () => {
            try {
              await exportMutation.mutateAsync();
              showToast({ type: 'sage', text: 'Export downloaded.' });
            } catch (err) {
              showToast({
                type: 'vermillion',
                text: err instanceof Error ? err.message : 'Export failed. Try again.',
              });
            }
          }}
        >
          {exportMutation.isPending ? 'Preparing export…' : 'Download my data (.json)'}
        </button>
      </Card>

      {/* b) Consent history -------------------------------------------------- */}
      <Card>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Consent ledger</div>
        <h2 className="heading-md" style={{ margin: 0, marginBottom: 6 }}>Consent history</h2>
        <p className="muted body-sm" style={{ margin: 0, marginBottom: 14 }}>
          A tamper-evident log of the consents you have granted or revoked.
        </p>
        {consentsLoading ? (
          <div className="muted body-sm">Loading consent history…</div>
        ) : consents.length === 0 ? (
          <div className="muted body-sm">
            No consent records yet — these appear when you accept or revise terms.
          </div>
        ) : (
          <ConsentTable rows={consents} />
        )}
      </Card>

      {/* c) Delete my account ------------------------------------------------ */}
      <Card style={{ borderColor: 'var(--danger)' }}>
        <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--danger)' }}>
          Danger zone
        </div>
        <h2 className="heading-md" style={{ margin: 0, marginBottom: 6 }}>
          Delete my account permanently
        </h2>

        {pendingDeletion ? (
          <PendingDeletionState
            scheduledPurgeAt={pendingDeletion.scheduledPurgeAt}
            isCancelling={cancelDeletion.isPending}
            onCancel={async () => {
              try {
                await cancelDeletion.mutateAsync();
                showToast({ type: 'sage', text: 'Deletion cancelled.' });
              } catch (err) {
                showToast({
                  type: 'vermillion',
                  text:
                    err instanceof Error
                      ? err.message
                      : 'Could not cancel deletion.',
                });
              }
            }}
          />
        ) : (
          <>
            <p className="muted body-sm" style={{ margin: 0, marginBottom: 14 }}>
              Your data will be marked for deletion and permanently purged after
              the retention window. Until then you can cancel.
            </p>
            <button
              type="button"
              className="btn"
              style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              Request deletion
            </button>
          </>
        )}
      </Card>

      {/* d) About this data -------------------------------------------------- */}
      <AboutDataCard />

      <DeletionConfirmModal
        open={deleteOpen}
        onClose={() => {
          if (requestDeletion.isPending) return;
          setDeleteOpen(false);
        }}
        userEmail={user?.email ?? ''}
        submitting={requestDeletion.isPending}
        error={deleteError}
        onConfirm={async ({ retentionDays }) => {
          setDeleteError(null);
          try {
            await requestDeletion.mutateAsync({ retentionDays });
            setDeleteOpen(false);
            showToast({
              type: 'amber',
              text: 'Deletion scheduled. You can cancel from this page.',
            });
          } catch (err) {
            setDeleteError(
              err instanceof Error
                ? err.message
                : 'Could not schedule deletion. Try again.',
            );
          }
        }}
      />
    </div>
  );
}

// -- Privacy sub-components -------------------------------------------------

function ConsentTable({ rows }: { rows: ConsentRecord[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <Th>Type</Th>
            <Th>Version</Th>
            <Th>Status</Th>
            <Th>Recorded</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Td>{r.consentType}</Td>
              <Td>
                <code className="mono" style={{ fontSize: 12 }}>{r.consentVersion}</code>
              </Td>
              <Td>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    color: r.granted ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {r.granted ? 'GRANTED' : 'REVOKED'}
                </span>
              </Td>
              <Td>
                <span className="muted">
                  {new Date(r.createdAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="mono"
      style={{
        padding: '8px 10px',
        fontSize: 11,
        letterSpacing: '0.12em',
        color: 'var(--text-tertiary)',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px' }}>{children}</td>;
}

function PendingDeletionState({
  scheduledPurgeAt,
  isCancelling,
  onCancel,
}: {
  scheduledPurgeAt: string;
  isCancelling: boolean;
  onCancel: () => void;
}) {
  const date = new Date(scheduledPurgeAt);
  const dateStr = Number.isNaN(date.getTime())
    ? scheduledPurgeAt
    : date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="body-sm" style={{ margin: 0 }}>
        Deletion scheduled for <strong>{dateStr}</strong>. You can cancel until then.
      </p>
      <div>
        <button
          type="button"
          className="btn"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          disabled={isCancelling}
          onClick={onCancel}
        >
          {isCancelling ? 'Cancelling…' : 'Cancel deletion'}
        </button>
      </div>
    </div>
  );
}

function AboutDataCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          width: '100%',
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Reference</div>
          <h2 className="heading-md" style={{ margin: 0 }}>About this data</h2>
        </div>
        <span
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            color: 'var(--text-tertiary)',
          }}
        >
          {open ? 'HIDE' : 'SHOW'}
        </span>
      </button>
      {open && (
        <div
          className="col body-sm"
          style={{
            gap: 10,
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: 0 }}>
            Under the Digital Personal Data Protection Act 2023 (DPDP §11) you
            have the right to access a copy of your personal data, request
            correction or erasure of inaccurate data, and seek grievance
            redressal through our designated Data Protection Officer.
          </p>
          <p style={{ margin: 0 }}>
            Exports are generated on demand and are not retained server-side
            once downloaded. Deletion requests honour a retention window so you
            can cancel if requested in error.
          </p>
          <p style={{ margin: 0 }}>
            For full terms, see our{' '}
            <a
              href="/legal/privacy"
              style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
            >
              Privacy Policy
            </a>{' '}
            and{' '}
            <a
              href="/legal/terms"
              style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}
            >
              Terms of Service
            </a>
            .
          </p>
        </div>
      )}
    </Card>
  );
}

