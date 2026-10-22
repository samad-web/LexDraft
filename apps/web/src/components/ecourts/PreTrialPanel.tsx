import { useState, type FormEvent } from 'react';
import {
  useDownloadPreTrialOrder,
  useEcourtsPoliceStations,
  useEcourtsPreTrialSearch,
  type EcourtsPreTrialResult,
} from '@/hooks/useEcourts';
import { SearchableSelect } from '@/components/SearchableSelect';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import {
  AppField,
  ComplexSelect,
  FormGrid,
  GoReset,
  RadioRow,
  ScreenTitle,
  SectionBar,
  useComplexScope,
} from './app/AppUi';

// "Case Status : Pre Trial Application" exactly as in the eCourts app:
// Court Complex* -> Police Station* -> Fir Type -> FIR Number -> Year ->
// ( ) Remand ( ) Bail ( ) Application -> Go | Reset. Results: totals, one bar
// per establishment, "Application Details" (Sr.No | Accused Name |
// Application Date | Status) and the Remand / Bail / Application orders.
// App service, no captcha. Row and order field names follow the app's
// results screen (only empty answers seen live so far).

type Row = Record<string, unknown>;
type AppType = 'R' | 'B' | 'A';

const FIR_TYPES: ReadonlyArray<{ id: '0' | '1' | '2' | '3'; label: string }> = [
  { id: '0', label: 'Select Fir Type' }, { id: '1', label: 'I' }, { id: '2', label: 'II' }, { id: '3', label: 'III' },
];

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (err instanceof Error ? err.message : fallback);
}

export function PreTrialPanel({ onOpenCnr }: { onOpenCnr: (cnr: string) => void }) {
  const { t } = useEcourtsT();
  const { scope } = useComplexScope();
  const [applicationType, setApplicationType] = useState<AppType>('R');
  const [firType, setFirType] = useState<'0' | '1' | '2' | '3'>('0');
  const [policeSt, setPoliceSt] = useState('');
  const [firNumber, setFirNumber] = useState('');
  const [year, setYear] = useState('');
  const [result, setResult] = useState<{ data: EcourtsPreTrialResult; type: AppType } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stations = useEcourtsPoliceStations(scope?.stateCode, scope?.distCode, scope?.courtCodes ?? null, scope?.court);
  const search = useEcourtsPreTrialSearch();

  const reset = () => {
    setApplicationType('R'); setFirType('0'); setPoliceSt(''); setFirNumber(''); setYear('');
    setResult(null); setError(null); search.reset();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!scope || !policeSt) return;
    setError(null);
    setResult(null);
    search.mutate({
      stateCode: scope.stateCode,
      distCode: scope.distCode,
      courtCode: scope.courtCode,
      courtCodes: scope.courtCodes,
      applicationType,
      policeStCode: Number(policeSt),
      firType,
      firNumber: firNumber.trim() || undefined,
      year: /^\d{4}$/.test(year) ? Number(year) : undefined,
      court: scope.court,
    }, {
      onSuccess: (data) => setResult({ data, type: applicationType }),
      onError: (err) => setError(errorText(err, 'eCourts did not answer')),
    });
  };

  const total = result?.data.establishments.reduce((n, e) => n + Math.max(e.total, e.rows.length), 0) ?? 0;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card col" style={{ gap: 16 }}>
        <ScreenTitle section={t(L.caseStatus, 'Case Status')} title={t(L.preTrial, 'Pre Trial Application')} />
        {scope?.court === 'HC' ? (
          <p className="body-sm muted">Pre Trial Applications are filed in District Courts. Switch to District Court above.</p>
        ) : null}
        <form onSubmit={onSubmit} className="col" style={{ gap: 16 }}>
          <FormGrid>
            <ComplexSelect />
            <AppField label={t(L.policeStation, 'Police Station')} required>
              {stations.data && stations.data.length > 0 ? (
                <SearchableSelect
                  value={policeSt}
                  onChange={setPoliceSt}
                  placeholder="Select Police Station"
                  options={stations.data.map((s) => ({ value: s.code, label: s.name }))}
                />
              ) : (
                <select className="input" disabled value="">
                  <option value="">{!scope ? 'Select court complex first' : stations.isLoading ? 'Loading…' : stations.isError ? 'eCourts did not answer' : 'Select Police Station'}</option>
                </select>
              )}
            </AppField>
            <AppField label={t(L.firType, 'Fir Type')}>
              <select className="input" value={firType} onChange={(e) => setFirType(e.target.value as typeof firType)}>
                {FIR_TYPES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </AppField>
            <AppField label={t(L.firNumber, 'FIR Number')}>
              <input className="input" value={firNumber} maxLength={99} onChange={(e) => setFirNumber(e.target.value.replace(/[^\dA-Za-z/-]/g, ''))} />
            </AppField>
            <AppField label={t(L.year, 'Year')}>
              <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </AppField>
          </FormGrid>
          <RadioRow<AppType>
            name="pretrial-type"
            value={applicationType}
            onChange={setApplicationType}
            options={[
              { value: 'R', label: t(L.remand, 'Remand') },
              { value: 'B', label: t(L.bail, 'Bail') },
              { value: 'A', label: t(L.application, 'Application') },
            ]}
          />
          <GoReset disabled={!scope || !policeSt} pending={search.isPending} onReset={reset} />
        </form>
        {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      </div>

      {result ? (
        <div className="card col" style={{ gap: 10 }}>
          <span className="body-md">{t(L.totalEstablishments, 'Total Number of Establishments in Court Complex')}: {result.data.establishments.length}</span>
          <span className="body-md" style={{ fontWeight: 700 }}>{t(L.totalCases, 'Total Number of Cases')}: {total}</span>
          {result.data.establishments.map((est, i) => (
            Math.max(est.total, est.rows.length) === 0 && est.orders.length === 0 ? null : (
              <EstablishmentResults
                key={`${est.courtCode}-${i}`}
                est={est}
                type={result.type}
                scope={scope ? { stateCode: scope.stateCode, distCode: scope.distCode } : null}
                onOpenCnr={onOpenCnr}
              />
            )
          ))}
          {total === 0 ? <p className="body-md muted">No applications found for this police station.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function EstablishmentResults({ est, type, scope, onOpenCnr }: {
  est: EcourtsPreTrialResult['establishments'][number];
  type: AppType;
  scope: { stateCode: number; distCode: number } | null;
  onOpenCnr: (cnr: string) => void;
}) {
  const { t } = useEcourtsT();
  const [open, setOpen] = useState(true);
  const download = useDownloadPreTrialOrder();
  const [error, setError] = useState<string | null>(null);
  const detailsTitle = type === 'R' ? t(L.remand, 'Remand') + ' Details' : type === 'B' ? t(L.bail, 'Bail') + ' Details' : 'Application Details';
  const ordersTitle = type === 'R' ? t(L.remandOrders, 'Remand Orders') : type === 'B' ? t(L.bailOrders, 'Bail Orders') : 'Application Orders';

  const orderInput = (o: Row) => {
    const orderId = str(o.order_id ?? o.orderid ?? o.order_no);
    const orderYr = str(o.orderYr ?? o.order_year ?? o.orderyr);
    const crno = str(o.crno ?? o.cino ?? o.pre_no);
    const courtCode = Number(o.court_code ?? est.courtCode);
    return scope && orderId && orderYr && crno && courtCode > 0
      ? { stateCode: scope.stateCode, distCode: scope.distCode, courtCode, orderId, orderYr, crno }
      : null;
  };

  return (
    <div className="col">
      <SectionBar title={`${est.name || 'Court establishment'} : ${Math.max(est.total, est.rows.length)}`} open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? (
        <div className="col" style={{ gap: 12, paddingTop: 8 }}>
          {est.rows.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <div className="body-md" style={{ fontWeight: 700, padding: '6px 8px', background: 'var(--bg-surface-2)' }}>{detailsTitle}</div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>{t(L.srNo, 'Sr.No')}</th>
                    <th>Accused Name</th>
                    <th>{t(L.applicationDate, 'Application Date')}</th>
                    <th>{t(L.status, 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {est.rows.map((r, i) => {
                    const cino = str(r.cino).toUpperCase();
                    const status = str(r.date_of_decision) ? 'Disposed' : (str(r.status) || 'PENDING');
                    return (
                      <tr key={`${cino}-${i}`}>
                        <td>{str(r.srno) || i + 1}</td>
                        <td>
                          {/^[A-Z]{4}[A-Z0-9]{12}$/.test(cino) ? (
                            <button type="button" onClick={() => onOpenCnr(cino)} style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }}>
                              {str(r.accused_name) || str(r.pet_name) || cino}
                            </button>
                          ) : (str(r.accused_name) || [str(r.pet_name), str(r.res_name)].filter(Boolean).join(' vs ') || '—')}
                          {str(r.appl_type) || str(r.desg_name) ? <div className="body-sm muted">{[str(r.appl_type), str(r.desg_name)].filter(Boolean).join(' · ')}</div> : null}
                        </td>
                        <td>{str(r.appl_date) || '—'}</td>
                        <td>{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {est.orders.length > 0 ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="body-md" style={{ fontWeight: 700, padding: '6px 8px', background: 'var(--bg-surface-2)' }}>{ordersTitle}</div>
              <table className="tbl">
                <thead><tr><th>{t(L.orderNumber, 'Order Number')}</th><th>{t(L.orderDate, 'Order Date')}</th><th>{t(L.orderDetails, 'Order Details')}</th></tr></thead>
                <tbody>
                  {est.orders.map((o, i) => {
                    const input = orderInput(o);
                    return (
                      <tr key={i}>
                        <td>{str(o.order_no ?? o.order_id) || i + 1}</td>
                        <td>{str(o.order_date ?? o.orderdate) || '—'}</td>
                        <td>
                          {input ? (
                            <button
                              type="button"
                              disabled={download.isPending}
                              onClick={() => { setError(null); download.mutate(input, { onError: (err) => setError(errorText(err, 'Could not download the order')) }); }}
                              style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }}
                            >
                              {str(o.order_details) || 'Order'}
                            </button>
                          ) : (str(o.order_details) || '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
