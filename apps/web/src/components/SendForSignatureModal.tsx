import { useState, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCreateEsignRequest, useSendEsignRequest } from '@/hooks/useEsign';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentName: string;
  caseId?: string;
}

interface SignerRow {
  name: string;
  email: string;
}

const EMPTY_SIGNER: SignerRow = { name: '', email: '' };

// Document types the IT Act's own First Schedule exclusions are commonly
// cited as covering regardless of signature method or tier — advisory only
// (not independently re-verified against primary source in this pass; see
// 0079_esign.sql's document_type_hint comment). Shown as a warning, never a
// hard block, since the exact exclusion list wasn't confirmed.
const CAUTION_TYPES = ['negotiable instrument', 'power of attorney', 'trust deed', 'will', 'sale deed', 'conveyance'];

function looksExcluded(name: string): boolean {
  const lower = name.toLowerCase();
  return CAUTION_TYPES.some((t) => lower.includes(t));
}

export function SendForSignatureModal({ open, onClose, documentId, documentName, caseId }: Props) {
  const create = useCreateEsignRequest();
  const send = useSendEsignRequest();
  const showToast = useUIStore((s) => s.showToast);

  const [title, setTitle] = useState(documentName);
  const [signers, setSigners] = useState<SignerRow[]>([{ ...EMPTY_SIGNER }]);
  const [error, setError] = useState<string | null>(null);

  const busy = create.isPending || send.isPending;
  const excludedWarning = looksExcluded(documentName) || looksExcluded(title);

  const updateSigner = (i: number, patch: Partial<SignerRow>) => {
    setSigners((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  const addSigner = () => setSigners((prev) => (prev.length >= 10 ? prev : [...prev, { ...EMPTY_SIGNER }]));
  const removeSigner = (i: number) => setSigners((prev) => prev.filter((_, j) => j !== i));

  const validSigners = signers.filter((s) => s.name.trim() && /\S+@\S+\.\S+/.test(s.email.trim()));
  const canSubmit = title.trim().length > 0 && validSigners.length === signers.length && signers.length > 0 && !busy;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      const created = await create.mutateAsync({
        title: title.trim(),
        sourceDocumentId: documentId,
        caseId,
        signers: signers.map((s, i) => ({ name: s.name.trim(), email: s.email.trim(), order: i + 1 })),
      });
      await send.mutateAsync(created.id);
      showToast({ type: 'sage', text: `Sent to ${validSigners.length} signer${validSigners.length === 1 ? '' : 's'}` });
      onClose();
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? 'Could not send for signature. Try again.',
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      eyebrow="Electronic signature"
      title="Send for signature"
      description="Each signer gets a unique link, confirms their identity with a one-time email code, and signs. This is a self-built electronic signature under IT Act Section 3A — not a Certifying-Authority-issued digital signature or Aadhaar eSign."
      width={620}
      onSubmit={onSubmit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Sending…' : 'Send for signature'}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </Field>

        {excludedWarning && (
          <div className="card" style={{ borderColor: 'var(--warning)', padding: '10px 12px' }}>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Icon name="flag" size={14} />
              <p className="body-sm muted" style={{ margin: 0 }}>
                Documents like powers of attorney, wills, trusts, negotiable instruments, and property
                conveyances are commonly understood to be excluded from electronic execution under the
                IT Act regardless of signature method. Double-check this document type before relying on
                an electronic signature for it.
              </p>
            </div>
          </div>
        )}

        <div className="col" style={{ gap: 10 }}>
          <span className="label">Signers</span>
          {signers.map((s, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                placeholder="Name"
                value={s.name}
                onChange={(e) => updateSigner(i, { name: e.target.value })}
                style={{ flex: '1 1 40%' }}
              />
              <input
                className="input"
                placeholder="email@example.com"
                type="email"
                value={s.email}
                onChange={(e) => updateSigner(i, { email: e.target.value })}
                style={{ flex: '1 1 50%' }}
              />
              {signers.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSigner(i)} aria-label="Remove signer">
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          {signers.length < 10 && (
            <button type="button" className="btn btn-sm" onClick={addSigner} style={{ alignSelf: 'flex-start' }}>
              <Icon name="plus" size={12} /> Add signer
            </button>
          )}
        </div>

        {error && <p className="body-sm" style={{ color: 'var(--vermillion)' }} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
