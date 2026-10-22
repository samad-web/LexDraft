import { useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useCurrentUserId, useTeammates } from '@/hooks/useAssignments';
import { useAddMatterMember, useHasTeamChat, useMatterDiscussion, useRemoveMatterMember } from '@/hooks/useTeamChat';
import { useUIStore } from '@/store/ui';
import { ConversationPane } from './ConversationPane';

/**
 * Matter "Discussion" tab: the matter's team thread. Only people assigned to
 * the matter (lead + collaborators, including co-counsel) can read or post.
 * The lead and firm heads can assign colleagues as collaborators from here,
 * which is what brings them into the discussion.
 */
export function MatterDiscussionPanel({ caseId }: { caseId: string }) {
  const enabled = useHasTeamChat();
  const access = useMatterDiscussion(enabled ? caseId : undefined);
  const myId = useCurrentUserId();
  const teammates = useTeammates();
  const add = useAddMatterMember(caseId);
  const remove = useRemoveMatterMember(caseId);
  const showToast = useUIStore((s) => s.showToast);
  const [adding, setAdding] = useState('');

  if (!enabled) return null;
  if (access.isLoading) return <div className="card"><Skeleton width="100%" height={240} radius="md" /></div>;
  if (access.isError || !access.data) {
    return <div className="card"><ErrorState variant="inline" title="Couldn't load the discussion" description="Try again in a moment." /></div>;
  }

  const d = access.data;
  const fail = (err: unknown) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Something went wrong' });
  const assigned = new Set(d.assignees.map((a) => a.userId));
  const candidates = (teammates.data ?? []).filter((t) => !assigned.has(t.id));

  return (
    <div className="split-2-wide" style={{ gap: 24, alignItems: 'start' }}>
      <section className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'min(70vh, 720px)', minHeight: 420 }}>
        {d.isMember && d.conversation ? (
          <ConversationPane conversationId={d.conversation.id} compactHeader />
        ) : (
          <div style={{ padding: 16 }}>
            <EmptyState
              variant="inline"
              title="Only people assigned to this matter can see its discussion"
              description={d.canManageMembers
                ? 'Add yourself or colleagues from the panel alongside to join the conversation.'
                : 'Ask the matter lead to add you.'}
            />
          </div>
        )}
      </section>

      <aside className="card col" style={{ gap: 12 }}>
        <div className="heading-sm">People on this matter</div>
        {d.assignees.length === 0 && <div className="muted body-sm">No one is assigned yet.</div>}
        {d.assignees.map((a) => (
          <div key={a.userId} className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              {a.userId === myId ? 'You' : a.name}
              <span className="muted mono" style={{ fontSize: 10, marginLeft: 8 }}>{a.roleOnCase.toUpperCase()}</span>
            </span>
            {a.roleOnCase !== 'lead' && (d.canManageMembers || a.userId === myId) && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate(a.userId, { onError: fail })}
              >
                {a.userId === myId ? 'Leave' : 'Remove'}
              </button>
            )}
          </div>
        ))}
        {d.canManageMembers && candidates.length > 0 && (
          <div className="row" style={{ gap: 8 }}>
            <select
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              aria-label="Assign a colleague"
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
            >
              <option value="">Assign a colleague…</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>{t.id === myId ? `${t.name} (you)` : t.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!adding || add.isPending}
              onClick={() => add.mutate(adding, { onSuccess: () => setAdding(''), onError: fail })}
            >
              Add
            </button>
          </div>
        )}
        <p className="muted body-sm" style={{ margin: 0 }}>
          Collaborators added here are assigned to the matter. To change the lead, use "Hand off entire case" on the Overview tab.
        </p>
      </aside>
    </div>
  );
}
