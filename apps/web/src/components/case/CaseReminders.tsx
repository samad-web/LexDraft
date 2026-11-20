import { Icon } from '@lexdraft/ui';
import { useDeleteReminder, useReminders } from '@/hooks/useReminders';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** This user's reminders on the matter (reminders.md). Hearings also get the
 *  automatic ones: 3 days before, the evening before and the morning. */
export function CaseReminders({ caseId, onAdd }: { caseId: string; onAdd: () => void }) {
  const list = useReminders(caseId);
  const remove = useDeleteReminder();
  const items = list.data ?? [];

  return (
    <div className="card cs-reminders">
      <div className="cs-card-head" style={{ marginBottom: 6 }}>
        <h2 className="cs-card-title">Reminders</h2>
        <button type="button" className="btn btn-sm" onClick={onAdd}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="body-sm muted" style={{ margin: 0 }}>
          Hearings are reminded automatically. Add your own for anything else, at any date and time.
        </p>
      ) : (
        <ul className="cs-reminder-list">
          {items.map((r) => (
            <li key={r.id} className={r.sentAt ? 'is-sent' : undefined}>
              <Icon name="bell" size={14} aria-hidden />
              <div className="cs-reminder-main">
                <div className="cs-reminder-title">{r.title}</div>
                <div className="cs-reminder-when">{r.sentAt ? `Sent ${when(r.sentAt)}` : when(r.remindAt)}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete reminder: ${r.title}`}
                onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
