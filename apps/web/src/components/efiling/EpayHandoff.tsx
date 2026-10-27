import { useEffect, useRef, useState } from 'react';
import { useCase } from '@/hooks/useCases';
import { useFilingParticulars, type FilingDetail as FilingDetailDto } from '@/hooks/useEfiling';
import { EPAY_FILL_BOOKMARKLET, epayPartyName, epayUrl, type EpayHandoff as Handoff } from '@/lib/epayFill';
import { numOrNull } from './format';

const MOBILE_KEY = 'lexdraft.epay.mobile';
const CNR_RE = /^[A-Z]{4}[0-9A-Z]{2}\d{10}$/;

function readMobile(): string {
  try { return localStorage.getItem(MOBILE_KEY) ?? ''; } catch { return ''; }
}

/**
 * Opens ePay with this filing's court, case and amount, ready for the
 * "DifAI Fill" bookmark to fill the Court Fee form. See lib/epayFill.ts.
 */
export function EpayHandoff({ f, amount }: { f: FilingDetailDto; amount: string }) {
  const { data } = useFilingParticulars(f.caseId);
  const [mobile, setMobile] = useState(readMobile);
  const [showSetup, setShowSetup] = useState(false);
  const bookmarkRef = useRef<HTMLAnchorElement>(null);

  // React warns on javascript: hrefs, so the bookmarklet is set directly.
  useEffect(() => {
    bookmarkRef.current?.setAttribute('href', EPAY_FILL_BOOKMARKLET);
  }, [showSetup]);

  const { data: matter } = useCase(f.caseId);
  // A new case has no CNR until it is registered. Fees on an existing case (IA,
  // deficit court fee) go against the matter's CNR, as long as it is a real one.
  const matterCnr = f.kind !== 'new_case' && f.kind !== 'caveat' && CNR_RE.test(matter?.cnr ?? '') ? matter!.cnr : null;
  const cnr = f.cnr ?? matterCnr;
  const p = data?.particulars ?? null;
  const parties = data?.parties ?? [];
  const payer = parties.find((x) => x.isClient) ?? parties.find((x) => x.side === 'petitioner') ?? null;
  const fallbackMobile = payer?.mobile ?? '';
  const mobileToUse = (mobile || fallbackMobile).replace(/\D/g, '').slice(-10);

  const handoff: Handoff = {
    v: 1,
    court: p?.courtTier ?? 'DC',
    state: p?.stateCode ?? null,
    district: p?.districtCode ?? null,
    est: p?.estCode ?? null,
    cnr,
    party: epayPartyName(payer?.name),
    amount: numOrNull(amount),
    mobile: mobileToUse || null,
    remark: f.title.replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || null,
  };

  const missing = [
    !cnr && !p?.stateCode ? 'court (fill Initial Inputs)' : null,
    !cnr && !p?.estCode ? 'establishment' : null,
    !cnr && !handoff.party ? 'party name' : null,
    handoff.amount == null ? 'amount (type it below)' : null,
    !handoff.mobile ? 'mobile for the OTP' : null,
  ].filter(Boolean);

  const onMobile = (v: string) => {
    setMobile(v);
    try { localStorage.setItem(MOBILE_KEY, v); } catch { /* private window */ }
  };

  return (
    <div className="col" style={{ gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">ePay OTP mobile</span>
          <input className="input" style={{ width: 150 }} inputMode="numeric" value={mobile} placeholder={fallbackMobile || '10 digits'}
            onChange={(e) => onMobile(e.target.value)} />
        </label>
        <a className="btn btn-primary btn-sm" href={epayUrl(handoff)} target="_blank" rel="noopener noreferrer">
          Open ePay with this case ↗
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSetup((s) => !s)}>
          {showSetup ? 'Hide setup' : 'First time? Set up one-click fill'}
        </button>
      </div>
      <p className="body-sm muted">
        {cnr
          ? <>Existing case: ePay will get CNR <strong>{cnr}</strong>{handoff.amount != null ? <>, ₹{handoff.amount}</> : null}.</>
          : <>New case: ePay will get {p?.establishmentName ?? 'the establishment'}{handoff.party ? <>, party {handoff.party}</> : null}{handoff.amount != null ? <>, ₹{handoff.amount}</> : null}.</>}
        {' '}On the ePay page click <strong>DifAI Fill</strong> in your bookmarks bar. Then tick “I agree”, get the OTP and pay there.
      </p>
      {missing.length ? <p className="body-sm" style={{ color: 'var(--warning, #b45309)' }}>Not filled yet: {missing.join(', ')}.</p> : null}
      {showSetup ? (
        <ol className="body-sm" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Show the bookmarks bar: <strong>Ctrl + Shift + B</strong>.</li>
          <li>
            Drag this button onto the bookmarks bar:{' '}
            <a ref={bookmarkRef} className="btn btn-ghost btn-sm" onClick={(e) => e.preventDefault()} title="Drag me to the bookmarks bar">
              DifAI Fill
            </a>
          </li>
          <li>That’s all. It only reads the case DifAI put in the ePay page address and never pays or sends an OTP.</li>
        </ol>
      ) : null}
    </div>
  );
}
