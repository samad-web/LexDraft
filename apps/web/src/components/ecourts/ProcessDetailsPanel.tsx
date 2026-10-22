import { useState, type FormEvent } from 'react';
import {
  useRefreshEcourtsWebSearchCaptcha,
  useSendProcessOtp,
  useStartProcessDetails,
  useSubmitProcessCaptcha,
  useVerifyProcessOtp,
  type EcourtsWebSearchResult,
} from '@/hooks/useEcourts';
import { WebSearchResults } from './WebSearchResults';

// Process details (summons / warrants / notices) from the eCourts website:
// process ID + email -> captcha -> eCourts sends a code to the process
// RECIPIENT -> enter it -> the document downloads.

type Step = 'start' | 'captcha' | 'recipient' | 'otp' | 'done';

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (err instanceof Error ? err.message : fallback);
}

export function ProcessDetailsPanel() {
  const [step, setStep] = useState<Step>('start');
  const [processId, setProcessId] = useState('');
  const [email, setEmail] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState('');
  const [result, setResult] = useState<EcourtsWebSearchResult | null>(null);
  const [recipient, setRecipient] = useState<{ email: string | null; mobile: string | null } | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useStartProcessDetails();
  const submitCaptcha = useSubmitProcessCaptcha();
  const refresh = useRefreshEcourtsWebSearchCaptcha();
  const sendOtp = useSendProcessOtp();
  const verifyOtp = useVerifyProcessOtp();

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const onStart = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!processId.trim() || !validEmail) return;
    setError(null);
    setResult(null);
    start.mutate({ processId: processId.trim(), email: email.trim() }, {
      onSuccess: (r) => { setSessionId(r.sessionId); setCaptchaImg(r.captchaImageBase64); setStep('captcha'); },
      onError: (err) => setError(errorText(err, 'Could not open process details')),
    });
  };

  const onCaptcha = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!sessionId || !captcha.trim()) return;
    setError(null);
    submitCaptcha.mutate({ sessionId, captchaCode: captcha.trim() }, {
      onSuccess: (r) => {
        setCaptcha('');
        if (r.status === 'retry') {
          setCaptchaImg(r.captchaImageBase64);
          setError(r.reason);
          return;
        }
        setResult(r.result);
        setRecipient(r.recipient);
        setStep('recipient');
      },
      onError: (err) => setError(errorText(err, 'eCourts did not answer')),
    });
  };

  const onSendOtp = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!sessionId || !name.trim() || !/^\d{10}$/.test(mobile)) return;
    setError(null);
    sendOtp.mutate({ sessionId, name: name.trim(), mobile, email: email.trim() }, {
      onSuccess: (r) => { setInfo(r.message); setStep('otp'); },
      onError: (err) => setError(errorText(err, 'Could not send the verification code')),
    });
  };

  const onVerify = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!sessionId || !otp.trim()) return;
    setError(null);
    verifyOtp.mutate({ sessionId, otp: otp.trim() }, {
      onSuccess: (fname) => { setInfo(`Downloaded ${fname}.`); setStep('done'); },
      onError: (err) => setError(errorText(err, 'The code was not accepted')),
    });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      {step === 'start' || step === 'done' ? (
        <form onSubmit={onStart} className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Process ID</span>
            <input className="input mono" value={processId} onChange={(e) => setProcessId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} style={{ width: 240 }} />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Email (registered with the process)</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: 260 }} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!processId.trim() || !validEmail || start.isPending}>
            {start.isPending ? 'Opening eCourts…' : 'Continue to captcha'}
          </button>
        </form>
      ) : null}

      {step === 'captcha' && captchaImg && sessionId ? (
        <form onSubmit={onCaptcha} className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <img src={`data:image/png;base64,${captchaImg}`} alt="eCourts captcha" style={{ border: '1px solid var(--border)', borderRadius: 6 }} />
          <input className="input mono" value={captcha} autoFocus placeholder="Type the characters" onChange={(e) => setCaptcha(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} style={{ width: 180 }} />
          <button type="submit" className="btn btn-primary" disabled={!captcha || submitCaptcha.isPending}>
            {submitCaptcha.isPending ? 'Checking…' : 'Show process'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(sessionId, { onSuccess: (r) => setCaptchaImg(r.captchaImageBase64) })}
          >
            New captcha
          </button>
        </form>
      ) : null}

      {result && step !== 'start' ? <WebSearchResults result={result} /> : null}

      {step === 'recipient' ? (
        <form onSubmit={onSendOtp} className="col" style={{ gap: 10 }}>
          <p className="body-sm muted">
            eCourts sends a verification code to the person this process was issued to
            {recipient?.email || recipient?.mobile ? ` (${[recipient.email, recipient.mobile].filter(Boolean).join(' · ')})` : ''}.
          </p>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="body-sm muted">Recipient name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="body-sm muted">Recipient mobile</span>
              <input className="input" value={mobile} inputMode="numeric" maxLength={10} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} style={{ width: 160 }} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || !/^\d{10}$/.test(mobile) || sendOtp.isPending}>
              {sendOtp.isPending ? 'Sending…' : 'Send code'}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'otp' ? (
        <form onSubmit={onVerify} className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Verification code</span>
            <input className="input mono" value={otp} autoFocus onChange={(e) => setOtp(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} style={{ width: 160 }} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!otp || verifyOtp.isPending}>
            {verifyOtp.isPending ? 'Verifying…' : 'Verify and download'}
          </button>
        </form>
      ) : null}

      {info ? <p className="body-sm" style={{ color: 'var(--text-secondary)' }}>{info}</p> : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </div>
  );
}
