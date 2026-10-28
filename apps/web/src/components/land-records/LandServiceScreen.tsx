import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useEndLandSession,
  useLandSubdivisions,
  useRefreshLandCaptcha,
  useSelectLandField,
  useSendLandOtp,
  useStartLandSession,
  useSubmitLandCaptcha,
  useVerifyLandOtp,
  type LandFormFields,
  type LandFormShape,
  type LandListField,
  type LandOption,
  type LandResult,
  type LandService,
  type LandSessionStart,
} from '@/hooks/useLandRecords';
import { LField, LRow, LandFetching, LandOpening, LandTitleBar, Loadable, Spinner, SurveyHints, errorText, landMeta } from './LandUi';
import { LandResultPanel } from './LandResultPanel';

// One Land Records service, laid out like its page on eservices.tn.gov.in.
// Every dropdown is the site's own list, loaded live in this session; the
// gate is the OTP the site texts to the mobile number entered here, or the
// captcha it shows. See apps/api/src/services/tn-land-records.service.ts.

const MOBILE_KEY = 'lexdraft.landRecords.mobile';
const APP_ID_RE = /^[0-9]{4}\/[A-Z0-9][0-9]{3}\/[0-9]{2}\/[0-9]{6}$/;
/** Land Records keeps an OTP valid for 2 minutes (its own countdown). */
const OTP_VALID_SEC = 120;
const SURVEY_RE =/^[1-9][0-9A-Za-z/-]{0,5}$/;

type Lists = Partial<Record<LandListField, LandOption[]>>;
type Picks = Partial<Record<LandListField, string>>;

// Each service's form shape is fixed, so the form draws at once while the
// site's page opens; the session then supplies the live lists.
const FORM_OF: Record<LandService, LandFormShape> = {
  'patta': 'rural', 'a-register': 'rural', 'fmb': 'rural', 'poramboke': 'rural-plain',
  'tslr-extract': 'urban', 'tslr-sketch': 'urban', 'verify-patta': 'refno',
  'order-copy': 'appid', 'app-status': 'appid', 'fline': 'appid',
};

const URBAN_ORDER: LandListField[] = ['district', 'taluk', 'village', 'ward', 'block', 'survey', 'subdiv'];
const RURAL_ORDER: LandListField[] = ['district', 'taluk', 'village'];

function readMobile(): string {
  try { return localStorage.getItem(MOBILE_KEY) ?? ''; } catch { return ''; }
}
function saveMobile(v: string): void {
  try { localStorage.setItem(MOBILE_KEY, v); } catch { /* private mode */ }
}

export function LandServiceScreen({ service, onHome, initialApplicationId, onFollow }: {
  service: LandService;
  onHome: () => void;
  /** Prefill (e.g. "Check status" from a followed application). */
  initialApplicationId?: string;
  /** Application Status / F-Line: follow the searched Application Id. */
  onFollow?: (applicationId: string) => void;
}) {
  const meta = landMeta(service);
  const start = useStartLandSession();
  const end = useEndLandSession();
  const select = useSelectLandField();
  const subdivs = useLandSubdivisions();
  const sendOtp = useSendLandOtp();
  const verifyOtp = useVerifyLandOtp();
  const submitCaptcha = useSubmitLandCaptcha();
  const refreshCaptcha = useRefreshLandCaptcha();

  const [session, setSession] = useState<LandSessionStart | null>(null);
  const [lists, setLists] = useState<Lists>({});
  const [picks, setPicks] = useState<Picks>({});
  const [askLandType, setAskLandType] = useState(false);
  const [landType, setLandType] = useState<'R' | 'N' | ''>('');
  const [viewBy, setViewBy] = useState<'pt' | 'sur'>('sur');
  const [pattaNo, setPattaNo] = useState('');
  const [surveyNo, setSurveyNo] = useState('');
  const [subdivText, setSubdivText] = useState('');
  const [applicationId, setApplicationId] = useState(initialApplicationId ?? '');
  const [refNo, setRefNo] = useState('');
  const [mobile, setMobile] = useState(readMobile);
  const [otpSent, setOtpSent] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [result, setResult] = useState<LandResult | null>(null);
  const sessionRef = useRef<string | null>(null);
  const loadedSurvey = useRef<string | null>(null);
  const captchaInput = useRef<HTMLInputElement | null>(null);
  const verifying = useRef(false);
  /** Order Copy / Verify Patta: OTP confirmed, the site now wants its captcha. */
  const [otpCaptcha, setOtpCaptcha] = useState(false);
  /** When the current OTP was sent (ms) - drives the 2-minute countdown. */
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!otpSentAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [otpSentAt]);
  const otpLeft = otpSentAt ? Math.max(0, OTP_VALID_SEC - Math.floor((now - otpSentAt) / 1000)) : 0;
  // Put the cursor in the captcha box whenever a (new) captcha arrives.
  useEffect(() => { if (captchaImg) captchaInput.current?.focus(); }, [captchaImg]);

  /** Bumped on every open and on leave: an answer for an older open is stale. */
  const attempt = useRef(0);

  const open = (): void => {
    setSession(null); setLists({}); setPicks({}); setAskLandType(false); setLandType('');
    setSurveyNo(''); setSubdivText(''); setOtpSent(null); setOtp(''); setCaptcha(''); setResult(null);
    setCaptchaImg(null); setMessage(null); setExpired(false); setOtpCaptcha(false); setOtpSentAt(null);
    const mine = ++attempt.current;
    start.mutateAsync(service).then(
      (s) => {
        // Left the screen (or reopened) meanwhile: close the session it made.
        if (mine !== attempt.current) { end.mutate(s.sessionId); return; }
        sessionRef.current = s.sessionId;
        setSession(s);
        setLists({ district: s.districts });
        setCaptchaImg(s.captchaImage ?? null);
      },
      (err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // 409 = replaced by a newer open of ours - nothing to tell the advocate.
        if (mine !== attempt.current || status === 409) return;
        setMessage(errorText(err, 'Could not reach Land Records.'));
      },
    );
  };

  // Open the site's page for this service; close the browser on leave.
  useEffect(() => {
    // Deferred a tick so a mount that is torn down at once (React StrictMode
    // in dev, or a quick back-and-forth) never sends a second open - each
    // extra open used up the page the server had ready.
    const timer = setTimeout(open, 0);
    return () => {
      clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a plain counter, meant to be the live value
      attempt.current++;
      if (sessionRef.current) end.mutate(sessionRef.current);
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per service
  }, [service]);

  const fail = (err: unknown, fallback: string): void => {
    const res = (err as { response?: { status?: number; data?: { code?: string } } })?.response;
    // Another step for this search is still running - its own answer follows.
    if (res?.data?.code === 'BUSY') return;
    if (res?.status === 404) setExpired(true);
    // The site refused the OTP (or reset its form): start the OTP step over.
    if (res?.data?.code === 'OTP_REJECTED') {
      setOtpSent(null); setOtp(''); setOtpSentAt(null); setOtpCaptcha(false); setCaptchaImg(null);
    }
    setMessage(errorText(err, fallback));
  };

  const form = session?.form ?? FORM_OF[service];
  const gate = session?.gate ?? meta.gate;
  const order = form === 'urban' ? URBAN_ORDER : RURAL_ORDER;

  const pick = (field: LandListField, value: string): void => {
    if (!session) return;
    // Clear everything after this field, as the site does.
    const after = order.slice(order.indexOf(field) + 1);
    setPicks((p) => {
      const next: Picks = { ...p, [field]: value };
      for (const f of after) delete next[f];
      if (form !== 'urban') delete next.subdiv;
      return next;
    });
    setLists((l) => {
      const next: Lists = { ...l };
      for (const f of after) delete next[f];
      // Rural: the typed survey number's sub divisions belong to the old village.
      if (form !== 'urban') delete next.subdiv;
      return next;
    });
    if (field === 'taluk' || field === 'district') { setAskLandType(false); setLandType(''); }
    if (form !== 'urban') setSurveyNo('');
    setOtpSent(null);
    setMessage(null);
    if (!value) return;
    select.mutate(
      { sessionId: session.sessionId, field, value },
      {
        onSuccess: (r) => {
          if (r.next) setLists((l) => ({ ...l, [r.next!]: r.options }));
          if (r.askLandType !== undefined) setAskLandType(r.askLandType);
          if (r.next && r.options.length === 0) setMessage(r.message ?? 'Land Records lists nothing for this selection.');
          else if (r.message) setMessage(r.message);
        },
        onError: (err) => fail(err, 'Land Records did not load the next list.'),
      },
    );
  };

  /** Rural: survey number typed -> the site's sub divisions. */
  const loadSubdivs = (): void => {
    if (!session || form !== 'rural' || !SURVEY_RE.test(surveyNo.trim())) return;
    if (askLandType && !landType) { setMessage('Please select landtype option'); return; }
    // Enter and then blur both land here - don't reload (and clear the pick) for the same number.
    const key = `${picks.village}|${landType}|${surveyNo.trim()}`;
    if (loadedSurvey.current === key && lists.subdiv) return;
    loadedSurvey.current = key;
    setPicks((p) => ({ ...p, subdiv: '' }));
    subdivs.mutate(
      { sessionId: session.sessionId, surveyNo: surveyNo.trim(), landType: landType || undefined },
      {
        onSuccess: (r) => {
          setLists((l) => ({ ...l, subdiv: r.options }));
          setMessage(r.options.length === 0 ? (r.message ?? 'No sub divisions for this Survey Number.') : r.message ?? null);
        },
        onError: (err) => { loadedSurvey.current = null; fail(err, 'Land Records did not load the sub divisions.'); },
      },
    );
  };

  const fields = (): LandFormFields => {
    const f: LandFormFields = {};
    if (form === 'appid') f.applicationId = applicationId.trim().toUpperCase();
    if (form === 'refno') f.refNo = refNo.trim();
    if (form === 'rural-plain') { f.surveyNo = surveyNo.trim(); f.subdivNo = subdivText.trim(); }
    if (form === 'rural') {
      if (landType) f.landType = landType;
      if (service === 'patta') f.viewBy = viewBy;
      if (service === 'patta' && viewBy === 'pt') f.pattaNo = pattaNo.trim();
      else { f.surveyNo = surveyNo.trim(); f.subdivNo = picks.subdiv; }
    }
    if (form === 'urban') f.subdivNo = picks.subdiv;
    return f;
  };

  const locationReady = form === 'appid' || form === 'refno'
    || Boolean(picks.district && picks.taluk && picks.village && (!askLandType || landType));
  const fieldsReady = ((): boolean => {
    switch (form) {
      case 'appid': return APP_ID_RE.test(applicationId.trim().toUpperCase());
      case 'refno': return refNo.trim().length >= 3;
      case 'rural-plain': return SURVEY_RE.test(surveyNo.trim()) && /^[0-9A-Za-z\-/.']{1,10}$/.test(subdivText.trim());
      case 'rural':
        if (service === 'patta' && viewBy === 'pt') return /^[1-9][0-9]{0,6}$/.test(pattaNo.trim());
        return SURVEY_RE.test(surveyNo.trim()) && Boolean(picks.subdiv);
      case 'urban': return Boolean(picks.ward && picks.block && picks.survey && picks.subdiv);
      default: return false;
    }
  })();
  const ready = Boolean(session) && locationReady && fieldsReady;

  const onGetOtp = (): void => {
    if (!session || !ready || !/^[6-9]\d{9}$/.test(mobile)) return;
    saveMobile(mobile);
    setMessage(null);
    sendOtp.mutate(
      { sessionId: session.sessionId, mobile, fields: fields() },
      { onSuccess: (r) => { setOtpSent(r.message); setOtp(''); setOtpSentAt(Date.now()); setNow(Date.now()); }, onError: (err) => fail(err, 'Land Records did not send the OTP.') },
    );
  };

  /** Fetch the record with this OTP (on Confirm, or as soon as 6 digits are in). */
  const verifyCode = (code: string): void => {
    // A ref, not isPending: the 6th digit and a Confirm/Enter can land in the
    // same tick, and a second confirm spends the OTP the first one used.
    if (!session || !/^\d{6}$/.test(code) || verifying.current) return;
    verifying.current = true;
    setMessage(null);
    verifyOtp.mutate(
      { sessionId: session.sessionId, otp: code },
      {
        onSuccess: (r) => {
          if (r.status === 'ok') setResult(r.result);
          else { setOtpCaptcha(true); setCaptchaImg(r.captchaImage); setCaptcha(''); }
        },
        onError: (err) => fail(err, 'The OTP was not accepted.'),
        onSettled: () => { verifying.current = false; },
      },
    );
  };

  const onConfirmOtp = (e: FormEvent): void => {
    e.preventDefault();
    verifyCode(otp);
  };

  /** Typed, picked from the phone's SMS suggestion, or pasted ("Your OTP is
   *  123456 ..."): keep the 6 digits, and fetch as soon as they are in. */
  const onOtpInput = (raw: string): void => {
    const digits = raw.replace(/\D/g, '');
    const code = digits.length > 6 ? (/\b(\d{6})\b/.exec(raw)?.[1] ?? digits.slice(0, 6)) : digits;
    setOtp(code);
    if (code.length === 6) verifyCode(code);
  };

  const onSubmitCaptcha = (e: FormEvent): void => {
    e.preventDefault();
    if (!session || !ready || !captcha.trim()) return;
    setMessage(null);
    submitCaptcha.mutate(
      { sessionId: session.sessionId, captcha: captcha.trim(), fields: fields() },
      {
        onSuccess: (r) => {
          setCaptcha('');
          if (r.status === 'retry') { setCaptchaImg(r.captchaImage); setMessage(r.reason); } else setResult(r.result);
        },
        onError: (err) => fail(err, 'Land Records did not answer.'),
      },
    );
  };

  const onRefreshCaptcha = (): void => {
    if (!session) return;
    refreshCaptcha.mutate(session.sessionId, {
      onSuccess: (r) => setCaptchaImg(r.captchaImage),
      onError: (err) => fail(err, 'Could not load a new captcha.'),
    });
  };

  const listSelect = (field: LandListField, label: string, required = false) => {
    const opts = lists[field];
    const loading = (field === 'district' && start.isPending)
      || (select.isPending && select.variables?.field === order[order.indexOf(field) - 1]);
    return (
      <LField label={label} required={required}>
        <Loadable loading={loading}>
          <select
            className="input"
            value={picks[field] ?? ''}
            disabled={!session || !opts || loading}
            onChange={(e) => pick(field, e.target.value)}
          >
            <option value="">{loading ? `Loading ${label.toLowerCase()}s…` : 'Please Select ...'}</option>
            {(opts ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Loadable>
      </LField>
    );
  };

  if (result && session) {
    return (
      <div className="col" style={{ gap: 14 }}>
        <LandTitleBar title={meta.screenTitle} onHome={onHome} />
        <LandResultPanel
          sessionId={session.sessionId}
          service={service}
          result={result}
          applicationId={form === 'appid' ? applicationId.trim().toUpperCase() : undefined}
          onFollow={onFollow}
          onSearchAgain={open}
        />
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <LandTitleBar title={meta.screenTitle} onHome={onHome} />
      {start.isPending && !session ? <LandOpening title={meta.screenTitle} /> : (
      <div className="card col lr-form" style={{ gap: 16, padding: 18 }}>
        {verifyOtp.isPending || submitCaptcha.isPending ? (
          <LandFetching text={service === 'app-status' ? 'Checking the application status…' : `Fetching the ${meta.screenTitle.replace(/^View /, '')}…`} />
        ) : null}

        {form === 'rural' || form === 'rural-plain' || form === 'urban' ? (
          <LRow>
            {listSelect('district', 'District')}
            {listSelect('taluk', 'Taluk')}
            {listSelect('village', form === 'urban' ? 'Town' : 'Village')}
          </LRow>
        ) : null}

        {form === 'urban' ? (
          <LRow>
            {listSelect('ward', 'Ward')}
            {listSelect('block', 'Block')}
          </LRow>
        ) : null}

        {form === 'rural' && askLandType && service !== 'fmb' ? (
          <div className="row" role="radiogroup" aria-label="Land Type" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="body-sm" style={{ fontWeight: 600 }}>Land Type:</span>
            {(['R', 'N'] as const).map((v) => (
              <label key={v} className="row body-sm" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="landtype" checked={landType === v} onChange={() => { setLandType(v); setSurveyNo(''); setLists((l) => ({ ...l, subdiv: undefined })); }} />
                {v === 'R' ? 'Rural' : 'Natham'}
              </label>
            ))}
          </div>
        ) : null}
        {form === 'rural' && askLandType && service === 'fmb' ? (
          <label className="row body-sm" style={{ gap: 8, alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
            To View Natham FMB :
            <input type="checkbox" checked={landType === 'N'} onChange={(e) => { setLandType(e.target.checked ? 'N' : 'R'); setSurveyNo(''); }} />
          </label>
        ) : null}

        {service === 'patta' ? (
          <div className="row" role="radiogroup" aria-label="View Patta/Chitta using" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="body-sm" style={{ fontWeight: 600 }}>View Patta/Chitta using :</span>
            {([['pt', 'Patta Number'], ['sur', 'Survey Number']] as const).map(([v, l]) => (
              <label key={v} className="row body-sm" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="viewOpt" checked={viewBy === v} onChange={() => { setViewBy(v); setOtpSent(null); }} />
                {l}
              </label>
            ))}
          </div>
        ) : null}

        {service === 'patta' && viewBy === 'pt' ? (
          <LRow>
            <LField label="Patta Number:">
              <input className="input" inputMode="numeric" maxLength={7} value={pattaNo} onChange={(e) => setPattaNo(e.target.value.replace(/\D/g, ''))} />
            </LField>
          </LRow>
        ) : null}

        {(form === 'rural' && !(service === 'patta' && viewBy === 'pt')) || form === 'rural-plain' ? (
          <>
            <SurveyHints />
            <LRow>
              <LField label="Survey Number">
                <input
                  className="input"
                  maxLength={6}
                  value={surveyNo}
                  disabled={form === 'rural' && !picks.village}
                  onChange={(e) => setSurveyNo(e.target.value.replace(/[^0-9A-Za-z/-]/g, '').toUpperCase())}
                  onBlur={loadSubdivs}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadSubdivs(); } }}
                />
              </LField>
              {form === 'rural' ? (
                <LField label="Sub Division Number" required>
                  <Loadable loading={subdivs.isPending}>
                    <select
                      className="input"
                      value={picks.subdiv ?? ''}
                      disabled={!lists.subdiv || subdivs.isPending}
                      onChange={(e) => { setPicks((p) => ({ ...p, subdiv: e.target.value })); setOtpSent(null); }}
                    >
                      <option value="">{subdivs.isPending ? 'Loading sub divisions…' : 'Please Select ...'}</option>
                      {(lists.subdiv ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Loadable>
                </LField>
              ) : (
                <LField label="Sub Division Number">
                  <input className="input" maxLength={10} value={subdivText} onChange={(e) => setSubdivText(e.target.value.toUpperCase())} />
                </LField>
              )}
            </LRow>
          </>
        ) : null}

        {form === 'urban' ? (
          <LRow>
            {listSelect('survey', 'Town Survey Number')}
            {listSelect('subdiv', 'Sub Division Number')}
          </LRow>
        ) : null}

        {form === 'appid' ? (
          <LRow>
            <LField label="Application Id" required={service !== 'app-status'}>
              <input className="input" placeholder="eg:-0000/0000/00/000000" maxLength={21} value={applicationId} onChange={(e) => setApplicationId(e.target.value.toUpperCase())} />
            </LField>
          </LRow>
        ) : null}

        {form === 'refno' ? (
          <LRow>
            <LField label="Reference Number to Verify Chitta Extract :" required>
              <input className="input" maxLength={40} value={refNo} onChange={(e) => setRefNo(e.target.value.trim())} />
            </LField>
          </LRow>
        ) : null}

        {gate === 'otp' ? (
          <div className="col" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <input
                className="input"
                style={{ maxWidth: 220 }}
                inputMode="numeric"
                maxLength={10}
                placeholder="Mobile No(10 digit)"
                aria-label="Mobile No(10 digit)"
                value={mobile}
                onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '')); setOtpSent(null); }}
              />
              <button type="button" className="btn" disabled={!ready || !/^[6-9]\d{9}$/.test(mobile) || sendOtp.isPending || (Boolean(otpSent) && otpLeft > 0)} onClick={onGetOtp}>
                {sendOtp.isPending ? <><Spinner size={12} /> Sending…</> : otpSent ? 'Resend OTP' : 'Get OTP'}
              </button>
            </div>
            {!ready && session ? <span className="body-sm muted">Fill the details above, then Get OTP. Land Records texts the OTP to this number.</span> : null}
            {otpCaptcha ? <span className="body-sm" style={{ fontWeight: 600 }}>OTP confirmed. Now enter the authentication value below.</span> : null}
            {otpSent && !otpCaptcha ? (
              <form className="col" style={{ gap: 10 }} onSubmit={onConfirmOtp}>
                <span className="body-sm">
                  {otpSent}{' '}
                  {otpLeft > 0
                    ? <span className="muted tabular">Valid for {Math.floor(otpLeft / 60)}:{String(otpLeft % 60).padStart(2, '0')}</span>
                    : <b>OTP expired - use Resend OTP.</b>}
                </span>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    style={{ maxWidth: 220 }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="OTP(6 digit)"
                    aria-label="OTP(6 digit)"
                    autoFocus
                    value={otp}
                    disabled={verifyOtp.isPending}
                    onChange={(e) => onOtpInput(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={otp.length !== 6 || verifyOtp.isPending}>
                    {verifyOtp.isPending ? 'Fetching…' : 'Confirm OTP'}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        {gate === 'captcha' || otpCaptcha ? (
          <form className="col" style={{ gap: 10 }} onSubmit={onSubmitCaptcha}>
            <span className="body-sm" style={{ fontWeight: 600 }}>Enter authentication Value:</span>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {captchaImg ? (
                <img src={captchaImg} alt="Captcha from Land Records" style={{ height: 56, borderRadius: 4, border: '1px solid var(--border-default)', background: '#fff' }} />
              ) : (
                <span className="body-sm muted" style={{ height: 56, minWidth: 150, display: 'inline-grid', placeItems: 'center', borderRadius: 4, border: '1px dashed var(--border-default)' }}>
                  {start.isPending || refreshCaptcha.isPending ? <Spinner size={16} /> : '—'}
                </span>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshCaptcha} disabled={refreshCaptcha.isPending} aria-label="New captcha">↻</button>
              <input
                ref={captchaInput}
                className="input"
                style={{ maxWidth: 160, fontSize: 18, letterSpacing: '0.08em' }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Answer"
                value={captcha}
                onChange={(e) => setCaptcha(e.target.value.replace(/[^0-9]/g, ''))}
                aria-label="Authentication value"
              />
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button type="submit" className="btn btn-primary" style={{ minWidth: 140 }} disabled={!ready || !captcha.trim() || submitCaptcha.isPending}>
                {submitCaptcha.isPending ? 'Fetching…' : service === 'app-status' ? 'Get Status' : 'Submit'}
              </button>
            </div>
          </form>
        ) : null}

        {message ? <p className="body-sm" role="alert" style={{ margin: 0, fontWeight: 600 }}>{message}</p> : null}
        {expired || (start.isError && !session) ? (
          <div><button type="button" className="btn btn-sm" onClick={open}>Start again</button></div>
        ) : null}
      </div>
      )}
      <p className="body-sm muted" style={{ margin: 0 }}>
        {meta.blurb} Fetched live from Tamil Nadu Land Records eServices (eservices.tn.gov.in). The {gate === 'captcha' ? 'captcha is' : 'OTP goes to the mobile number you enter and is'} only passed through - DifAi never stores it.
      </p>
    </div>
  );
}
