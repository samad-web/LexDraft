import { useEffect, useRef, useState } from 'react';
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
import { PButton, PortalButtons } from '../PortalUi';
import {
  PortalButton,
  PortalFormGrid,
  PortalFormRow,
  PortalInput,
  PortalNotice,
  PortalPage,
  PortalPanel,
  PortalSearchCase,
  PortalSelect,
  PortalTabs,
} from '../PortalForm';
import { errMsg } from '../format';

// =============================================================================
// ePayments, live on the advocate's own portal session (filing.ecourts.gov.in),
// laid out as the portal lays its pages out:
//
//   Payment          "ePayments", "Fields marked with * are required.", the
//                    Search Case box (Search My Cases / New Case | Search
//                    Keyword *), the grey panel: the payment type pills and
//                    View Transaction, Payee Name | Party / Mobile Number |
//                    Amount rows, the Terms and Conditions box, "I agree",
//                    Send OTP, OTP, verify -> the portal prepares the payment
//                    and DifAi opens the bank's page in a new tab for the
//                    advocate to pay there.
//                    Transaction List window (Get GRN, bank CIN, verification,
//                    challan) as the portal's DataTables list.
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

/**
 * The page's own heading. A browser title ("eFiling Services | epay: Pay case
 * fee") is not one: the portal's heading for its ePayments pages is the menu's
 * name.
 */
const pageHeading = (title: string | undefined, fallback: string) => (!title || /\|/.test(title) ? fallback : title);

// The portal's chosen widgets carry their own search box (<select id>_input_search).
const SEARCH_SUFFIX = '_input_search';

/** Amount ( ₹ Indian Rupees): the portal draws the rupee sign as an icon. */
const withRupee = (label: string) => label.replace(/\(\s*Indian Rupees\s*\)/i, '( ₹ Indian Rupees)');

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
      <PortalPage title="ePayments" required={null}>
        {open.isError
          ? <><p className="body-sm">{errMsg(open.error, 'Could not open Payment on the portal.')}</p><PortalButtons><PButton onClick={reload}>Try again</PButton></PortalButtons></>
          : <p className="body-sm muted" style={{ textAlign: 'center' }}>Opening ePayments &gt; Payment on filing.ecourts.gov.in…</p>}
      </PortalPage>
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

  // The portal's layout: the case source radios and their case picker in the
  // Search Case box; the payment type pills on the panel; every other control
  // in label | field rows, two to a row, in the portal's order.
  const searchOf = (f: EpayField) => form.fields.find((x) => x.key === `${f.key}${SEARCH_SUFFIX}`);
  const fields = form.fields.filter((f) => !f.key.endsWith(SEARCH_SUFFIX) || !form.fields.some((x) => `${x.key}${SEARCH_SUFFIX}` === f.key));
  const casesField = fields.find((f) => f.key === 'cases' && f.tag === 'radio');
  const casesAt = casesField ? fields.indexOf(casesField) : -1;
  const pickerField = casesField ? fields.slice(casesAt + 1).find((f) => f.tag !== 'radio') : undefined;
  const pickerIsNext = !!pickerField && fields[casesAt + 1] === pickerField;
  const rowFields = fields.filter((f) => f !== casesField && f !== payTypeField && !(pickerIsNext && f === pickerField));
  const hintFor = (f: EpayField) => (f.key in form.amountWords || (f.key === 'amount' && form.amountError)
    ? <>{form.amountWords[f.key] ?? null}{f.key === 'amount' && form.amountError ? <strong style={{ display: 'block' }}>{form.amountError}</strong> : null}</>
    : undefined);
  const control = (f: EpayField) => (
    <FormControl f={f} search={searchOf(f)} busy={busy} draft={drafts[f.key]} hint={hintFor(f)}
      onDraft={(v) => setDrafts((d) => ({ ...d, [f.key]: v }))}
      onSet={(v) => set([{ key: f.key, value: v }])}
      onSearch={(key, v) => set([{ key, value: v }])} />
  );

  return (
    <PortalPage title={pageHeading(form.title, 'ePayments')}>
      {error ? <p className="body-sm" role="alert" style={{ margin: 0 }}>{errMsg(error.error, 'The portal did not answer. Try again.')}</p> : null}
      <PortalSays messages={form.messages} />

      <div className="col" style={{ gap: 10, padding: '0 2%' }}>
        {casesField ? (
          <PortalSearchCase
            label={casesField.label || 'Search Case'}
            choices={(casesField.choices ?? []).filter((c) => !c.disabled).map((c) => (
              <label key={c.value} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 14, cursor: busy ? 'default' : 'pointer' }}>
                <input type="radio" name="epay-cases" checked={casesField.value === c.value} disabled={busy || casesField.disabled}
                  onChange={() => set([{ key: casesField.key, value: c.value }])} />
                {c.label}
              </label>
            ))}
            pickerLabel={pickerIsNext ? pickerField!.label : ''}
            required={pickerIsNext ? pickerField!.required : false}
            picker={pickerIsNext ? control(pickerField!) : null} />
        ) : null}

        <PortalPanel padding={0}>
          {payTypeField || txnButtons.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border-default)' }}>
              <div className="row" role="radiogroup" aria-label={payTypeField?.label || 'Payment Type'} style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {(payTypeField?.choices ?? []).filter((c) => !c.disabled).map((c) => (
                  <PayTypePill key={c.value} label={c.label} checked={payTypeField!.value === c.value} disabled={busy || payTypeField!.disabled}
                    onPick={() => set([{ key: payTypeField!.key, value: c.value }])} />
                ))}
              </div>
              <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {txnButtons.map((b) => (
                  <PortalButton key={b.id || b.label} icon={<ListIcon />} disabled={busy || b.disabled} onClick={() => setTxnsLabel(b.label)}>{b.label}</PortalButton>
                ))}
              </div>
            </div>
          ) : null}

          <div className="col" style={{ gap: 6, padding: '10px 0 14px' }}>
            {form.caseDetails ? <FieldColumn><div style={box} className="body-sm">{form.caseDetails}</div></FieldColumn> : null}

            <PortalFormGrid>
              {rowFields.map((f) => (f.type === 'checkbox' ? (
                <PortalFormRow key={f.key} label="" labelAlign="left" wide={false}>
                  <label className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 700, fontSize: 14 }}>
                    <input type="checkbox" checked={f.value === 'Y'} disabled={busy || f.disabled || f.readOnly} onChange={(e) => set([{ key: f.key, value: e.target.checked ? 'Y' : 'N' }])} />
                    {f.label}
                  </label>
                </PortalFormRow>
              ) : (
                <PortalFormRow key={f.key} label={withRupee(f.label)} required={f.required} labelAlign="left" wide={f.tag === 'textarea'}>
                  {control(f)}
                </PortalFormRow>
              )))}
            </PortalFormGrid>

            {form.terms ? (
              <FieldColumn>
                {form.terms.text ? (
                  <PortalNotice title={form.terms.title || 'Terms and Conditions'}>
                    <span style={{ whiteSpace: 'pre-line' }}>{form.terms.text}</span>
                  </PortalNotice>
                ) : null}
                <label className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 700, fontSize: 14, marginTop: 6, cursor: busy || form.otp.shown ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={form.terms.checked} disabled={busy || form.otp.shown}
                    onChange={(e) => set([{ key: 'i_agree', value: e.target.checked ? 'Y' : 'N' }])} />
                  {form.terms.label}
                </label>
              </FieldColumn>
            ) : null}

            {otpButtons.length ? (
              <FieldColumn>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  {otpButtons.map((b) => (
                    <PortalButton key={b.id || b.label} disabled={busy || b.disabled}
                      onClick={() => sendOtp.mutate(undefined, { onSuccess: (v) => { setForm(v); setOtp(''); } })}>
                      {sendOtp.isPending ? 'Sending…' : b.label}
                    </PortalButton>
                  ))}
                </div>
              </FieldColumn>
            ) : null}
            {form.otp.message ? <FieldColumn><p className="body-sm" role="status" style={{ margin: 0, fontWeight: 700 }}>{form.otp.message}</p></FieldColumn> : null}

            {form.otp.shown ? (
              <PortalFormGrid>
                <PortalFormRow label={form.otp.label || 'Enter OTP'} required labelAlign="left">
                  <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <PortalInput aria-label={form.otp.label || 'Enter OTP'} inputMode="numeric" autoComplete="one-time-code" value={otp} maxLength={10} style={{ width: 160 }}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                    {verifyButton ? (
                      <PortalButton disabled={busy || otp.length < 4} onClick={() => setConfirming(true)}>{verifyButton.label}</PortalButton>
                    ) : null}
                  </span>
                </PortalFormRow>
              </PortalFormGrid>
            ) : null}

            {gateway || form.redirect ? (
              <FieldColumn>
                <div className="col" style={{ ...box, gap: 8 }}>
                  {form.redirect?.text ? <p className="body-sm" style={{ whiteSpace: 'pre-line', margin: 0 }}>{form.redirect.text}</p> : null}
                  {gateway ? (
                    <>
                      <p className="body-sm" style={{ margin: 0 }}>
                        The portal has prepared this payment. Pay on the bank&rsquo;s page, which opens in a new tab — DifAi does not pay for you.
                        Afterwards open {txnButtons[0]?.label ?? 'the transaction list'} and get the GRN.
                      </p>
                      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <PortalButton onClick={() => openGateway(gateway)}>Open the payment page</PortalButton>
                        <span className="body-sm muted">{new URL(gateway.url).host}</span>
                        <PortalButton outline disabled={busy} onClick={reload}>New payment</PortalButton>
                      </div>
                    </>
                  ) : null}
                </div>
              </FieldColumn>
            ) : null}
          </div>
        </PortalPanel>
      </div>

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

      {txnsLabel ? <TransactionsWindow sessionId={sessionId} onClose={() => setTxnsLabel(null)} /> : null}
    </PortalPage>
  );
}

/**
 * Content set under the field column of the panel's label | field rows (the
 * portal indents its Terms and Conditions, "I agree" and OTP buttons there).
 * Same proportions as PortalFormGrid's two PortalFormRows.
 */
function FieldColumn({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 0.9fr) 18px 1.3fr 24px minmax(140px, 0.9fr) 18px 1.3fr', padding: '0 12px' }}>
      <div style={{ gridColumn: '3 / 8', minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** The portal's payment type pill: "◉ Court Fee". */
function PayTypePill({ label, checked, disabled, onPick }: { label: string; checked: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 22, fontWeight: 700, fontSize: 14,
      cursor: disabled ? 'default' : 'pointer', border: '1px solid var(--bg-inverse)',
      background: checked ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: checked ? 'var(--text-inverse)' : 'var(--text-primary)',
      boxShadow: '0 2px 3px rgba(0,0,0,0.25)',
    }}>
      <input type="radio" name="epay-epayOptions" checked={checked} disabled={disabled} onChange={onPick} style={{ margin: 0 }} />
      {label}
    </label>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="0" y="2" width="3" height="2.4" rx="0.6" /><rect x="5" y="2.3" width="11" height="1.8" rx="0.6" />
      <rect x="0" y="6.8" width="3" height="2.4" rx="0.6" /><rect x="5" y="7.1" width="11" height="1.8" rx="0.6" />
      <rect x="0" y="11.6" width="3" height="2.4" rx="0.6" /><rect x="5" y="11.9" width="11" height="1.8" rx="0.6" />
    </svg>
  );
}

/** One control of the portal's form, as the portal draws it. */
function FormControl({ f, search, busy, draft, hint, onDraft, onSet, onSearch }: {
  f: EpayField; search?: EpayField; busy: boolean; draft: string | undefined; hint?: React.ReactNode;
  onDraft: (v: string) => void; onSet: (v: string) => void; onSearch: (key: string, v: string) => void;
}) {
  const locked = busy || f.disabled || f.readOnly;
  const withHint = (el: React.ReactNode) => (hint ? <>{el}<span className="body-sm" style={{ display: 'block', marginTop: 4 }}>{hint}</span></> : el);
  if (f.tag === 'radio') {
    return (
      <span className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(f.choices ?? []).filter((c) => !c.disabled).map((c) => (
          <label key={c.value} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input type="radio" name={`epay-${f.key}`} checked={f.value === c.value} disabled={locked} onChange={() => onSet(c.value)} />
            {c.label}
          </label>
        ))}
      </span>
    );
  }
  if (f.tag === 'select') {
    if (search && !search.readOnly && !search.disabled) {
      return withHint(<ChosenSelect f={f} search={search} busy={busy} onSet={onSet} onSearch={(v) => onSearch(search.key, v)} />);
    }
    const opts = f.options ?? [];
    return withHint(
      <PortalSelect aria-label={f.label} value={f.value} disabled={locked} onChange={(e) => onSet(e.target.value)}>
        {opts.length ? opts.map((o, i) => <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>{o.text}</option>)
          : <option value="">Select an Option</option>}
      </PortalSelect>,
    );
  }
  const value = draft ?? f.value;
  const commit = () => { if (draft !== undefined && draft !== f.value) onSet(draft); };
  const look: React.CSSProperties = locked ? { background: 'var(--bg-surface-2)', borderColor: 'var(--border-default)' } : {};
  if (f.tag === 'textarea') {
    return withHint(
      <textarea aria-label={f.label} value={value} disabled={locked} placeholder={f.placeholder || undefined} maxLength={f.maxLength ?? undefined} rows={2}
        onChange={(e) => onDraft(e.target.value)} onBlur={commit}
        style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--text-primary)', borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)', resize: 'vertical', ...look }} />,
    );
  }
  return withHint(
    <PortalInput aria-label={f.label} value={value} disabled={locked} placeholder={f.placeholder || undefined} maxLength={f.maxLength ?? undefined}
      inputMode={/mobile|amount/i.test(f.key) ? 'decimal' : undefined}
      onChange={(e) => onDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={look} />,
  );
}

/**
 * The portal's chosen dropdown: the picked option (or "Select"), opening to its
 * own search box and the options; what is typed there goes to the portal's
 * search box, whose results become the options.
 */
function ChosenSelect({ f, search, busy, onSet, onSearch }: {
  f: EpayField; search: EpayField; busy: boolean; onSet: (v: string) => void; onSearch: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(search.value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const opts = f.options ?? [];
  const picked = opts.find((o) => o.value === f.value)?.text ?? opts[0]?.text ?? 'Select an Option';
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={f.label} disabled={busy || f.disabled} onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 14, border: '1px solid var(--text-primary)', borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{picked}</span>
        <span aria-hidden style={{ fontSize: 10 }}>▼</span>
      </button>
      {open ? (
        <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 33, background: 'var(--bg-surface)', border: '1px solid var(--text-primary)', borderRadius: 3, padding: 6, boxShadow: '0 4px 10px rgba(0,0,0,0.2)' }}>
          <PortalInput autoFocus aria-label={search.label || 'Search'} placeholder={search.placeholder || undefined} value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(q); } }} onBlur={() => { if (q !== search.value) onSearch(q); }} />
          <ul role="listbox" aria-label={f.label} style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 220, overflowY: 'auto', fontSize: 14 }}>
            {opts.filter((o) => o.value).map((o, i) => (
              <li key={`${o.value}-${i}`} role="option" aria-selected={o.value === f.value} aria-disabled={o.disabled}
                onClick={() => { if (!o.disabled) { onSet(o.value); setOpen(false); } }}
                style={{ padding: '5px 8px', cursor: o.disabled ? 'default' : 'pointer', opacity: o.disabled ? 0.5 : 1, background: o.value === f.value ? 'var(--bg-inverse)' : undefined, color: o.value === f.value ? 'var(--text-inverse)' : undefined }}>
                {o.text}
              </li>
            ))}
            {!opts.some((o) => o.value) ? <li className="muted" style={{ padding: '5px 8px' }}>{q ? `No results match "${q}"` : 'Type to search'}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---- Transactions (the portal's viewDetails list, in its "Transaction List" window) ----------

function TransactionsWindow({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
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
    <PortalModal title={data?.title || 'Transaction List'} onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
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
        {data && !data.tables.length ? <p className="body-sm muted">{data.text || 'No data available in table'}</p> : null}
        {data?.tables.map((t, ti) => <TxnList key={ti} headers={t.headers} rows={t.rows} busy={busy} onPress={press} />)}
      </div>
    </PortalModal>
  );
}

/** The portal's DataTables list: Show [All] entries | Search:, the table, Showing a to b of n entries | Previous · pages · Next. */
function TxnList({ headers, rows, busy, onPress }: { headers: string[]; rows: EpayTxnRow[]; busy: boolean; onPress: (ref: string, fn: string) => void }) {
  const [size, setSize] = useState(-1);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const q = query.trim().toLowerCase();
  const data = rows.filter((r) => !q || ('group' in r ? r.group : r.cells.join(' ')).toLowerCase().includes(q));
  const count = data.filter((r) => !('group' in r)).length;
  const per = size > 0 ? size : Math.max(1, data.length);
  const pages = Math.max(1, Math.ceil(data.length / per));
  const p = Math.min(page, pages - 1);
  const shown = data.slice(p * per, p * per + per);
  const shownCount = shown.filter((r) => !('group' in r)).length;
  const before = data.slice(0, p * per).filter((r) => !('group' in r)).length;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontWeight: 700, fontSize: 14 }}>
          Show{' '}
          <PortalSelect value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} style={{ width: 100, height: 36, display: 'inline-block' }}>
            {[[-1, 'All'], [10, '10'], [25, '25'], [50, '50'], [100, '100']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </PortalSelect>{' '}entries
        </label>
        <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 14 }}>
          Search:
          <PortalInput value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} style={{ width: 200, background: 'var(--bg-surface-2)', borderColor: 'var(--border-default)' }} />
        </label>
      </div>
      {count ? <TxnTable headers={headers} rows={shown} busy={busy} onPress={onPress} />
        : <p className="body-sm muted" style={{ textAlign: 'center' }}>{q ? 'No matching records found' : 'No data available in table'}</p>}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14 }}>{count ? `Showing ${before + 1} to ${before + shownCount} of ${count} entries` : 'Showing 0 to 0 of 0 entries'}</span>
        <span className="row" style={{ gap: 4, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={p === 0} onClick={() => setPage(p - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, i) => i).filter((i) => Math.abs(i - p) < 3).map((i) => (
            <button key={i} type="button" aria-current={i === p ? 'page' : undefined} onClick={() => setPage(i)}
              style={{ padding: '6px 12px', border: '1px solid var(--border-default)', borderRadius: 3, cursor: 'pointer', fontWeight: 600, background: i === p ? 'var(--bg-surface-2)' : 'transparent', color: 'inherit' }}>{i + 1}</button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}

function TxnTable({ headers, rows, busy, onPress }: { headers: string[]; rows: EpayTxnRow[]; busy: boolean; onPress: (ref: string, fn: string) => void }) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '8px 6px', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'left', fontSize: 14 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {headers.length ? <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...td, textAlign: 'center', verticalAlign: 'middle', borderRight: '1px solid var(--border-default)', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 15 }}>{h}</th>)}</tr></thead> : null}
        <tbody>
          {rows.map((r, i) => ('group' in r ? (
            <tr key={i}><td colSpan={cols} style={{ ...td, fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>
          ) : (
            <tr key={r.ref}>
              {r.cells.map((c, j) => (
                <td key={j} style={{ ...td, borderRight: '1px solid var(--border-default)' }}>
                  {c.split('\n').map((line, k) => {
                    const act = r.actions.find((a) => a.label === line);
                    return act ? (
                      <button key={k} type="button" disabled={busy} onClick={() => onPress(r.ref, act.fn)}
                        style={{ display: 'block', margin: '2px 0', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
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

// The portal's text-size bar (A- A A+ A A) read along with a page: not page content.
const FONT_BAR = /^(A[-+]?\s*){3,6}$/;

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
  const docTitle = w?.page?.title ?? '';
  const title = w?.page?.headings[0] || (/\|/.test(docTitle) ? docTitle.split(/[:|]/).pop()!.trim() : docTitle) || 'Court Fee Wallet';
  const pageText = (w?.page?.text ?? '').trim();
  const doSearch = () => { if (draft !== search) { setSearch(draft); setPage(1); } };

  return (
    <PortalPage title={title} required={null}>
      {wallet.isError ? <p className="body-sm">{errMsg(wallet.error, 'Could not read the wallet on the portal.')}</p> : null}
      {wallet.isLoading ? <p className="body-sm muted" style={{ textAlign: 'center' }}>Reading from filing.ecourts.gov.in…</p> : null}
      {w ? <PortalSays messages={[...(w.messages ?? []), ...(pay.data?.messages ?? [])]} /> : null}

      {w && !w.page ? <p className="body-sm muted">Your portal menu has no Court Fee Wallet page.</p> : null}
      {w?.page ? (
        <div className="col" style={{ gap: 10 }}>
          {w.page.headings.slice(1).map((h, i) => <h3 key={i} style={{ margin: 0, fontSize: 18 }}>{h}</h3>)}
          {w.page.tables.map((t, i) => <PortalTable key={i} headers={t.headers} rows={t.rows} />)}
          {!w.page.tables.length && pageText && !FONT_BAR.test(pageText) ? <p className="body-sm" style={{ margin: 0 }}>{pageText}</p> : null}
        </div>
      ) : null}

      {pf ? (
        <div className="col" style={{ gap: 0 }}>
          <PortalTabs bold tabs={[{ key: 'fees', label: 'Pay Fees', icon: '₹' }] as const} active="fees" onPick={() => {}} />
          <div className="col" style={{ gap: 12, border: '1px solid var(--border-default)', borderTop: 'none', padding: 14 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 14 }}>
                Search:
                <PortalInput value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={doSearch} disabled={busy} style={{ width: 220 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} />
              </label>
              {pf.refreshButton ? <PortalButton disabled={busy} onClick={() => setRefresh((n) => n + 1)}>{pf.refreshButton}</PortalButton> : null}
            </div>
            {pf.tables.length ? pf.tables.map((t, ti) => (
              <WalletTableView key={ti} t={t} picked={picked} busy={busy} onToggle={(idx, on) => toggle(t, idx, on)} />
            )) : <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{pf.text || 'No data available in table'}</p>}
            {pf.info || pf.pages.length > 1 ? (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14 }}>{pf.info}</span>
                {pf.pages.length > 1 ? (
                  <span className="row" style={{ gap: 4 }}>
                    {pf.pages.map((p) => (
                      <button key={p.page} type="button" disabled={busy} aria-current={p.page === page ? 'page' : undefined} onClick={() => setPage(p.page)}
                        style={{ padding: '4px 10px', border: '1px solid var(--border-default)', borderRadius: 4, cursor: 'pointer', fontWeight: 600, background: p.page === page ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: p.page === page ? 'var(--text-inverse)' : 'inherit' }}>{p.label}</button>
                    ))}
                  </span>
                ) : null}
              </div>
            ) : null}
            {pf.payButton ? (
              <div className="row" style={{ justifyContent: 'center' }}>
                <PortalButton disabled={busy || !picked.size} onClick={() => setConfirming(true)}>{pay.isPending ? 'Paying on the portal…' : pf.payButton.label}</PortalButton>
              </div>
            ) : null}
            {pay.data ? <p className="body-sm" role="status" style={{ textAlign: 'center', margin: 0 }}>{pay.data.paid ? 'The portal took the fees from your wallet.' : 'Nothing was paid.'}</p> : null}
            {pay.isError ? <p className="body-sm" role="alert">{errMsg(pay.error, 'The portal did not answer. Try again.')}</p> : null}
          </div>
        </div>
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
    </PortalPage>
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
