import { type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';

// =============================================================================
// SurveyThanksView - confirmation page shown after a successful submit.
// Matches the InviteAcceptView confirmation aesthetic: centered .card on
// bg-base, brand mark + eyebrow + heading + body + primary CTA.
//
// Offers a client-side JSON download of the submitted payload (per
// lexdraft-survey.md §6 - "Download-own-response"). If the user lands here
// directly without state (e.g. via reload), the download button is hidden.
// =============================================================================

export function SurveyThanksView() {
  const navigate = useNavigate();
  const location = useLocation();
  const payload = (location.state as { payload?: Record<string, unknown> } | null)?.payload ?? null;

  const handleDownload = () => {
    if (!payload) return;
    const json = JSON.stringify({ submitted_at: new Date().toISOString(), ...payload }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lexdraft-survey-response-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={pageStyle}>
      <div className="card" style={cardStyle}>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              background: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <div>
            <div className="eyebrow">LexDraft practitioner study</div>
            <div className="heading-md" style={{ marginTop: 2 }}>Thank you for your time</div>
          </div>
        </div>

        <p className="body-md" style={{ marginBottom: 16 }}>
          Your response has been recorded. The findings shape an AI tool built for Indian advocates -
          your candour today goes directly into product decisions.
        </p>

        <div className="card-cream" style={{ padding: 16, marginBottom: 20 }}>
          <div className="body-sm" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>What happens next</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
            <li className="body-sm" style={{ marginBottom: 4 }}>
              If you opted in for a follow-up, we'll be in touch via the email you provided.
            </li>
            <li className="body-sm" style={{ marginBottom: 4 }}>
              Beta access invitations go out as features come online.
            </li>
            <li className="body-sm">
              All responses are stored on India servers in line with DPDP Act 2023.
            </li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {payload && (
            <button type="button" className="btn btn-lg" onClick={handleDownload}>
              <Icon name="download" size={16} />
              Download your response
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => navigate('/', { replace: true })}
            style={{ flex: 1, minWidth: 200 }}
          >
            Back to LexDraft
          </button>
        </div>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-base)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
};

const cardStyle: CSSProperties = {
  width: 'min(640px, 100%)',
  padding: 'clamp(24px, 4vw, 44px)',
};
