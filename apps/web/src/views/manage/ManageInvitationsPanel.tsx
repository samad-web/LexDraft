import { useState } from 'react';
import { Icon } from '@lexdraft/ui';

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
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
    return <div className="fm-loading">Loading invitations…</div>;
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="fm-manage-intro">
        <p>
          <strong>{pending.length}</strong> pending · <strong>{past.length}</strong> past. Share a pending link with a
          colleague, resend it for seven more days, or cancel it.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
          <Icon name="plus" size={14} /> Invite member
        </button>
      </div>

      {pending.length === 0 && past.length === 0 ? (
        <div className="fm-empty-card">
          <div className="fm-panel-title">No invitations yet</div>
          <div style={{ marginBottom: 16 }}>
            Create an invite from the button above, then share its link with your colleague.
          </div>
          <button type="button" className="btn" onClick={() => setInviteOpen(true)}>
            Send your first invite
          </button>
        </div>
      ) : (
        <>
          <Section title="Pending" empty="No pending invitations.">
            {pendingPager.slice.map((i) => (
              <tr key={i.id}>
                <td className="fm-cell-title" style={{ overflowWrap: 'anywhere' }}>{i.email}</td>
                <td>{i.role}</td>
                <td><span className="fm-date">{shortDate(i.createdAt)}</span></td>
                <td><span className="fm-date">{shortDate(i.expiresAt)}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
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
                        onSuccess: (r) => {
                          void navigator.clipboard?.writeText(`${window.location.origin}/invite/${r.token}`).catch(() => undefined);
                          showToast({
                            type: 'sage',
                            text: r.emailSent
                              ? `Invitation emailed again to ${i.email}. Valid for 7 more days.`
                              : `Extended 7 days and link copied. Email isn't set up, so share it with ${i.email} yourself.`,
                          });
                        },
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
                      className="btn btn-sm btn-ghost"
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

          <Section title="Past" empty="No past invitations." fourth="Status">
            {pastPager.slice.map((i) => (
              <tr key={i.id}>
                <td className="fm-cell-title" style={{ overflowWrap: 'anywhere' }}>{i.email}</td>
                <td>{i.role}</td>
                <td>
                  <span className="fm-date">{shortDate(i.createdAt)}</span>
                </td>
                <td>
                  <span
                    className={`fm-pill ${
                      i.status === 'accepted'
                        ? 'is-solid'
                        : i.status === 'expired'
                          ? 'is-dashed'
                          : 'is-muted'
                    }`}
                  >
                    {i.status}
                  </span>
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

function Section({ title, empty, children, fourth = 'Expires' }: { title: string; empty: string; children: React.ReactNode; fourth?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="fm-section-label"><h3 className="fm-panel-title">{title}</h3></div>
      {hasRows ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl fm-tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th style={{ width: 200 }}>Role</th>
                <th style={{ width: 130 }}>Sent</th>
                <th style={{ width: 130 }}>{fourth}</th>
                <th style={{ width: 240, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : (
        <div className="fm-empty-card" style={{ padding: '22px 20px' }}>{empty}</div>
      )}
    </div>
  );
}
