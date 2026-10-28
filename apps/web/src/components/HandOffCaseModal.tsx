/**
 * Hand-off-case modal - the cross-firm counterpart to CaseLeadHandover's
 * in-firm teammate dropdown. Opened from the case detail view when the
 * advocate can't attend and needs to pass the whole matter to someone
 * outside the firm, who may not have a DifAi account yet.
 *
 * Two target modes:
 *   - Teammate: same dropdown/flow as CaseLeadHandover (existingUserId).
 *   - Outside advocate: generates a shareable link + QR code (`open_link`
 *     target kind) with no recipient known up front - A shares it however
 *     they like (WhatsApp, in person, etc). No email is collected or sent
 *     by DifAi; B supplies their own identity when they open the link.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { useTeammates } from '@/hooks/useAssignments';
import { useRequestHandover, type HandoverRequest } from '@/hooks/useCoCounsel';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

type Mode = 'teammate' | 'external';

interface Props {
  open: boolean;
  onClose: () => void;
  caseId: string;
  caseTitle?: string;
}

function acceptUrl(token: string): string {
  return `${window.location.origin}/co-counsel/accept/${token}`;
}

export function HandOffCaseModal({ open, onClose, caseId, caseTitle }: Props) {
  const teammates = useTeammates();
  const requestHandover = useRequestHandover(caseId);
  const showToast = useUIStore((s) => s.showToast);

  const [mode, setMode] = useState<Mode>('teammate');
  const [teammateId, setTeammateId] = useState('');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('urgent');
  const [link, setLink] = useState<HandoverRequest | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const teammateOptions = useMemo(() => teammates.data ?? [], [teammates.data]);

  // Render the QR once a link exists - toDataURL is async (canvas encode).
  useEffect(() => {
    if (!link?.shareToken) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(acceptUrl(link.shareToken), { margin: 1, width: 240 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [link?.shareToken]);

  const reset = () => {
    setMode('teammate');
    setTeammateId('');
    setReason('');
    setUrgency('urgent');
    setLink(null);
    setQrDataUrl(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'teammate') {
        await requestHandover.mutateAsync({ target: { existingUserId: teammateId }, reason: reason.trim() || undefined, urgency });
        showToast({ type: 'sage', text: 'Matter handed off' });
        handleClose();
        return;
      }

      // External: generate the shareable link/QR. Stay in the modal so the
      // advocate can copy/scan it before closing - this isn't a terminal
      // action like the teammate path, so we don't auto-close.
      const created = await requestHandover.mutateAsync({ target: { open: true }, reason: reason.trim() || undefined, urgency });
      setLink(created);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Could not hand off this matter';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const handleCopyLink = async () => {
    if (!link?.shareToken) return;
    try {
      await navigator.clipboard.writeText(acceptUrl(link.shareToken));
      showToast({ type: 'sage', text: 'Link copied' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy the link - select and copy it manually' });
    }
  };

  // Web Share API - only present on mobile browsers / some desktop browsers
  // with OS share-sheet integration (Android Chrome, iOS Safari, recent
  // Windows/macOS Chrome+Edge). Feature-detected: `canShare` is undefined on
  // unsupported browsers, so the button simply doesn't render there and Copy
  // remains the only option - no broken click handler left dangling.
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    if (!link?.shareToken) return;
    try {
      await navigator.share({
        title: caseTitle ? `Take over "${caseTitle}" on DifAi` : 'Case handover on DifAi',
        text: reason.trim() || 'You’ve been asked to take over a matter on DifAi.',
        url: acceptUrl(link.shareToken),
      });
    } catch (err) {
      // AbortError fires when the user dismisses the share sheet - not an error.
      if ((err as Error)?.name !== 'AbortError') {
        showToast({ type: 'vermillion', text: 'Could not open the share sheet - try Copy instead' });
      }
    }
  };

  const canSubmit = mode === 'teammate' ? !!teammateId : true;

  // Once a link has been generated, the modal shows the share step instead
  // of the form - there's nothing left to fill in.
  if (link?.shareToken) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        eyebrow="Handover"
        title="Share this link"
        description="Send it to the advocate however you like - WhatsApp, SMS, in person. Opening it lets them set up their own free DifAi account and take over this case."
        footer={<button type="button" className="btn btn-primary" onClick={handleClose}>Done</button>}
      >
        <div className="col" style={{ gap: 16, alignItems: 'center' }}>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="QR code to accept this case handover"
              width={200}
              height={200}
              style={{ borderRadius: 'var(--radius-md)', background: '#fff', padding: 8 }}
            />
          )}
          {canNativeShare && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => { void handleNativeShare(); }}
            >
              Share via WhatsApp, SMS…
            </button>
          )}
          <div className="row" style={{ gap: 8, width: '100%' }}>
            <input className="input" readOnly value={acceptUrl(link.shareToken)} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn" onClick={() => { void handleCopyLink(); }}>Copy</button>
          </div>
          <p className="body-xs muted" style={{ margin: 0 }}>
            This link works once and expires in 7 days.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      eyebrow="Handover"
      title={caseTitle ? `Hand off "${caseTitle}"` : 'Hand off this matter'}
      description="Can't attend? Pass the whole case - including hearings and notes an accepting advocate needs - to someone else."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={handleClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || requestHandover.isPending}>
            {requestHandover.isPending
              ? (mode === 'teammate' ? 'Sending…' : 'Generating…')
              : (mode === 'teammate' ? 'Hand off matter' : 'Generate link')}
          </button>
        </>
      }
    >
      <Field label="HAND OFF TO" required wide>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className={mode === 'teammate' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode('teammate')}
          >
            A colleague in my firm
          </button>
          <button
            type="button"
            className={mode === 'external' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode('external')}
          >
            An advocate outside my firm
          </button>
        </div>
      </Field>

      {mode === 'teammate' ? (
        <Field label="COLLEAGUE" required wide>
          <select
            className="input"
            value={teammateId}
            onChange={(e) => setTeammateId(e.target.value)}
            disabled={teammates.isLoading}
            required
          >
            <option value="">Select a colleague…</option>
            {teammateOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t.role}</option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="body-xs muted" style={{ marginTop: -4 }}>
          You&rsquo;ll get a link and QR code to share with the advocate however you like. Opening it
          lets them set up their own free DifAi account and get read access to this case - no
          email needed from you.
        </p>
      )}

      <Field label="REASON" wide help="Shown to the receiving advocate so they can step in without a call.">
        <textarea
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical' }}
          placeholder="e.g. Medical emergency, can't make today's hearing…"
        />
      </Field>

      <Field label="URGENCY" wide>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className={urgency === 'urgent' ? 'btn btn-primary' : 'btn'}
            onClick={() => setUrgency('urgent')}
          >
            Urgent - today
          </button>
          <button
            type="button"
            className={urgency === 'normal' ? 'btn btn-primary' : 'btn'}
            onClick={() => setUrgency('normal')}
          >
            Normal
          </button>
        </div>
      </Field>
    </Modal>
  );
}
