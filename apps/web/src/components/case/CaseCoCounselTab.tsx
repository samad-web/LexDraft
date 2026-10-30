import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCancelHandover, useHandoverRequests, type HandoverRequest } from '@/hooks/useCoCounsel';
import { useCan } from '@/hooks/useFirmAdmin';
import { useTeammates } from '@/hooks/useAssignments';
import { CaseLeadHandover } from '../CaseLeadHandover';
import { useUIStore } from '@/store/ui';
import { HandOffCaseModal } from '../HandOffCaseModal';

// =============================================================================
// Co-Counsel tab on the case page - who this matter has been handed to or
// shared with (teammates, advocates outside the firm, open share links), the
// state of each request, and the "Invite co-counsel" action. Requests come
// from GET /co-counsel/requests (firm-wide) filtered to this matter.
// =============================================================================

const STATUS_LABEL: Record<HandoverRequest['status'], string> = {
  pending: 'Waiting to accept',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const KIND_LABEL: Record<HandoverRequest['targetKind'], string> = {
  in_firm_user: 'Teammate',
  existing_external_user: 'DifAi advocate',
  new_external_invite: 'Invited by email',
  open_link: 'Share link / QR',
};

function who(r: HandoverRequest): string {
  if (r.targetKind === 'open_link') return 'Anyone with the link';
  return r.targetName || r.targetEmail || r.targetPhone || 'Advocate';
}

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function CaseCoCounselTab({ caseId, caseTitle }: { caseId: string; caseTitle: string }) {
  const requests = useHandoverRequests();
  const cancel = useCancelHandover();
  const canHandOff = useCan('co_counsel.handover');
  const showToast = useUIStore((s) => s.showToast);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Lead advocate only means something with colleagues to hand to.
  const teammates = useTeammates();
  const hasTeam = (teammates.data?.length ?? 0) > 1;

  const mine = (requests.data ?? [])
    .filter((r) => r.caseId === caseId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const active = mine.filter((r) => r.status === 'pending' || r.status === 'accepted');
  const past = mine.filter((r) => r.status !== 'pending' && r.status !== 'accepted');

  const onCancel = (r: HandoverRequest) => {
    cancel.mutate(r.id, {
      onSuccess: () => showToast({ type: 'sage', text: 'Invite cancelled' }),
      onError: (err) => showToast({
        type: 'vermillion',
        text: (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not cancel the invite',
      }),
    });
  };

  return (
    <div className="cs-cc-wrap">
    {hasTeam && <CaseLeadHandover caseId={caseId} caseTitle={caseTitle} />}
    <div className="card cs-cc">
      <div className="cs-cc-head">
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <h2 className="cs-card-title">Co-counsel</h2>
          <p className="cs-card-sub" style={{ maxWidth: 620 }}>
            Bring in another advocate on this matter, or hand it over when the client changes counsel.
            They see the hearings, documents and shared notes once they accept.
          </p>
        </div>
        {canHandOff && (
          <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
            <Icon name="handshake" size={14} /> Invite co-counsel
          </button>
        )}
      </div>

      {requests.isLoading ? (
        <p className="cs-muted">Loading…</p>
      ) : requests.isError ? (
        <p className="cs-muted">Could not load co-counsel for this matter.</p>
      ) : mine.length === 0 ? (
        <div className="adv-empty">
          <span className="adv-empty-icon"><Icon name="handshake" size={20} /></span>
          <span className="adv-empty-title">No co-counsel yet</span>
          <span className="adv-muted">
            {canHandOff
              ? 'Invite a teammate, an advocate outside your firm, or share a link / QR.'
              : 'Your plan does not include co-counsel invites.'}
          </span>
        </div>
      ) : (
        <>
          {active.length > 0 && <RequestList title="On this matter" items={active} onCancel={onCancel} cancelling={cancel.isPending} />}
          {past.length > 0 && <RequestList title="Earlier invites" items={past} onCancel={onCancel} cancelling={cancel.isPending} />}
        </>
      )}

      <HandOffCaseModal open={inviteOpen} onClose={() => setInviteOpen(false)} caseId={caseId} caseTitle={caseTitle} />
    </div>
    </div>
  );
}

function RequestList({
  title, items, onCancel, cancelling,
}: {
  title: string;
  items: HandoverRequest[];
  onCancel: (r: HandoverRequest) => void;
  cancelling: boolean;
}) {
  return (
    <section>
      <div className="cs-section-head" style={{ paddingLeft: 0 }}>
        <span>{title}</span>
        <span className="cs-section-count">{items.length}</span>
      </div>
      <ul className="adv-list">
        {items.map((r) => {
          const name = who(r);
          const contact = r.targetKind !== 'open_link' && r.targetName ? (r.targetEmail || r.targetPhone || '') : '';
          return (
            <li key={r.id} className="cs-cc-row">
              <span className="adv-avatar adv-avatar-sm">
                {r.targetKind === 'open_link' ? <Icon name="globe" size={15} /> : initials(name)}
              </span>
              <span className="adv-row-main">
                <span className="adv-row-title">{name}</span>
                <span className="adv-row-sub">
                  {[KIND_LABEL[r.targetKind], contact, `Sent ${fmtDate(r.createdAt)}`, r.requestedByName ? `by ${r.requestedByName}` : '']
                    .filter(Boolean).join(' · ')}
                </span>
                {r.reason && <span className="cs-cc-reason">“{r.reason}”</span>}
              </span>
              {r.urgency === 'urgent' && <span className="cs-status is-strong">Urgent</span>}
              <span className={`cs-status ${r.status === 'accepted' ? 'is-ink' : r.status === 'pending' ? 'is-strong is-dashed' : 'is-quiet'}`}>{STATUS_LABEL[r.status]}</span>
              {r.status === 'pending' && (
                <button type="button" className="btn btn-sm" onClick={() => onCancel(r)} disabled={cancelling}>
                  Cancel
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
