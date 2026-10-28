/**
 * Public signer-facing page for an electronic-signature request. The signer
 * usually has no DifAi account — this is a token-scoped landing page, the
 * signing counterpart to CoCounselAcceptView/InviteAcceptView.
 *
 * Flow: load request by token -> explicit consent -> email OTP -> sign.
 * Each step is a real API call (see useEsign.ts / esign.routes.ts) so the
 * audit trail captures every stage, not just the final click. See
 * 0079_esign.sql's header for why this sequencing matters legally.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import {
  useEsignByToken, useEsignConsent, useEsignRequestOtp, useEsignVerifyOtp, useEsignSign, useEsignDecline,
} from '@/hooks/useEsign';

type Step = 'review' | 'consent' | 'otp' | 'signing' | 'done' | 'declined';

export function SignView() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useEsignByToken(token);
  const consent = useEsignConsent(token);
  const requestOtp = useEsignRequestOtp(token);
  const verifyOtp = useEsignVerifyOtp(token);
  const sign = useEsignSign(token);
  const decline = useEsignDecline(token);

  const [step, setStep] = useState<Step>('review');
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);

  if (isLoading) {
    return (
      <div className="sign-shell">
        <div className="sign-card">
          <p className="body-md muted">Loading<span className="blink" /></p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="sign-shell">
        <div className="sign-card">
          <Icon name="flag" size={24} />
          <h1 className="heading-lg" style={{ marginTop: 12 }}>This link isn't valid</h1>
          <p className="body-md muted">
            It may have expired, already been used, or been typed incorrectly. Contact whoever sent you
            this link for a new one.
          </p>
        </div>
      </div>
    );
  }

  const { request, signer } = data;

  if (request.status === 'cancelled' || request.status === 'expired') {
    return (
      <div className="sign-shell">
        <div className="sign-card">
          <Icon name="flag" size={24} />
          <h1 className="heading-lg" style={{ marginTop: 12 }}>This request is no longer active</h1>
          <p className="body-md muted">"{request.title}" was {request.status === 'cancelled' ? 'cancelled' : 'has expired'}. Contact the sender if you believe this is a mistake.</p>
        </div>
      </div>
    );
  }

  if (signer.status === 'signed' || step === 'done') {
    return (
      <div className="sign-shell">
        <div className="sign-card">
          <Icon name="check" size={24} />
          <h1 className="heading-lg" style={{ marginTop: 12 }}>You've signed "{request.title}"</h1>
          <p className="body-md muted">
            A record of your signature and the time you signed has been kept. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  if (signer.status === 'declined' || step === 'declined') {
    return (
      <div className="sign-shell">
        <div className="sign-card">
          <h1 className="heading-lg">You declined to sign</h1>
          <p className="body-md muted">The sender of "{request.title}" has been notified.</p>
        </div>
      </div>
    );
  }

  const handleDecline = async () => {
    await decline.mutateAsync(declineReason.trim() || undefined);
    setStep('declined');
  };

  const startConsent = () => setStep('consent');

  const giveConsent = async () => {
    await consent.mutateAsync();
    await requestOtp.mutateAsync();
    setStep('otp');
  };

  const resendOtp = async () => {
    setOtpError(null);
    await requestOtp.mutateAsync();
  };

  const submitOtp = async () => {
    setOtpError(null);
    const result = await verifyOtp.mutateAsync(otpCode);
    if (!result.verified) {
      setOtpError('Incorrect or expired code. Try again or resend.');
      return;
    }
    setStep('signing');
    await sign.mutateAsync();
    setStep('done');
  };

  return (
    <div className="sign-shell">
      <div className="sign-card">
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
          ELECTRONIC SIGNATURE REQUEST
        </div>
        <h1 className="heading-lg" style={{ marginBottom: 4 }}>{request.title}</h1>
        <p className="body-sm muted" style={{ marginBottom: 20 }}>Requested of {signer.name} &lt;{signer.email}&gt;</p>

        {step === 'review' && (
          <>
            <p className="body-md" style={{ marginBottom: 20 }}>
              You've been asked to review and electronically sign this document. The next steps will ask
              you to confirm your consent and verify your email with a one-time code before signing.
            </p>
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn btn-primary btn-lg" onClick={startConsent}>
                Review and sign
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowDecline(true)}>
                Decline to sign
              </button>
            </div>
            {showDecline && (
              <div className="col" style={{ gap: 10, marginTop: 16 }}>
                <textarea
                  className="input"
                  placeholder="Reason (optional)"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                />
                <button type="button" className="btn" style={{ color: 'var(--vermillion)', alignSelf: 'flex-start' }} onClick={handleDecline} disabled={decline.isPending}>
                  {decline.isPending ? 'Declining…' : 'Confirm decline'}
                </button>
              </div>
            )}
          </>
        )}

        {step === 'consent' && (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 20, background: 'var(--bg-surface-2)' }}>
              <p className="body-sm" style={{ margin: 0 }}>
                I agree to sign this document electronically. I understand this is an electronic signature
                under Section 3A of the Information Technology Act, 2000 — not a Certifying-Authority-issued
                digital signature or Aadhaar eSign — and that my IP address, device, and the time of signing
                will be recorded.
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={giveConsent} disabled={consent.isPending || requestOtp.isPending}>
              {consent.isPending || requestOtp.isPending ? 'Sending code…' : 'I agree — send me a code'}
            </button>
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="body-md" style={{ marginBottom: 16 }}>
              We sent a 6-digit code to <strong>{signer.email}</strong>. Enter it below to sign.
            </p>
            <input
              className="input"
              style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center', marginBottom: 12 }}
              inputMode="numeric"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoFocus
            />
            {otpError && <p className="body-sm" style={{ color: 'var(--vermillion)', marginBottom: 12 }}>{otpError}</p>}
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={submitOtp}
                disabled={otpCode.length !== 6 || verifyOtp.isPending || sign.isPending}
              >
                {verifyOtp.isPending || sign.isPending ? 'Signing…' : 'Verify and sign'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resendOtp} disabled={requestOtp.isPending}>
                Resend code
              </button>
            </div>
          </>
        )}

        {step === 'signing' && <p className="body-md muted">Signing<span className="blink" /></p>}
      </div>
      <style>{`
        .sign-shell {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          padding: 24px; background: var(--bg-base);
        }
        .sign-card {
          max-width: 520px; width: 100%; background: var(--bg-surface);
          border: 1px solid var(--border-default); border-radius: var(--radius-lg);
          padding: 32px;
        }
      `}</style>
    </div>
  );
}
