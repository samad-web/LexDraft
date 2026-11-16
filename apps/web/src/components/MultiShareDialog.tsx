import { useEffect, useId, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { Modal } from './Modal';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { randomPin } from '@/lib/pdf-lock';
import { canShareFiles, shareFiles } from '@/lib/native';
import { openWhatsAppText } from '@/lib/whatsapp-share';
import { SHARE_DAYS, type ShareDays } from '@/lib/share-link';
import {
  filesNote, linksMessage, prepareFiles, prepareLinks, shareProblem, type ShareItem, type ShareMode,
} from '@/lib/multi-share';

type Ready =
  | { kind: 'link'; message: string }
  | { kind: 'files'; files: Array<{ blob: Blob; fileName: string }>; note: string };

/** Share several case documents on WhatsApp (features/multi-share.md). Two steps:
 *  Prepare (lock / create links), then Send: a fresh tap the browser never blocks. */
export function MultiShareDialog({ open, onClose, items, forWhom, onSent }: {
  open: boolean;
  onClose: () => void;
  items: ShareItem[];
  /** Client / matter name for the PDF watermark. */
  forWhom: string | null;
  onSent: () => void;
}) {
  const id = useId();
  const me = useAuthStore((s) => s.user?.name);
  const showToast = useUIStore((s) => s.showToast);
  const filesOk = canShareFiles();
  const [mode, setMode] = useState<ShareMode>('link');
  const [days, setDays] = useState<ShareDays>(7);
  const [withPassword, setWithPassword] = useState(true);
  const [confirmNoPassword, setConfirmNoPassword] = useState(false);
  const [password, setPassword] = useState(randomPin);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);

  // Fresh PIN and defaults every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setMode('link'); setDays(7); setWithPassword(true); setConfirmNoPassword(false);
    setPassword(randomPin()); setReady(null); setBusy(false);
  }, [open]);

  const pw = withPassword ? password : null;
  const problem = shareProblem(items, mode, pw)
    ?? (!withPassword && !confirmNoPassword ? 'Tick "Send without a password" to continue without one.' : null)
    ?? (mode === 'files' && !filesOk ? 'This browser cannot attach files. Use "Secure link".' : null);

  const prepare = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      if (mode === 'link') {
        const links = await prepareLinks(items, days, pw);
        setReady({ kind: 'link', message: linksMessage(links, pw !== null, me) });
      } else {
        const files = await prepareFiles(items, pw, forWhom);
        setReady({ kind: 'files', files, note: filesNote(files.length, pw !== null, me) });
      }
    } catch (err) {
      showToast({ type: 'cobalt', text: err instanceof Error ? err.message : 'Could not prepare the files' });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!ready) return;
    if (ready.kind === 'link') {
      openWhatsAppText(ready.message);
    } else {
      const r = await shareFiles(ready.files, ready.note);
      if (r === 'fallback') {
        showToast({ type: 'cobalt', text: 'This device could not attach the files. Use "Secure link" instead.' });
        return;
      }
      if (r === 'cancelled') return;
    }
    onSent();
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: 'sage', text: `${what} copied` });
    } catch {
      showToast({ type: 'amber', text: 'Could not copy. Select it and copy by hand.' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${items.length} ${items.length === 1 ? 'file' : 'files'} on WhatsApp`}
      eyebrow="Send to client"
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{ready ? 'Done' : 'Cancel'}</button>
          {!ready ? (
            <button type="button" className="btn btn-primary" onClick={() => void prepare()} disabled={!!problem || busy}>
              {busy ? 'Preparing…' : 'Prepare'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void send()}>
              <Icon name="chat" size={14} /> Send on WhatsApp
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ul className="body-sm" style={{ margin: 0, paddingLeft: 18, maxHeight: 140, overflow: 'auto' }}>
          {items.map((it) => <li key={it.id} style={{ overflowWrap: 'anywhere' }}>{it.fileName}</li>)}
        </ul>

        {!ready && (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <legend className="body-sm" style={{ fontWeight: 600, marginBottom: 6 }}>How to send</legend>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                <input type="radio" name={`${id}-mode`} checked={mode === 'link'} onChange={() => setMode('link')} />
                <span><strong>Secure link</strong> (any file type). One message with a link per file; links expire and can be cancelled.</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, opacity: filesOk ? 1 : 0.55 }}>
                <input type="radio" name={`${id}-mode`} checked={mode === 'files'} onChange={() => setMode('files')} disabled={!filesOk} />
                <span><strong>Attach files</strong>. PDFs are locked with the password.{!filesOk && ' Not available in this browser.'}</span>
              </label>
            </fieldset>

            {mode === 'link' && (
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                Links expire in
                <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value) as ShareDays)} style={{ width: 'auto' }}>
                  {SHARE_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
                </select>
              </label>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor={`${id}-pw`} className="body-sm" style={{ fontWeight: 600 }}>Password</label>
              {withPassword ? (
                <input
                  id={`${id}-pw`}
                  className="input"
                  value={password}
                  maxLength={64}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono, monospace)' }}
                />
              ) : (
                <p className="body-sm" style={{ margin: 0 }}>No password: anyone the message is forwarded to can open the files.</p>
              )}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!withPassword}
                  onChange={(e) => { setWithPassword(!e.target.checked); setConfirmNoPassword(false); if (!e.target.checked) setPassword(randomPin()); }}
                />
                Send without a password
              </label>
              {!withPassword && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={confirmNoPassword} onChange={(e) => setConfirmNoPassword(e.target.checked)} />
                  Yes, I understand these files will not be protected
                </label>
              )}
            </div>

            {problem && <p role="alert" className="body-sm" style={{ margin: 0 }}>{problem}</p>}
          </>
        )}

        {ready && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="body-sm" style={{ margin: 0 }}>
              Ready. Tap <strong>Send on WhatsApp</strong> and pick the client's chat.
            </p>
            {pw !== null && (
              <div style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
                <div className="body-sm">Password: send it separately (call or SMS), not in the same chat.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                  <strong style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 20, letterSpacing: 2 }}>{pw}</strong>
                  <button type="button" className="btn btn-sm" onClick={() => void copy(pw, 'Password')}>Copy</button>
                </div>
              </div>
            )}
            {ready.kind === 'link' && (
              <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void copy(ready.message, 'Message')}>
                Copy message instead
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
