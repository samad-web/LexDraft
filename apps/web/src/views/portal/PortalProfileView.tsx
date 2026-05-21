import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PortalNotificationPreferences, PortalProfile, PortalProfileUpdate,
} from '@lexdraft/types';
import { ErrorState, Skeleton } from '@lexdraft/ui';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { portalStrings as t } from './strings';
import { useAlert, useConfirm } from '@/components/ConfirmDialog';

/**
 * Profile screen - read-only identity (name + email come from the firm-side
 * client record), language preference (English-only in v1), per-event
 * notification toggles, and the DPDP "Right to be forgotten" trigger.
 */
export function PortalProfileView() {
  const queryClient = useQueryClient();
  const alertDialog = useAlert();
  const confirmDialog = useConfirm();

  const profile = useQuery({
    queryKey: ['portal', 'profile'],
    queryFn: () => portalApi.get<PortalProfile>('/profile'),
    refetchOnWindowFocus: false,
  });

  // Local form state, hydrated from the loaded profile.
  const [notifs, setNotifs] = useState<PortalNotificationPreferences | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    if (profile.data) setNotifs(profile.data.notifications);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: (patch: PortalProfileUpdate) =>
      portalApi.patch<PortalProfile>('/profile', patch),
    onSuccess: (next) => {
      queryClient.setQueryData(['portal', 'profile'], next);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2200);
    },
    onError: (err) => {
      void alertDialog({
        title: 'Could not save your changes',
        message: portalErrorMessage(err, 'Please try again.'),
        tone: 'danger',
      });
    },
  });

  const forget = useMutation({
    mutationFn: (reason: string | undefined) =>
      portalApi.post<{ ok: true }>('/forget-me', reason ? { reason } : undefined),
  });

  const [forgetReason, setForgetReason] = useState('');
  const [forgetSubmitted, setForgetSubmitted] = useState(false);

  async function onForgetMe(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Request to be forgotten',
      message: t.profileForgetConfirm,
      confirmLabel: 'Submit request',
      danger: true,
    });
    if (!ok) return;
    try {
      await forget.mutateAsync(forgetReason.trim() || undefined);
      setForgetSubmitted(true);
    } catch (err) {
      await alertDialog({
        title: 'Could not submit the request',
        message: portalErrorMessage(err, 'Please try again later.'),
        tone: 'danger',
      });
    }
  }

  if (profile.isLoading || !notifs) {
    return (
      <div style={pageStyle}>
        <Skeleton width={180} height={22} />
        <div style={{ marginTop: 16 }}><Skeleton width="100%" height={220} radius="md" /></div>
        <div style={{ marginTop: 16 }}><Skeleton width="100%" height={160} radius="md" /></div>
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <div style={pageStyle}>
        <ErrorState
          title={t.profileError}
          description={portalErrorMessage(profile.error, 'Please reload to retry.')}
        />
      </div>
    );
  }

  const p = profile.data;

  function setNotif<K extends keyof PortalNotificationPreferences>(key: K, value: boolean): void {
    setNotifs((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: '0 0 16px' }}>{t.profileTitle}</h1>

      <Card>
        <Field label={t.profileNameLabel} hint={t.profileNameLocked}>
          <input value={p.client.name} readOnly aria-readonly style={inputLocked} />
        </Field>
        <Field label={t.profileEmailLabel} hint={t.profileEmailLocked}>
          <input value={p.client.email} readOnly aria-readonly style={inputLocked} />
        </Field>
        <Field label={t.profileLanguageLabel}>
          <select value={p.language} disabled style={inputLocked} aria-label={t.profileLanguageLabel}>
            <option value="en">{t.profileLanguageEnglish}</option>
          </select>
        </Field>
      </Card>

      <Card title={t.profileNotificationsTitle} hint={t.profileNotificationsHint}>
        <Toggle label={t.profileNotifNewDocument} checked={notifs.newDocument}
          onChange={(v) => setNotif('newDocument', v)} />
        <Toggle label={t.profileNotifHearingReminder} checked={notifs.hearingReminder}
          onChange={(v) => setNotif('hearingReminder', v)} />
        <Toggle label={t.profileNotifNewMessage} checked={notifs.newMessage}
          onChange={(v) => setNotif('newMessage', v)} />
        <Toggle label={t.profileNotifInvoiceIssued} checked={notifs.invoiceIssued}
          onChange={(v) => setNotif('invoiceIssued', v)} />
        <Toggle label={t.profileNotifInvoiceOverdue} checked={notifs.invoiceOverdue}
          onChange={(v) => setNotif('invoiceOverdue', v)} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ notifications: notifs })}
            style={btnPrimary}
          >
            {save.isPending ? t.profileSaving : t.profileSave}
          </button>
          {savedFlash && (
            <span role="status" aria-live="polite" style={{ color: '#15803d', fontSize: 13 }}>
              {t.profileSaved}
            </span>
          )}
        </div>
      </Card>

      <Card title={t.profileForgetTitle} hint={t.profileForgetBody}>
        {forgetSubmitted ? (
          <p role="status" aria-live="polite" style={{ color: '#15803d', fontSize: 14, margin: 0 }}>
            {t.profileForgetSubmitted}
          </p>
        ) : (
          <>
            <label htmlFor="portal-forget-reason" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
              {t.profileForgetReasonLabel}
            </label>
            <textarea
              id="portal-forget-reason"
              value={forgetReason}
              onChange={(e) => setForgetReason(e.target.value)}
              maxLength={500}
              rows={3}
              style={textareaStyle}
            />
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void onForgetMe()}
                disabled={forget.isPending}
                style={btnDanger}
              >
                {forget.isPending ? t.profileForgetSubmitting : t.profileForgetButton}
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------- presentational helpers ----------

function Card(props: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={cardStyle}>
      {props.title && <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>{props.title}</h2>}
      {props.hint && <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 14px', maxWidth: 640 }}>{props.hint}</p>}
      {props.children}
    </section>
  );
}

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{props.label}</label>
      {props.children}
      {props.hint && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{props.hint}</div>}
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0', borderBottom: '1px solid var(--border, #f4f4f5)',
      cursor: 'pointer',
    }}>
      <span style={{ fontSize: 14 }}>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ width: 18, height: 18 }}
      />
    </label>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px',
};
const cardStyle: React.CSSProperties = {
  background: 'var(--card, #fff)',
  border: '1px solid var(--border, #e4e4e7)',
  borderRadius: 8,
  padding: 20,
  marginBottom: 18,
};
const inputLocked: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14,
  background: 'var(--bg, #fafafa)',
  border: '1px solid var(--border, #e4e4e7)',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'not-allowed',
};
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14,
  border: '1px solid var(--border, #d4d4d8)', borderRadius: 6,
  background: 'var(--card, #fff)', color: 'inherit',
  fontFamily: 'inherit', resize: 'vertical',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 500,
  background: 'var(--text, #18181b)', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 500,
  background: '#fee2e2', color: '#991b1b',
  border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer',
};
