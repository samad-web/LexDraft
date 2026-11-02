import { useEffect, useState } from 'react';
import {
  openGateway,
  openedFileUrl,
  useEpayTransactionAction,
  useEpayTransactions,
  useEpayWallet,
  useOpenEpayForm,
  usePayFromWallet,
  useProceedToGateway,
  useSendEpayOtp,
  useSetEpayFields,
  type EpayField,
  type EpayFormView,
  type EpayGateway,
  type EpayOpened,
  type EpayTxnRow,
  type WalletTable,
} from '@/hooks/efiling/epay';
import { PortalModal, PortalTable } from '../PortalKit';
import { PButton, PCheck, PField, PortalButtons, PortalGrid, PortalSection, PortalTitle, PRadios } from '../PortalUi';
import { errMsg } from '../format';

// =============================================================================
// ePayments, live on the advocate's own portal session (filing.ecourts.gov.in):
//
//   Payment          the portal's own form, field for field and in its order
//                    (case source, e-filing number / case, payment type, payee,
//                    mobile, amount, remark), "I agree", Send OTP, OTP, verify
//                    -> the portal prepares the payment and DifAi opens the
//                    bank's page in a new tab for the advocate to pay there.
//                    The portal's transaction list: Get GRN, bank CIN,
//                    verification, challan.
//   Court Fee Wallet the portal's wallet page as shown + Pay Fees from it.
//
// DifAi never pays: verifying the OTP and paying from the wallet each need
// the advocate's confirmation here; the bank payment is done by the advocate.
// =============================================================================

export function PortalEpay({ sessionId, view }: { sessionId: string; view: 'payments' | 'wallet' }) {
  return view === 'wallet' ? <WalletScreen sessionId={sessionId} /> : <PaymentScreen sessionId={sessionId} />;
}

const box: React.CSSProperties = { border: '1px solid var(--border-default)', borderRadius: 4, padding: 12, background: 'var(--bg-surface)' };

/** What the portal said (its alerts and messages), in its own words. */
function PortalSays({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div role="status" style={{ ...box, background: 'var(--bg-surface-2)' }}>
      <span className="body-sm" style={{ fontWeight: 700 }}>The portal says:</span>
      <ul className="body-sm" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  );
}

// ---- Payment ---------------------------------------------------------------------

function PaymentScreen({ sessionId }: { sessionId: string }) {
  const open = useOpenEpayForm(sessionId);
  const setFields = useSetEpayFields(sessionId);
  const sendOtp = useSendEpayOtp(sessionId);
  const proceed = useProceedToGateway(sessionId);
  const [form, setForm] = useState<EpayFormView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [otp, setOtp] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [gateway, setGateway] = useState<EpayGateway | null>(null);
  const [txnsLabel, setTxnsLabel] = useState<string | null>(null);

  const reload = () => {
    setGateway(null);
    setOtp('');
    setDrafts({});
    open.mutate(true, { onSuccess: setForm });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per screen
  useEffect(reload, [sessionId]);

  const busy = open.isPending || setFields.isPending || sendOtp.isPending || proceed.isPending;
  const set = (fields: Array<{ key: string; value: string }>) => {
    setFields.mutate(fields, {
      onSuccess: (v) => {
        setForm(v);
        setDrafts((d) => { const n = { ...d }; for (const f of fields) delete n[f.key]; return n; });
      },
    });
  };
  const error = [open, setFields, sendOtp, proceed].find((m) => m.isError);

  if (!form) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <PortalTitle>Payment</PortalTitle>
        {open.isError
          ? <><p className="body-sm">{errMsg(open.error, 'Could not open Payment on the portal.')}</p><PortalButtons><PButton onClick={reload}>Try again</PButton></PortalButtons></>
          : <p className="body-sm muted" style={{ textAlign: 'center' }}>Opening ePayments &gt; Payment on filing.ecourts.gov.in…</p>}
      </div>
    );
  }

  const otpButtons = form.otp.buttons.filter((b) => b.kind === 'otp');
  const verifyButton = form.otp.buttons.find((b) => b.kind === 'verify');
  const txnButtons = form.buttons.filter((b) => b.kind === 'transactions');
  const amountField = form.fields.find((f) => f.key === 'amount');
  const payTypeField = form.fields.find((f) => f.key === 'epayOptions');
  const payeeField = form.fields.find((f) => f.key === 'payee');
  const otherPayee = form.fields.find((f) => f.key === 'extraparty');
  const shownValue = (f: EpayField | undefined) => {
    if (!f) return '';
    if (f.tag === 'radio') return f.choices?.find((c) => c.value === f.value)?.label ?? '';
    if (f.tag === 'select') return f.options?.find((o) => o.value === f.value)?.text ?? '';
    return f.value;
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="body-sm muted">On your account at filing.ecourts.gov.in</span>
        <span className="row" style={{ gap: 8 }}>
          {txnButtons.map((b) => (
            <button key={b.id || b.label} type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setTxnsLabel(b.label)}>{b.label}</button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={reload}>{open.isPending ? 'Opening…' : 'Start again'}</button>
        </span>
      </div>
      <PortalTitle>{form.title || 'Payment'}</PortalTitle>
      {error ? <p className="body-sm" role="alert">{errMsg(error.error, 'The portal did not answer. Try again.')}</p> : null}
      <PortalSays messages={form.messages} />

      <PortalGrid>
        {form.fields.map((f) => (
          <FormControl key={f.key} f={f} busy={busy} draft={drafts[f.key]}
            hint={f.key in form.amountWords || (f.key === 'amount' && form.amountError)
              ? <>{form.amountWords[f.key] ?? null}{f.key === 'amount' && form.amountError ? <strong style={{ display: 'block' }}>{form.amountError}</strong> : null}</>
              : undefined}
            onDraft={(v) => setDrafts((d) => ({ ...d, [f.key]: v }))}
            onSet={(v) => set([{ key: f.key, value: v }])} />
        ))}
      </PortalGrid>
      {form.caseDetails ? <div style={box} className="body-sm">{form.caseDetails}</div> : null}

      {form.terms ? (
        <PCheck label={form.terms.label} checked={form.terms.checked} disabled={busy || form.otp.shown}
          onChange={(v) => set([{ key: 'i_agree', value: v ? 'Y' : 'N' }])} />
      ) : null}
      {otpButtons.length ? (
        <PortalButtons>
          {otpButtons.map((b) => (
            <PButton key={b.id || b.label} primary disabled={busy || b.disabled}
              onClick={() => sendOtp.mutate(undefined, { onSuccess: (v) => { setForm(v); setOtp(''); } })}>
              {sendOtp.isPending ? 'Sending…' : b.label}
            </PButton>
          ))}
        </PortalButtons>
      ) : null}
      {form.otp.message ? <p className="body-sm" role="status" style={{ textAlign: 'center', margin: 0 }}>{form.otp.message}</p> : null}

      {form.otp.shown ? (
        <PortalSection title={form.otp.label || 'OTP'}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'center' }}>
            <PField label={form.otp.label || 'OTP'} required>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" value={otp} maxLength={10} style={{ width: 160 }}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            </PField>
            {verifyButton ? (
              <PButton primary disabled={busy || otp.length < 4} onClick={() => setConfirming(true)}>{verifyButton.label}</PButton>
            ) : null}
          </div>
        </PortalSection>
      ) : null}

      {gateway || form.redirect ? (
        <PortalSection title="Payment gateway">
          {form.redirect?.text ? <p className="body-sm" style={{ whiteSpace: 'pre-line', margin: 0 }}>{form.redirect.text}</p> : null}
          {gateway ? (
            <div className="col" style={{ gap: 8 }}>
              <p className="body-sm" style={{ margin: 0 }}>
                The portal has prepared this payment. Pay on the bank&rsquo;s page, which opens in a new tab — DifAi does not pay for you.
                Afterwards open {txnButtons[0]?.label ?? 'the transaction list'} and get the GRN.
              </p>
              <PortalButtons>
                <PButton primary onClick={() => openGateway(gateway)}>Open the payment page</PButton>
              </PortalButtons>
              <p className="body-sm muted" style={{ margin: 0, textAlign: 'center' }}>{new URL(gateway.url).host}</p>
            </div>
          ) : null}
        </PortalSection>
      ) : null}

      {confirming ? (
        <PortalModal title="Confirm the payment" level={2} onClose={() => setConfirming(false)}>
          <div className="col" style={{ gap: 12 }}>
            <table className="body-sm" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  [payTypeField?.label || 'Payment Type', shownValue(payTypeField)],
                  [form.caseDetails ? 'Case' : '', form.caseDetails],
                  [payeeField?.label || 'Payee', shownValue(payeeField) || shownValue(otherPayee)],
                  [amountField?.label || 'Amount', `${amountField?.value ?? ''} ${form.amountWords['amount'] ?? ''}`.trim()],
                ].filter(([k, v]) => k && v).map(([k, v]) => (
                  <tr key={k}><td style={{ padding: '4px 12px 4px 0', fontWeight: 700, verticalAlign: 'top' }}>{k}</td><td style={{ padding: 4 }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="body-sm" style={{ margin: 0 }}>
              The portal will check the OTP and create this payment request. You then pay on the bank&rsquo;s page in a new tab. DifAi never pays on its own.
            </p>
            <PortalButtons>
              <PButton onClick={() => setConfirming(false)}>Cancel</PButton>
              <PButton primary disabled={proceed.isPending} onClick={() => proceed.mutate(otp, {
                onSuccess: (r) => { setForm(r.form); setGateway(r.gateway); setConfirming(false); setOtp(''); },
                onError: () => setConfirming(false),
              })}>
                {proceed.isPending ? 'Waiting for the portal…' : 'Confirm and continue'}
              </PButton>
            </PortalButtons>
          </div>
        </PortalModal>
      ) : null}

      {txnsLabel ? <TransactionsWindow sessionId={sessionId} title={txnsLabel} onClose={() => setTxnsLabel(null)} /> : null}
    </div>
  );
}

/** One control of the portal's form, as the portal draws it. */
function FormControl({ f, busy, draft, hint, onDraft, onSet }: {
  f: EpayField; busy: boolean; draft: string | undefined; hint?: React.ReactNode;
  onDraft: (v: string) => void; onSet: (v: string) => void;
}) {
  const locked = busy || f.disabled || f.readOnly;
  if (f.tag === 'radio') {
    return (
      <div style={{ gridColumn: '1 / -1' }}>
        <PRadios label={f.label} required={f.required} name={`epay-${f.key}`} value={f.value || null}
          options={(f.choices ?? []).filter((c) => !c.disabled).map((c) => ({ value: c.value, label: c.label }))}
          onChange={onSet} disabled={locked} />
      </div>
    );
  }
  if (f.type === 'checkbox') {
    return <PCheck label={f.label} checked={f.value === 'Y'} disabled={locked} onChange={(v) => onSet(v ? 'Y' : 'N')} />;
  }
  if (f.tag === 'select') {
    return (
      <PField label={f.label} required={f.required} hint={hint}>
        <select className="input" value={f.value} disabled={locked} onChange={(e) => onSet(e.target.value)}>
          {(f.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>{o.text}</option>)}
        </select>
      </PField>
    );
  }
  const value = draft ?? f.value;
  const commit = () => { if (draft !== undefined && draft !== f.value) onSet(draft); };
  const common = {
    className: 'input', value, disabled: locked, placeholder: f.placeholder || undefined,
    maxLength: f.maxLength ?? undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onDraft(e.target.value),
    onBlur: commit,
  };
  return (
    <PField label={f.label} required={f.required} hint={hint} wide={f.tag === 'textarea'}>
      {f.tag === 'textarea'
        ? <textarea {...common} rows={2} />
        : <input {...common} inputMode={/mobile|amount/i.test(f.key) ? 'decimal' : undefined}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
    </PField>
  );
}

// ---- Transactions (the portal's viewDetails list) ----------------------------------------

function TransactionsWindow({ sessionId, title, onClose }: { sessionId: string; title: string; onClose: () => void }) {
  const list = useEpayTransactions(sessionId, true);
  const action = useEpayTransactionAction(sessionId);
  const [opened, setOpened] = useState<Array<EpayOpened & { local?: string }>>([]);
  useEffect(() => () => { for (const o of opened) if (o.local) URL.revokeObjectURL(o.local); }, [opened]);
  const press = (ref: string, fn: string) => action.mutate({ ref, fn }, {
    onSuccess: (r) => setOpened(r.opened.map((o) => ({ ...o, ...(o.file ? { local: openedFileUrl(o.file) } : {}) }))),
  });
  const busy = list.isFetching || action.isPending;
  const data = action.data?.transactions ?? list.data;
  return (
    <PortalModal title={title} onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { action.reset(); setOpened([]); void list.refetch(); }}>{list.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
        </div>
        {list.isError ? <p className="body-sm">{errMsg(list.error, 'Could not read the transactions on the portal.')}</p> : null}
        {action.isError ? <p className="body-sm" role="alert">{errMsg(action.error, 'The portal did not answer. Try again.')}</p> : null}
        <PortalSays messages={[...(list.data?.messages ?? []), ...(action.data?.messages ?? [])]} />
        {opened.length ? (
          <div style={box} className="col">
            <span className="body-sm" style={{ fontWeight: 700 }}>The portal opened:</span>
            {opened.map((o, i) => (
              <a key={i} className="body-sm" href={o.local ?? o.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>
                {o.file ? o.file.name : new URL(o.url).host + new URL(o.url).pathname} ↗
              </a>
            ))}
          </div>
        ) : null}
        {!data && list.isLoading ? <p className="body-sm muted" style={{ textAlign: 'center' }}>Reading from filing.ecourts.gov.in…</p> : null}
        {data && !data.tables.length ? <p className="body-sm muted">{data.text || 'No transactions on your portal account.'}</p> : null}
        {data?.tables.map((t, ti) => <TxnTable key={ti} headers={t.headers} rows={t.rows} busy={busy} onPress={press} />)}
      </div>
    </PortalModal>
  );
}

function TxnTable({ headers, rows, busy, onPress }: { headers: string[]; rows: EpayTxnRow[]; busy: boolean; onPress: (ref: string, fn: string) => void }) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', fontSize: 14 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {headers.length ? <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700 }}>{h}</th>)}</tr></thead> : null}
        <tbody>
          {rows.map((r, i) => ('group' in r ? (
            <tr key={i}><td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>
          ) : (
            <tr key={r.ref} style={{ background: i % 2 ? undefined : 'var(--bg-surface-2)' }}>
              {r.cells.map((c, j) => (
                <td key={j} style={td}>
                  {c.split('\n').map((line, k) => {
                    const act = r.actions.find((a) => a.label === line);
                    return act ? (
                      <button key={k} type="button" disabled={busy} onClick={() => onPress(r.ref, act.fn)}
                        style={{ display: 'block', margin: '2px auto', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {act.label}
                      </button>
                    ) : <span key={k} style={{ display: 'block' }}>{line}</span>;
                  })}
                </td>
              ))}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Court Fee Wallet --------------------------------------------------------------------

function WalletScreen({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const wallet = useEpayWallet(sessionId, { page, search, refresh });
  const pay = usePayFromWallet(sessionId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const w = pay.data?.wallet.payFees ? { ...wallet.data, payFees: pay.data.wallet.payFees } : wallet.data;
  const pf = w?.payFees ?? null;
  const busy = wallet.isFetching || pay.isPending;
  useEffect(() => { setPicked(new Set()); }, [wallet.data]);

  const toggle = (t: WalletTable, idx: number, on: boolean) => {
    const r = t.rows[idx]!;
    const next = new Set(picked);
    // A group's tick (the establishment) ticks every fee under it, as on the portal.
    const ids: string[] = [];
    if ('group' in r) {
      for (const x of t.rows.slice(idx + 1)) { if ('group' in x) break; if (x.check && !x.check.disabled) ids.push(x.check.id); }
    } else if (r.check) ids.push(r.check.id);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    setPicked(next);
  };
  const feeRows = pf?.tables.flatMap((t) => t.rows.filter((r) => !('group' in r) && r.check && picked.has(r.check.id))) ?? [];

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="body-sm muted">On your account at filing.ecourts.gov.in</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { pay.reset(); void wallet.refetch(); }}>{wallet.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
      </div>
      <PortalTitle>{w?.page?.title || 'Court Fee Wallet'}</PortalTitle>
      {wallet.isError ? <p className="body-sm">{errMsg(wallet.error, 'Could not read the wallet on the portal.')}</p> : null}
      {wallet.isLoading ? <p className="body-sm muted" style={{ textAlign: 'center' }}>Reading from filing.ecourts.gov.in…</p> : null}
      {w ? <PortalSays messages={[...(w.messages ?? []), ...(pay.data?.messages ?? [])]} /> : null}

      {w && !w.page ? <p className="body-sm muted">Your portal menu has no Court Fee Wallet page.</p> : null}
      {w?.page ? (
        <div className="col" style={{ gap: 10 }}>
          {w.page.headings.slice(1).map((h, i) => <h3 key={i} style={{ margin: 0, fontSize: 18 }}>{h}</h3>)}
          {w.page.tables.map((t, i) => <PortalTable key={i} headers={t.headers} rows={t.rows} />)}
          {!w.page.tables.length && w.page.text ? <p className="body-sm">{w.page.text}</p> : null}
        </div>
      ) : null}

      {pf ? (
        <PortalSection title="Pay Fees" note="From the wallet of each establishment">
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" aria-label="Search" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 220 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(draft); setPage(1); } }} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setSearch(draft); setPage(1); }}>Search</button>
            {pf.refreshButton ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>{pf.refreshButton}</button> : null}
          </div>
          {pf.tables.length ? pf.tables.map((t, ti) => (
            <WalletTableView key={ti} t={t} picked={picked} busy={busy} onToggle={(idx, on) => toggle(t, idx, on)} />
          )) : <p className="body-sm muted">{pf.text || 'No fees to pay.'}</p>}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="body-sm">{pf.info}</span>
            {pf.pages.length > 1 ? (
              <span className="row" style={{ gap: 4 }}>
                {pf.pages.map((p) => (
                  <button key={p.page} type="button" disabled={busy} aria-current={p.page === page ? 'page' : undefined} onClick={() => setPage(p.page)}
                    style={{ padding: '4px 10px', border: '1px solid var(--border-default)', borderRadius: 4, cursor: 'pointer', fontWeight: 600, background: p.page === page ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: p.page === page ? 'var(--text-inverse)' : 'inherit' }}>{p.label}</button>
                ))}
              </span>
            ) : null}
          </div>
          {pf.payButton ? (
            <PortalButtons>
              <PButton primary disabled={busy || !picked.size} onClick={() => setConfirming(true)}>{pay.isPending ? 'Paying on the portal…' : pf.payButton.label}</PButton>
            </PortalButtons>
          ) : null}
          {pay.data ? <p className="body-sm" role="status" style={{ textAlign: 'center', margin: 0 }}>{pay.data.paid ? 'The portal took the fees from your wallet.' : 'Nothing was paid.'}</p> : null}
          {pay.isError ? <p className="body-sm" role="alert">{errMsg(pay.error, 'The portal did not answer. Try again.')}</p> : null}
        </PortalSection>
      ) : null}

      {confirming && pf ? (
        <PortalModal title="Pay from the Court Fee Wallet" level={2} onClose={() => setConfirming(false)}>
          <div className="col" style={{ gap: 12 }}>
            <p className="body-sm" style={{ margin: 0 }}>The portal will take these fees from your wallet balance:</p>
            <PortalTable headers={pf.tables[0]?.headers ?? []} rows={feeRows.map((r) => ({ cells: 'cells' in r ? r.cells : [] }))} />
            {pf.balances.map((b) => <p key={b.est} className="body-sm" style={{ margin: 0 }}>{b.label}</p>)}
            <PortalButtons>
              <PButton onClick={() => setConfirming(false)}>Cancel</PButton>
              <PButton primary disabled={pay.isPending} onClick={() => pay.mutate([...picked], { onSettled: () => setConfirming(false) })}>Confirm and pay</PButton>
            </PortalButtons>
          </div>
        </PortalModal>
      ) : null}
    </div>
  );
}

function WalletTableView({ t, picked, busy, onToggle }: { t: WalletTable; picked: Set<string>; busy: boolean; onToggle: (idx: number, on: boolean) => void }) {
  const cols = Math.max(t.headers.length, ...t.rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  const groupOn = (idx: number) => {
    const ids: string[] = [];
    for (const r of t.rows.slice(idx + 1)) { if ('group' in r) break; if (r.check && !r.check.disabled) ids.push(r.check.id); }
    return ids.length > 0 && ids.every((id) => picked.has(id));
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {t.headers.length ? <thead><tr>{t.headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700 }}>{h}</th>)}</tr></thead> : null}
        <tbody>
          {t.rows.map((r, i) => ('group' in r ? (
            <tr key={i}>
              <td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>
                {r.check ? <input type="checkbox" aria-label={r.group} checked={groupOn(i)} disabled={busy || r.check.disabled} onChange={(e) => onToggle(i, e.target.checked)} style={{ marginRight: 8 }} /> : null}
                {r.group}
              </td>
            </tr>
          ) : (
            <tr key={i}>
              {r.cells.map((c, j) => (
                <td key={j} style={td}>
                  {c}
                  {r.check && j === r.cells.length - 1 ? (
                    <input type="checkbox" aria-label={`Pay ${r.cells[1] ?? ''}`} checked={picked.has(r.check.id)} disabled={busy || r.check.disabled} onChange={(e) => onToggle(i, e.target.checked)} />
                  ) : null}
                </td>
              ))}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

