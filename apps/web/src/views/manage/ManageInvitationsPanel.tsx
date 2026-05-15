import { useState } from 'react';
import { useCancelInvitation, useInvitations, useResendInvitation } from '@/hooks/useInvitations';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { useUIStore } from '@/store/ui';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManageInvitationsPanel() {
  const invitations = useInvitations();
  const cancel = useCancelInvitation();
  const resend = useResendInvitation();
  const showToast = useUIStore((s) => s.showToast);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Hooks must run on every render (rules-of-hooks). When data isn't yet
  // loaded, both lists are empty and the pagers are no-ops — cheaper than
  // restructuring the loading state.
  const all = invitations.data ?? [];
  const pending = all.filter((i) => i.status === 'pending');
  const past = all.filter((i) => i.status !== 'pending');
  const pendingPager = usePagination(pending);
  const pastPager = usePagination(past);

  if (invitations.isLoading) {
    return <div className="muted">Loading invitations…</div>;
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Invitations</div>
          <div className="body-md muted">
            Pending: {pending.length} · Past: {past.length}
          </div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
          + Invite member
        </button>
      </div>

      {pending.length === 0 && past.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
          <div className="heading-sm" style={{ marginBottom: 8 }}>No invitations yet</div>
          <div className="body-sm muted" style={{ marginBottom: 16 }}>
            Send an invite from the button above. The link is also copied to your clipboard for sharing.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
            Send your first invite
          </button>
        </div>
      ) : (
        <>
          <Section title="Pending" empty="No pending invitations.">
            {pendingPager.slice.map((i) => (
              <tr key={i.id}>
                <td className="mono" style={{ fontSize: 13 }}>{i.email}</td>
                <td>{i.role}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {new Date(i.createdAt).toLocaleDateString()}
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {new Date(i.expiresAt).toLocaleDateString()}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const url = `${window.location.origin}/invite/${i.token}`;
                        void navigator.clipboard?.writeText(url);
                        showToast({ type: 'sage', text: 'Invite link copied' });
                      }}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => resend.mutate(i.id, {
                        onSuccess: () => showToast({ type: 'sage', text: 'Invite resent' }),
                        onError: (err) => showToast({
                          type: 'vermillion',
                          text: (err as Error).message || 'Couldn’t resend',
                        }),
                      })}
                      disabled={resend.isPending}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      onClick={() => cancel.mutate(i.id, {
                        onSuccess: () => showToast({ type: 'amber', text: 'Invite cancelled' }),
                        onError: (err) => showToast({
                          type: 'vermillion',
                          text: (err as Error).message || 'Couldn’t cancel',
                        }),
                      })}
                      disabled={cancel.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Section>
          {pending.length > 0 && (
            <Pagination
              page={pendingPager.page}
              totalPages={pendingPager.totalPages}
              total={pendingPager.total}
              pageSize={pendingPager.pageSize}
              onChange={pendingPager.setPage}
            />
          )}

          <Section title="Past" empty="No past invitations.">
            {pastPager.slice.map((i) => (
              <tr key={i.id}>
                <td className="mono" style={{ fontSize: 13 }}>{i.email}</td>
                <td>{i.role}</td>
                <td>
                  <span
                    className={`badge ${
                      i.status === 'accepted'
                        ? 'badge-sage'
                        : i.status === 'expired'
                          ? 'badge-amber'
                          : 'badge-vermillion'
                    }`}
                  >
                    {i.status}
                  </span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {new Date(i.createdAt).toLocaleDateString()}
                </td>
                <td />
              </tr>
            ))}
          </Section>
          {past.length > 0 && (
            <Pagination
              page={pastPager.page}
              totalPages={pastPager.totalPages}
              total={pastPager.total}
              pageSize={pastPager.pageSize}
              onChange={pastPager.setPage}
            />
          )}
        </>
      )}

      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="eyebrow">{title}</div>
      {hasRows ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th style={{ width: 200 }}>Role / status</th>
                <th style={{ width: 130 }}>Sent</th>
                <th style={{ width: 130 }}>Expires</th>
                <th style={{ width: 240, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : (
        <div className="muted body-sm" style={{ padding: 12 }}>{empty}</div>
      )}
    </div>
  );
}
