import { Link } from 'react-router-dom';
import { useEcourtsSyncStatus } from '@/hooks/useEcourts';

/**
 * One-line health of the firm's eCourts connection: when the last scheduled
 * update ran (09:00 / 19:00 IST), whether eCourts was reachable, and how many
 * matters are connected vs waiting. Renders nothing until there is data.
 */
export function EcourtsSyncStatusStrip() {
  const { data } = useEcourtsSyncStatus();
  if (!data) return null;
  const { lastRun, counts, retryPending } = data;

  const when = lastRun
    ? new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : null;
  const slot = lastRun?.slot === 'morning' ? 'Morning' : 'Evening';

  let dot = 'dot-sage';
  let text: string;
  if (!lastRun) {
    dot = 'dot-muted';
    text = 'Automatic eCourts updates run daily at 9 AM and 7 PM.';
  } else if (lastRun.status === 'running') {
    dot = 'dot-cobalt';
    text = `${slot} eCourts update in progress…`;
  } else if (lastRun.status === 'upstream_down') {
    dot = 'dot-amber';
    text = retryPending
      ? `eCourts was not responding at the ${slot.toLowerCase()} update (${when}). Retrying automatically every ${data.schedule.retryEveryMinutes} minutes.`
      : `eCourts was not responding at the ${slot.toLowerCase()} update (${when}). Next update at ${lastRun.slot === 'morning' ? '7 PM' : '9 AM'}.`;
  } else if (lastRun.status === 'partial') {
    dot = 'dot-amber';
    text = `${slot} update ${when}: some matters could not be refreshed${retryPending ? ', retrying automatically' : ''}.`;
  } else {
    text = `${slot} eCourts update completed ${when}. Next: ${lastRun.slot === 'morning' ? '7 PM' : '9 AM'}.`;
  }

  const waiting = (counts?.pending ?? 0) + (counts?.notFound ?? 0) + (counts?.error ?? 0);

  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }} role="status">
      <span className={`dot ${dot}`} style={{ flexShrink: 0, marginTop: 7 }} />
      <span className="col" style={{ gap: 2, flex: '1 1 260px', minWidth: 0 }}>
        <span className="body-sm muted">{text}</span>
        {counts ? (
          <span className="body-sm" style={{ color: 'var(--text-tertiary)' }}>
            Your matters: {counts.linked} connected to eCourts
            {waiting > 0 ? ` · ${waiting} need attention` : ''}
            {counts.unlinked > 0 ? ` · ${counts.unlinked} ${counts.unlinked === 1 ? 'has' : 'have'} no CNR yet` : ''}
          </span>
        ) : null}
      </span>
      {counts && counts.unlinked + waiting > 0 ? (
        <Link to="/app/cases?ecourts=attention" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }}>
          Connect matters →
        </Link>
      ) : null}
    </div>
  );
}
