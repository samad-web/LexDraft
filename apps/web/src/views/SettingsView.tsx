import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState, Icon, Select, type SelectOption } from '@lexdraft/ui';
import { useAuthStore } from '@/store/auth';
import { useSignOut } from '@/hooks/useAuth';
import { useMfaStatus, useMfaDisable } from '@/hooks/useMfa';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUIStore } from '@/store/ui';
import { MfaEnrollmentModal } from '@/components/MfaEnrollmentModal';
import { PillNav } from '@/components/PillNav';
import { PageHeader } from '@/components/PageHeader';
import { DeletionConfirmModal } from '@/components/DeletionConfirmModal';
import {
  useCancelDeletion,
  useConsentHistory,
  useDeletionStatus,
  useExportMyData,
  useRequestDeletion,
  type ConsentRecord,
} from '@/hooks/useDpdp';
import { LetterheadsPanel } from '@/components/letterhead/LetterheadsPanel';
import { LANGUAGES, findLanguage } from '@/lib/languages';
import { useUpdatePreferences } from '@/hooks/useMePreferences';

type TabId = 'account' | 'letterhead' | 'privacy';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'letterhead', label: 'Letterhead' },
  { id: 'privacy', label: 'Privacy & Data' },
];

export function SettingsView() {
  // Tabbed layout - "Account" holds the existing identity/security/session
  // cards, "Privacy & Data" holds the DPDP §11 surface (export, consents,
  // deletion). Routing-level deeplinks aren't wired yet; local state is fine
  // since these are sibling concerns on the same screen.
  const [tab, setTab] = useState<TabId>('account');

  return (
    <div className="col stagger fm-view fm-settings">
      <PageHeader
        title="Settings"
        description="Your account, security, language, letterheads and privacy choices."
      />

      <PillNav items={TABS} value={tab} onChange={setTab} ariaLabel="Settings section" />

      {tab === 'account' && <AccountPanel />}
      {tab === 'letterhead' && <LetterheadsPanel />}
      {tab === 'privacy' && <PrivacyPanel />}
    </div>
  );
}

/// -- Account tab (existing surface, unchanged behaviourally) ----------------

/** One settings row: a title + description on the left, the controls on the
 *  right (stacked on tablets and phones). */
function SettingsRow({
  eyebrow,
  title,
  description,
  children,
  danger,
  flush,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  flush?: boolean;
}) {
  return (
    <section className={`fm-set-row${danger ? ' is-danger' : ''}`}>
      <div className="fm-set-intro">
        {eyebrow && <div className="fm-eyebrow">{eyebrow}</div>}
        <h2 className="fm-set-title">{title}</h2>
        {description && <p className="fm-set-desc">{description}</p>}
      </div>
      <div className={`fm-set-card${flush ? ' is-flush' : ''}`}>{children}</div>
    </section>
  );
}

function AccountPanel() {
  const user = useAuthStore((s) => s.user);
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <div className="fm-set">
      <SettingsRow
        eyebrow="Account"
        title="Your profile"
        description="The name, email and role your firm sees on matters, drafts and the audit log."
        flush
      >
        <div className="fm-kv">
          <Row label="Name" value={user?.name || '-'} />
          <Row label="Email" value={user?.email || '-'} />
          <Row label="Role" value={user?.role || '-'} />
          {user?.firm && <Row label="Firm" value={user.firm} />}
        </div>
      </SettingsRow>

      <TrialStatusPanel />

      <SecurityPanel />

      <LanguagePreferencePanel />

      <SettingsRow
        eyebrow="Session"
        title="Sign out"
        description="Ends this session on this device. Your work stays saved."
      >
        <div className="fm-set-actions">
          <button
            className="btn"
            onClick={() => {
              signOut();
              navigate('/');
            }}
          >
            <Icon name="logout" size={14} /> Sign out
          </button>
        </div>
      </SettingsRow>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="fm-kv-row">
      <span className="fm-kv-label">{label}</span>
      <span className="fm-kv-value">{value}</span>
    </div>
  );
}

// ---- Trial / plan-status panel --------------------------------------------
//
// Surfaces the firm's trial state so the user can see when it ends and start
// the conversion conversation from Settings (instead of only via the
// dashboard-wide banner). Renders for trial firms only; paid/legacy firms
// see nothing — the standard billing panel takes over (still TBD).

const TRIAL_DAYS = 14;

function TrialStatusPanel() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  if (!user || user.planStatus !== 'trial' || !user.trialEndsAt) return null;

  const endsAt = new Date(user.trialEndsAt);
  if (Number.isNaN(endsAt.getTime())) return null;
  const msLeft = endsAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  const expired = msLeft <= 0;
  const isDemo = !!user.isDemo;
  const usedPct = expired ? 100 : Math.max(4, Math.min(100, Math.round(((TRIAL_DAYS - daysLeft) / TRIAL_DAYS) * 100)));

  const ends = endsAt.toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <SettingsRow
      eyebrow={isDemo ? 'Demo session' : 'Trial'}
      title="Plan status"
      description={isDemo
        ? 'This is a sandbox account so you can explore DifAi. Convert to a real account any time: your existing work carries over.'
        : 'After the trial, pick a plan to keep going. We do not ask for card details until you choose.'}
    >
      <div>
        <div className="fm-figure">
          {expired ? 'Ended' : daysLeft}
          <small>
            {expired
              ? (isDemo ? 'Demo session ended' : 'Trial ended')
              : (isDemo ? `day${daysLeft === 1 ? '' : 's'} of demo remaining` : `day${daysLeft === 1 ? '' : 's'} of trial remaining`)}
          </small>
        </div>
      </div>
      <div className="fm-trial-track" aria-hidden><span style={{ width: `${usedPct}%` }} /></div>
      <div className="fm-kv">
        <div className="fm-kv-row">
          <span className="fm-kv-label">Ends</span>
          <span className="fm-kv-value">{ends}</span>
        </div>
      </div>
      <div className="fm-set-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate('/#pricing')}
        >
          {isDemo ? 'Convert to real account' : 'See plans & upgrade'}
        </button>
      </div>
    </SettingsRow>
  );
}

// ---- Language preference panel --------------------------------------------
//
// Sets the default language used by AI-facing features (currently just Mock
// Arguments — the picker on the session-setup screen pre-fills from here,
// and the user can still override per-session). PATCH /me/preferences round-
// trips the choice; the auth store is refreshed in-place by the hook so
// the new default shows up immediately wherever it's read.

function LanguagePreferencePanel() {
  const user = useAuthStore((s) => s.user);
  const update = useUpdatePreferences();
  const showToast = useUIStore((s) => s.showToast);
  const current = user?.defaultLanguageCode ?? 'en-IN';
  const [value, setValue] = useState<string>(current);
  const dirty = value !== current;

  return (
    <SettingsRow
      eyebrow="Language"
      title="AI language"
      description="Default for AI-facing features. Today this drives Mock Arguments: opposing counsel will argue in this language and the review will be written in it. You can still pick a different language per session."
    >
      <div style={{ maxWidth: 440 }}>
        <Select
          value={value}
          onChange={(v) => setValue(v)}
          options={LANGUAGES.map<SelectOption>((l) => ({
            value: l.code,
            label: `${l.englishName} (${l.nativeName})`,
            hint: l.voiceSupport === 'full'    ? 'VOICE'
                : l.voiceSupport === 'partial' ? 'VOICE·PARTIAL'
                :                                'TEXT',
          }))}
        />
      </div>
      <div className="fm-set-actions">
        <button
          type="button"
          className="btn"
          disabled={!dirty || update.isPending}
          onClick={() => {
            update.mutate(
              { defaultLanguageCode: value },
              {
                onSuccess: () =>
                  showToast({ type: 'sage', text: 'Default language updated' }),
                onError: (err) =>
                  showToast({
                    type: 'vermillion',
                    text:
                      err instanceof Error
                        ? err.message
                        : 'Could not update language preference',
                  }),
              },
            );
          }}
        >
          {update.isPending ? 'Saving…' : 'Save language'}
        </button>
        <span className="fm-status-sub">
          Currently <strong style={{ color: 'var(--text-primary)' }}>{findLanguage(current).englishName}</strong>
        </span>
      </div>
    </SettingsRow>
  );
}

// ---- Security & MFA panel -------------------------------------------------

/**
 * Renders one of three states:
 *   - "loading"       - the /me/mfa/status query is in flight (rare; <300ms)
 *   - "not-enrolled"  - CTA to set up. If `required` is also true, a
 *                       banner reinforces that the role mandates it.
 *   - "enrolled"      - confirmation strip + disable / regenerate actions
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
        'Your account will rely on Google sign-in alone. If your role requires MFA, you will be forced to re-enrol on next sign-in.',
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
      <SettingsRow
        eyebrow="Security & MFA"
        title="Two-factor authentication"
        description="A one-time code from an authenticator app on your phone, on top of Google sign-in."
      >
        {status.isPending && (
          <div className="fm-status-sub">Checking MFA status…</div>
        )}

        {status.isError && (
          <ErrorState
            variant="inline"
            title="Couldn't load MFA status"
            description="Check your connection and try again."
            onRetry={() => status.refetch()}
          />
        )}

        {status.data && !status.data.enrolled && (
          <>
            <div className="fm-status-line">
              <span className="fm-status-mark is-off" aria-hidden><Icon name="shield" size={16} /></span>
              <div>
                <div className="fm-status-title">Not set up</div>
                <div className="fm-status-sub">Signing in with Google only</div>
              </div>
            </div>
            {status.data.required && (
              <div role="alert" className="fm-required">
                <span className="fm-error-mark" aria-hidden>!</span>
                <div>
                  <strong>Your role requires two-factor authentication.</strong>{' '}
                  <span>Set it up now to avoid losing access on next sign-in.</span>
                </div>
              </div>
            )}
            <p>
              Two-factor authentication adds a one-time code from your phone
              on top of Google sign-in. It takes about a minute to set up.
            </p>
            <div className="fm-set-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={openEnroll}
              >
                Set up two-factor authentication
              </button>
            </div>
          </>
        )}

        {status.data && status.data.enrolled && (
          <>
            <div className="fm-status-line">
              <span className="fm-status-mark" aria-hidden><Icon name="check" size={16} /></span>
              <div>
                <div className="fm-status-title">MFA is active</div>
                {status.data.enrolledAt && (
                  <div className="fm-status-sub">Enrolled {formatDate(status.data.enrolledAt)}</div>
                )}
              </div>
            </div>
            <div className="fm-set-actions">
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
                className="btn btn-sm btn-ghost"
                onClick={handleDisable}
                disabled={disableMfa.isPending}
              >
                {disableMfa.isPending ? 'Disabling…' : 'Disable MFA'}
              </button>
            </div>
          </>
        )}
      </SettingsRow>

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
// Four sections, in order, satisfying DPDP §11 (data principal rights -
// access, erasure, grievance).

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
    <div className="fm-set">
      {/* a) Export my data --------------------------------------------------- */}
      <SettingsRow
        eyebrow="Export"
        title="Export my data"
        description="Honours your right of access under DPDP §11."
      >
        <p>
          Download all of your personal data we hold - drafts, profile, audit
          entries, consent history.
        </p>
        <div className="fm-set-actions">
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
            <Icon name="download" size={14} />
            {exportMutation.isPending ? 'Preparing export…' : 'Download my data (.json)'}
          </button>
        </div>
      </SettingsRow>

      {/* b) Consent history -------------------------------------------------- */}
      <SettingsRow
        eyebrow="Consent ledger"
        title="Consent history"
        description="A tamper-evident log of the consents you have granted or revoked."
        flush={!consentsLoading && consents.length > 0}
      >
        {consentsLoading ? (
          <div className="fm-status-sub">Loading consent history…</div>
        ) : consents.length === 0 ? (
          <div className="fm-status-sub">
            No consent records yet - these appear when you accept or revise terms.
          </div>
        ) : (
          <ConsentTable rows={consents} />
        )}
      </SettingsRow>

      {/* c) Delete my account ------------------------------------------------ */}
      <SettingsRow
        eyebrow="Danger zone"
        title="Delete my account permanently"
        description="Your data is marked for deletion and purged after the retention window."
        danger
      >
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
            <p>
              Your data will be marked for deletion and permanently purged after
              the retention window. Until then you can cancel.
            </p>
            <div className="fm-set-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                Request deletion
              </button>
            </div>
          </>
        )}
      </SettingsRow>

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
    <table className="tbl fm-tbl">
      <thead>
        <tr>
          <th>Type</th>
          <th>Version</th>
          <th>Status</th>
          <th>Recorded</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><span className="fm-cell-title" style={{ textTransform: 'capitalize' }}>{r.consentType.replace(/_/g, ' ')}</span></td>
            <td><span className="fm-code">{r.consentVersion}</span></td>
            <td>
              <span className={`fm-pill ${r.granted ? 'is-solid' : 'is-dashed'}`}>
                {r.granted ? 'Granted' : 'Revoked'}
              </span>
            </td>
            <td>
              <span className="fm-date">
                {new Date(r.createdAt).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
    <>
      <div className="fm-required">
        <span className="fm-error-mark" aria-hidden>!</span>
        <div>
          Deletion scheduled for <strong>{dateStr}</strong>. <span>You can cancel until then.</span>
        </div>
      </div>
      <div className="fm-set-actions">
        <button
          type="button"
          className="btn"
          disabled={isCancelling}
          onClick={onCancel}
        >
          {isCancelling ? 'Cancelling…' : 'Cancel deletion'}
        </button>
      </div>
    </>
  );
}

function AboutDataCard() {
  const [open, setOpen] = useState(false);
  return (
    <SettingsRow
      eyebrow="Reference"
      title="About this data"
      description="Your rights under the Digital Personal Data Protection Act 2023."
    >
      <button
        type="button"
        className="fm-disclose"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{open ? 'Hide details' : 'Show details'}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="fm-prose">
          <p>
            Under the Digital Personal Data Protection Act 2023 (DPDP §11) you
            have the right to access a copy of your personal data, request
            correction or erasure of inaccurate data, and seek grievance
            redressal through our designated Data Protection Officer.
          </p>
          <p>
            Exports are generated on demand and are not retained server-side
            once downloaded. Deletion requests honour a retention window so you
            can cancel if requested in error.
          </p>
          <p>
            For full terms, see our{' '}
            <a href="/legal/privacy">Privacy Policy</a>{' '}
            and{' '}
            <a href="/legal/terms">Terms of Service</a>
            .
          </p>
        </div>
      )}
    </SettingsRow>
  );
}
