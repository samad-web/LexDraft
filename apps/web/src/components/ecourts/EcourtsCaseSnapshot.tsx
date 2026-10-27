import { orderDateOf, useEcourtsCnr, type Court, type EcourtsOrder } from '@/hooks/useEcourts';

// =============================================================================
// The eCourts essentials of a linked matter, at the top of its Overview: what
// an advocate checks first in the eCourts app (status, next date, stage, court
// and judge, latest order, last hearing). Read from DifAI's stored copy, so
// it shows as soon as the matter opens; the full record is on the eCourts tab.
// =============================================================================

/** eCourts dates come as yyyy-mm-dd or dd-mm-yyyy; show dd-mm-yyyy. */
function dmy(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  if (!s || s.startsWith('0000')) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : s;
}

function sortKey(d: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy(d));
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

function latestOrder(orders: Array<EcourtsOrder | null | undefined>): EcourtsOrder | null {
  return orders
    .filter((o): o is EcourtsOrder => Boolean(orderDateOf(o)))
    .sort((a, b) => sortKey(orderDateOf(b)).localeCompare(sortKey(orderDateOf(a))))[0] ?? null;
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="col" style={{ gap: 2, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      <span className={`body-md${mono ? ' mono tabular' : ''}`} style={{ overflowWrap: 'anywhere', color: value ? undefined : 'var(--text-tertiary)' }}>
        {value || '—'}
      </span>
    </div>
  );
}

export function EcourtsCaseSnapshot({ cnr, court, onOpenRecord }: { cnr: string; court: Court; onOpenRecord: () => void }) {
  const { data: h, isLoading, isNotFound, queued, meta } = useEcourtsCnr(cnr, court);

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>eCourts</div>
        <h2 className="heading-md">Case status</h2>
      </div>
      <button type="button" className="btn btn-sm" onClick={onOpenRecord}>Full eCourts record →</button>
    </div>
  );

  if (!h) {
    return (
      <div className="card" id="ecourts-snapshot">
        {header}
        <p className="body-sm muted">
          {isLoading ? `Getting ${cnr} from eCourts…`
            : queued ? `eCourts is busy. DifAI will fetch ${cnr} as soon as it answers.`
            : isNotFound ? `eCourts has no record for ${cnr}${court === 'HC' ? ' in the High Court' : ' in the District Courts'}.`
            : 'eCourts did not answer. Use Sync eCourts to try again.'}
        </p>
      </div>
    );
  }

  const disposed = Boolean(h.date_of_decision && h.disp_name);
  const order = latestOrder([...(h.finalOrder ?? []), ...(h.interimOrder ?? []), h.last_order]);
  const hearings = h.historyOfCaseHearing ?? [];
  const lastHearing = hearings[hearings.length - 1] ?? null;
  const regNo = h.reg_no ? `${h.type_name ? `${String(h.type_name)}/` : ''}${h.reg_no}/${h.reg_year}` : '';

  return (
    <div className="card" id="ecourts-snapshot">
      {header}
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className={`badge ${disposed ? 'badge-cream' : 'badge-sage'}`}>{disposed ? 'DISPOSED' : 'PENDING'}</span>
        <span className="body-sm muted">{h.court_name}</span>
      </div>
      <div className="grid-2" style={{ gap: 16 }}>
        {disposed ? (
          <>
            <Item label="Decision date" value={dmy(h.date_of_decision)} mono />
            <Item label="Nature of disposal" value={h.disp_name ?? ''} />
          </>
        ) : (
          <>
            <Item label="Next hearing date" value={dmy(h.date_next_list) || 'Not given yet'} mono />
            <Item label="Case stage" value={h.purpose_name ?? ''} />
          </>
        )}
        <Item label="Court number and judge" value={h.desgname ?? ''} />
        <Item label="Registration number" value={regNo} mono />
        <Item label="Last hearing" value={lastHearing ? [dmy(lastHearing.todays_date1 || lastHearing.todays_date), lastHearing.purpose].filter(Boolean).join(' · ') : ''} />
        <Item label="Latest order" value={order ? [dmy(orderDateOf(order)), order.order_details].filter(Boolean).join(' · ') : 'No orders uploaded'} />
        <Item label="Petitioner advocate" value={String(h.pet_adv ?? '').replace(/<br\s*\/?>/gi, ' ').trim()} />
        <Item label="Respondent advocate" value={String(h.res_adv ?? '').replace(/<br\s*\/?>/gi, ' ').trim()} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="body-sm muted">
          {hearings.length} hearing{hearings.length === 1 ? '' : 's'} · {(h.interimOrder?.length ?? 0) + (h.finalOrder?.length ?? 0)} order(s)
          {h.transfer?.length ? ` · ${h.transfer.length} transfer(s)` : ''}
          {meta ? ` · updated ${ago(meta.fetchedAt)}${meta.refreshing ? ', refreshing' : ''}` : ''}
        </span>
      </div>
    </div>
  );
}
