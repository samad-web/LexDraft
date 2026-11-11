import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Icon } from '@lexdraft/ui';
import { api } from '@/lib/api';

// =============================================================================
// Bar Council enrolment check (build-docs/features/bar-council-verification.md).
// Tamil Nadu: the council's own search sends an OTP to the advocate's mobile;
// they type it here and DifAi reads the council's record. Other councils: no
// automatic check yet, the council's note explains why.
// =============================================================================

export interface BarCouncilOption { id: string; name: string; mode: 'otp' | 'live' | 'roll' | 'none'; note?: string }
type BarStatus = 'verified' | 'inactive' | 'not_found' | 'name_mismatch' | 'unavailable' | 'unsupported';
interface BarRecord { name: string; enrolmentNo: string; enrolmentDate?: string }

export function useBarCouncils() {
  return useQuery({
    queryKey: ['bar-verification'],
    queryFn: () => api.get<{ councils: BarCouncilOption[]; council: string | null; status: BarStatus | null }>('/me/bar-verification'),
    staleTime: 60 * 60 * 1000,
  });
}

const RESULT_TEXT: Record<BarStatus, string> = {
  verified: 'Verified with the Bar Council.',
  inactive: 'The Bar Council lists this enrolment as not practising (for example retired, suspended or transferred). Your account stays unverified.',
  not_found: 'The Bar Council has no advocate with this enrolment number. Check the number and try again.',
  name_mismatch: 'The Bar Council lists this number under a different name. You can continue; your account stays unverified.',
  unavailable: 'The Bar Council website did not answer. You can continue and verify later from Settings.',
  unsupported: 'Your Bar Council has no automatic check.',
};

const boxStyle = {
  padding: '14px 16px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
};

function ResultBox({ status, record, onRetry }: { status: BarStatus; record?: BarRecord; onRetry: () => void }) {
  return (
    <div style={boxStyle} role="status">
      <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {status === 'verified' && <Icon name="check" size={14} />}
        {RESULT_TEXT[status]}
      </strong>
      {record && (
        <span className="body-xs mono" style={{ color: 'var(--text-secondary)' }}>
          {[record.name, record.enrolmentNo, record.enrolmentDate].filter(Boolean).join(' · ')}
        </span>
      )}
      {status !== 'verified' && (
        <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

/** Councils DifAi checks from its side: a public search or an imported roll. */
export function LiveBarVerify({ council, enrolmentNo }: { council: BarCouncilOption; enrolmentNo: string }) {
  const check = useMutation({
    mutationFn: () => api.post<{ status: BarStatus; record?: BarRecord }>('/me/bar-verification/check', { council: council.id, enrolmentNo }),
  });
  if (check.data) return <ResultBox status={check.data.status} record={check.data.record} onRetry={() => check.reset()} />;
  return (
    <div style={boxStyle}>
      <span className="body-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        DifAi checks your enrolment number on the Bar Council of {council.name}&rsquo;s public roll. You can skip this; we also check
        when you finish.{council.note ? ` ${council.note}` : ''}
      </span>
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} disabled={check.isPending} onClick={() => check.mutate()}>
        {check.isPending ? 'Checking the roll…' : 'Check with the Bar Council'}
      </button>
      {check.isError && <span role="alert" className="body-xs">{check.error.message}</span>}
    </div>
  );
}

/** Tamil Nadu OTP check. `enrolmentNo` comes from the form around it. */
export function TnBarVerify({ enrolmentNo }: { enrolmentNo: string }) {
  const [mobile, setMobile] = useState('');
  const [session, setSession] = useState<{ sessionId: string; mobile: string } | null>(null);
  const [otp, setOtp] = useState('');
  const start = useMutation({
    mutationFn: () => api.post<{ sessionId: string; mobile: string }>('/me/bar-verification/tn/start', {
      enrolmentNo, ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
    }),
    onSuccess: (r) => { setSession(r); setOtp(''); },
  });
  const finish = useMutation({
    mutationFn: () => api.post<{ status: BarStatus; record?: BarRecord }>('/me/bar-verification/tn/otp', { sessionId: session!.sessionId, otp }),
  });

  const result = finish.data;
  if (result) return <ResultBox status={result.status} record={result.record} onRetry={() => { finish.reset(); setSession(null); }} />;

  return (
    <div style={boxStyle}>
      <span className="body-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Verify with the Bar Council of Tamil Nadu &amp; Puducherry. The council sends an OTP to your mobile; DifAi reads only your
        enrolment record. You can skip this and verify later.
      </span>
      {!session ? (
        <>
          <label className="label" htmlFor="bar-mobile">Mobile for the council&rsquo;s OTP <span className="hint">Leave empty to use your WhatsApp number</span></label>
          <input id="bar-mobile" className="input mono" inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d+\s]/g, ''))} placeholder="98765 43210" />
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} disabled={start.isPending || enrolmentNo.trim().length < 3} onClick={() => start.mutate()}>
            {start.isPending ? 'Contacting the Bar Council…' : 'Send OTP'}
          </button>
          {start.isError && <span role="alert" className="body-xs">{start.error.message}</span>}
        </>
      ) : (
        <>
          <label className="label" htmlFor="bar-otp">OTP sent by the Bar Council to {session.mobile}</label>
          <input id="bar-otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={finish.isPending || otp.length < 4} onClick={() => finish.mutate()}>
              {finish.isPending ? 'Checking the roll…' : 'Verify'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={finish.isPending} onClick={() => { setSession(null); finish.reset(); }}>
              Change number
            </button>
          </div>
          {finish.isError && <span role="alert" className="body-xs">{finish.error.message}</span>}
        </>
      )}
    </div>
  );
}
