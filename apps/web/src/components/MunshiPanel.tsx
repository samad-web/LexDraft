import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCancelInvitation, useInvitations } from '@/hooks/useInvitations';
import { InviteMemberModal } from '@/components/InviteMemberModal';

interface MunshiMember { id: string; name: string; email: string; status: string }

/**
 * "Your Munshi" on Plan & Billing for Advocate plan owners
 * (features/solo-munshi.md): invite a Munshi into a paid Munshi seat, see
 * pending invitations, and remove a Munshi. The API only lets this owner
 * touch Munshi seats.
 */
export function MunshiPanel({ seats }: { seats: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const members = useQuery({
    queryKey: ['firm-munshi'],
    queryFn: () => api.get<{ items: MunshiMember[] }>('/firm/munshi'),
    select: (r) => r.items,
  });
  const invites = useInvitations();
  const cancel = useCancelInvitation();
  const remove = useMutation({
    mutationFn: (id: string) => api.patch(`/firm/munshi/${id}`, { status: 'deactivated' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['firm-munshi'] }),
  });
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending');
  const used = (members.data?.filter((m) => m.status === 'active').length ?? 0) + pending.length;
  const full = used >= seats;

  return (
    <section aria-label="Your Munshi" id="munshi">
      <h2 className="cm-plans-title" style={{ marginBottom: 4 }}>Your Munshi</h2>
      <p className="body-sm muted" style={{ marginTop: 0 }}>
        {used} of {seats} Munshi seat{seats === 1 ? '' : 's'} used. A Munshi gets cases, diary, hearings, eCourts, eFiling and documents, with no AI.
      </p>
      <ul className="col" style={{ gap: 8, listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
        {(members.data ?? []).map((m) => (
          <li key={m.id} className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>{m.name} · <span className="muted">{m.email}</span>{m.status !== 'active' ? ` · ${m.status}` : ''}</span>
            <button type="button" className="btn btn-sm" disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Remove ${m.name}? They will no longer be able to sign in.`)) remove.mutate(m.id); }}>
              Remove
            </button>
          </li>
        ))}
        {pending.map((i) => (
          <li key={i.id} className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>{i.email} · <span className="muted">invited, not joined yet</span></span>
            <button type="button" className="btn btn-sm" disabled={cancel.isPending} onClick={() => cancel.mutate(i.id)}>
              Cancel invite
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary btn-sm" disabled={full} onClick={() => setOpen(true)}>
        Invite your Munshi
      </button>
      {full && <p className="body-sm muted">All Munshi seats are in use. Add a seat below, or remove someone first.</p>}
      {(remove.isError || cancel.isError) && (
        <div role="alert" className="cm-error-line">{(remove.error ?? cancel.error)?.message}</div>
      )}
      <InviteMemberModal open={open} onClose={() => setOpen(false)} munshiOnly />
    </section>
  );
}
