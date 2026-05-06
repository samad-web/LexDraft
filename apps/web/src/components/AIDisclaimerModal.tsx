import { useState } from 'react';
import { Icon } from '@lexdraft/ui';

interface AIDisclaimerModalProps {
  open: boolean;
  format: 'PDF' | 'DOCX' | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AIDisclaimerModal({ open, format, onCancel, onConfirm }: AIDisclaimerModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!open || !format) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="disclaimer-title"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          width: 'min(520px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              flex: '0 0 auto',
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="flag" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Before you download</div>
            <h3 id="disclaimer-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              This is an AI-generated document
            </h3>
          </div>
        </div>

        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>
          The {format} you are about to download was drafted with AI assistance. It may contain
          factual, legal, or citation errors. <strong style={{ color: 'var(--text-primary)' }}>
          You must review and verify every paragraph</strong> — facts, parties, dates, statutes,
          and prayer — before filing it, serving it on a party, or sending it to a client.
        </p>

        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-tertiary)', margin: 0 }}>
          A footer with this same notice will be embedded at the end of the exported file as a
          record of its AI-assisted origin.
        </p>

        <label
          className="row"
          style={{
            gap: 10,
            alignItems: 'flex-start',
            padding: '10px 12px',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            background: 'var(--bg-surface-2)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
            I will review and verify this document before sending or filing it.
          </span>
        </label>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!acknowledged}
            onClick={onConfirm}
          >
            Download {format}
          </button>
        </div>
      </div>
    </div>
  );
}
