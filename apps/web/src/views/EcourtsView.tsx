import { useState, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import { useEcourtsCnr, useDownloadOrderPdf, type EcourtsCaseHistory, type EcourtsHearing, type EcourtsOrder, type Court } from '@/hooks/useEcourts';
import { useUIStore } from '@/store/ui';

// =============================================================================
// EcourtsView
//
// Live CNR lookup against the eCourts Services backend. The previous version
// of this view was a UI-only mockup with canned data; everything below now
// talks to the real `/api/ecourts` surface (see apps/api/src/routes/
// ecourts.routes.ts).
// =============================================================================

// eCourts CNRs are 16 chars: 2 letters (state) + 2 letters (district) + 2
// alphanumeric (establishment, e.g. `0B` for Alandur JM) + 6 digits (serial)
// + 4 digits (year). Real-world examples:
//   KLER010001682023  — Kerala, Ernakulam, est 01
//   TNCG0B0011172024  — Tamil Nadu, Chengalpattu, est 0B
// We accept a permissive shape: 4 letters then 12 alphanumeric. Anything
// stricter rejects valid CNRs like TNCG0B…
const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

export function EcourtsView() {
  // Two pieces of state because the input is a draft until "Look up" lands —
  // we only want to fire the query against the *submitted* CNR, not on every
  // keystroke.
  const [draft, setDraft] = useState<string>('KLER010001682023');
  const [submittedCnr, setSubmittedCnr] = useState<string>('KLER010001682023');
  const [court, setCourt] = useState<Court>('DC');

  const { data: history, isLoading, isError, error, isFetching } = useEcourtsCnr(submittedCnr, court);

  const draftIsValid = CNR_RE.test(draft.trim().toUpperCase());

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleaned = draft.trim().toUpperCase();
    if (!CNR_RE.test(cleaned)) return;
    setSubmittedCnr(cleaned);
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ - ECOURTS GATEWAY</div>
        <h1 className="heading-xl">eCourts lookup</h1>
        <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
          Search any matter by its CNR (Case Number Record) — the 16-character national identifier.
          Data flows live from the official eCourts Services backend covering all district and high courts.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="search" size={18} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 240, height: 48, fontSize: 16, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
          placeholder="Enter CNR · e.g. KLER010001682023"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="CNR search"
          maxLength={16}
        />
        <select
          className="input"
          style={{ height: 48, width: 120 }}
          value={court}
          onChange={(e) => setCourt(e.target.value as Court)}
          aria-label="Court tier"
        >
          <option value="DC">District</option>
          <option value="HC">High Court</option>
        </select>
        <button type="submit" className="btn btn-primary btn-lg" disabled={!draftIsValid}>
          Look up case <Icon name="arrow" size={14} />
        </button>
      </form>

      {!draftIsValid && draft.length > 0 && (
        <div className="body-sm muted" style={{ paddingLeft: 4 }}>
          CNR must be exactly 16 characters (4 letters followed by 12 alphanumeric).
        </div>
      )}

      {isLoading || isFetching ? <LoadingCard cnr={submittedCnr} /> : null}

      {!isLoading && isError ? <ErrorCard error={error} /> : null}

      {!isLoading && !isError && history ? <CaseCard h={history} /> : null}

      {!isLoading && !isError && !history && !isFetching ? (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="dot dot-amber" />
            <div>
              <div className="heading-sm" style={{ marginBottom: 4 }}>No case found</div>
              <p className="body-sm muted">The eCourts backend did not return a record for this CNR.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingCard({ cnr }: { cnr: string }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-amber" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Fetching {cnr}…</div>
          <p className="body-sm muted">eCourts upstream is famously slow; this can take 5-15 seconds.</p>
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  return (
    <div className="card" style={{ borderColor: 'var(--vermillion)' }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-vermillion" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Lookup failed</div>
          <p className="body-sm muted">{msg}</p>
        </div>
      </div>
    </div>
  );
}

function CaseCard({ h }: { h: EcourtsCaseHistory }) {
  const disposed = Boolean(h.date_of_decision && h.disp_name);
  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '0.08em', marginBottom: 6 }}>
              CNR · {h.cino}
            </div>
            <h2 className="heading-lg" style={{ marginBottom: 4 }}>
              <em className="case-name">{(h.petName || h.pet_name) + ' v. ' + (h.resName || h.res_name)}</em>
            </h2>
            <p className="body-sm muted">{h.case_no} · {h.court_name}</p>
          </div>
          {disposed
            ? <span className="badge badge-sage">{(h.disp_name ?? '').toUpperCase()}</span>
            : <span className="badge badge-amber">PENDING</span>}
        </div>

        <hr className="hairline" style={{ margin: '20px 0' }} />

        <div className="grid-2" style={{ gap: 24 }}>
          <Field label="BENCH"          value={h.desgname || '—'} />
          <Field label="DISTRICT"       value={`${h.district_name}, ${h.state_name}`} />
          <Field label="DATE OF FILING" value={fmtDate(h.date_of_filing)} mono />
          <Field
            label={disposed ? 'DATE OF DECISION' : 'NEXT HEARING'}
            value={fmtDate(disposed ? h.date_of_decision : h.date_next_list) || '—'}
            mono
          />
          {h.purpose_name && <Field label="STAGE / PURPOSE" value={h.purpose_name} />}
          {h.pet_adv && <Field label="PETITIONER ADVOCATE" value={h.pet_adv.trim()} />}
          {h.res_adv && <Field label="RESPONDENT ADVOCATE" value={h.res_adv.trim()} />}
          {h.fir_no && <Field label="FIR"
            value={`${h.fir_no}/${h.fir_year}${h.fir_details ? ` · ${h.fir_details.split('^').filter(Boolean).join(' · ')}` : ''}`} />}
        </div>

        {h.act && h.act.length > 0 ? (
          <>
            <hr className="hairline" style={{ margin: '20px 0' }} />
            <div className="col" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
                ACTS & SECTIONS
              </span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {h.act.map((a, i) => (
                  <span key={i} className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
                    {a.actCodeName.trim().replace(/\\$/, '')} §{a.actSectionName}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {h.historyOfCaseHearing && h.historyOfCaseHearing.length > 0
        ? <HearingsTable hearings={h.historyOfCaseHearing} />
        : null}

      {((h.finalOrder?.length ?? 0) > 0 || (h.interimOrder?.length ?? 0) > 0)
        ? <OrdersList finalOrders={h.finalOrder ?? []} interimOrders={h.interimOrder ?? []} cino={h.cino} />
        : null}

      {h.transfer && h.transfer.length > 0 ? <TransferList transfers={h.transfer} /> : null}
    </div>
  );
}

function HearingsTable({ hearings }: { hearings: EcourtsHearing[] }) {
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Hearings</h2>
        <span className="spacer" />
        <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {hearings.length} {hearings.length === 1 ? 'ENTRY' : 'ENTRIES'}
        </span>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Date</th>
              <th>Purpose</th>
              <th>Bench</th>
              <th style={{ width: 140 }}>Next date</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {hearings.map((hr, i) => (
              <tr key={`${hr.todays_date}-${i}`}>
                <td className="mono tabular" style={{ fontSize: 12 }}>{hr.todays_date1 || hr.todays_date}</td>
                <td>{hr.purpose}</td>
                <td>{hr.judge_name}</td>
                <td className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {hr.nextdate ? fmtNextDate(hr.nextdate) : '—'}
                </td>
                <td>
                  {hr.businessStatus === 'Disposed'
                    ? <span className="badge badge-sage">DISPOSED</span>
                    : <span className="badge badge-amber">{hr.businessStatus?.toUpperCase()}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersList({ finalOrders, interimOrders, cino }: { finalOrders: EcourtsOrder[]; interimOrders: EcourtsOrder[]; cino: string }) {
  const rows = [
    ...interimOrders.map((o) => ({ ...o, kind: 'Interim' as const })),
    ...finalOrders.map((o) => ({ ...o, kind: 'Final' as const })),
  ];
  const download = useDownloadOrderPdf();
  const showToast = useUIStore((s) => s.showToast);
  // Track which row is in-flight so the button on that row alone shows
  // "Fetching…"; eCourts is too slow to leave the whole table looking idle.
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handleDownload = async (o: EcourtsOrder, kind: 'Interim' | 'Final', rowKey: string) => {
    setPendingKey(rowKey);
    try {
      const fname = await download.mutateAsync({
        cino,
        filename: o.filename,
        stateCd:   o.state_cd,
        distCd:    o.dist_cd,
        courtCode: o.court_code,
      });
      showToast({ type: 'sage', text: `Downloaded ${fname}` });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not download PDF';
      showToast({ type: 'vermillion', text: msg });
    } finally {
      setPendingKey(null);
    }
    // `kind` accepted just to keep the signature parallel for future filtering;
    // currently we don't differentiate the backend call by interim/final.
    void kind;
  };

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Orders & judgments</h2>
        <span className="spacer" />
        <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {rows.length} {rows.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
        </span>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Kind</th>
              <th style={{ width: 140 }}>Date</th>
              <th>Description</th>
              <th style={{ width: 140 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => {
              const rowKey = `${o.order_id}-${i}`;
              const isPending = pendingKey === rowKey;
              return (
                <tr key={rowKey}>
                  <td>
                    {o.kind === 'Final'
                      ? <span className="badge badge-sage">FINAL</span>
                      : <span className="badge">INTERIM</span>}
                  </td>
                  <td className="mono tabular" style={{ fontSize: 12 }}>{o.order_date1f}</td>
                  <td>
                    <div>{o.order_details}</div>
                    <div className="mono tabular" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, wordBreak: 'break-all' }}>
                      {o.filename}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => { void handleDownload(o, o.kind, rowKey); }}
                      disabled={isPending}
                      title="Fetch the order PDF from the eCourts gateway"
                    >
                      {isPending ? (
                        <>Fetching…</>
                      ) : (
                        <><Icon name="download" size={12} /> Download</>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransferList({ transfers }: { transfers: NonNullable<EcourtsCaseHistory['transfer']> }) {
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Court transfers</h2>
      </div>
      <div className="card">
        <ul className="col stagger" style={{ gap: 12, listStyle: 'none', paddingLeft: 0 }}>
          {transfers.map((t, i) => (
            <li key={i} className="body-sm">
              <span className="mono tabular" style={{ color: 'var(--text-tertiary)' }}>{t.transfer_date}</span>
              <span style={{ marginLeft: 12 }}>{t.from_court} → {t.to_court}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)' }} className={mono ? 'tabular' : ''}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '';
  // Accept YYYY-MM-DD or DD-MM-YYYY (eCourts mixes both).
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return iso;
}

function fmtNextDate(raw: string): string {
  // Hearings sometimes deliver `20230112` (compact YYYYMMDD).
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4); const m = raw.slice(4, 6); const d = raw.slice(6, 8);
    return fmtDate(`${y}-${m}-${d}`);
  }
  return raw;
}
