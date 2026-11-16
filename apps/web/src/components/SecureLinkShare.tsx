import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@lexdraft/ui';
import { Modal } from './Modal';
import { PDF_LOCK_OFF, PdfLockOption, type PdfLock } from './PdfLockOption';
import { useUIStore } from '@/store/ui';
import { validPdfPassword } from '@/lib/pdf-lock';
import { openWhatsAppText } from '@/lib/whatsapp-share';
import {
  SHARE_DAYS, createShareLink, linkNote, linkStatus, listShareLinks, revokeShareLink, type ShareDays,
} from '@/lib/share-link';

/** "Send secure link on WhatsApp": the client gets a link that expires, can be
 *  revoked and can need a password, instead of the file (features/secure-share-link.md). */
export function SecureLinkShare({ getFile, note, disabled }: {
  /** Produces the file at click time (draft PDF, stored document...). */
  getFile: () => Promise<{ blob: Blob; fileName: string }>;
  note: string;
  disabled?: boolean;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const [days, setDays] = useState<ShareDays>(7);
  const [lock, setLock] = useState<PdfLock>(PDF_LOCK_OFF);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; password: string | null } | null>(null);
  const [manage, setManage] = useState(false);
  const qc = useQueryClient();

  const send = async () => {
    if (busy) return;
    if (lock.on && !validPdfPassword(lock.password)) {
      showToast({ type: 'amber', text: 'Password must be 4 to 64 characters' });
      return;
    }
    setBusy(true);
    try {
      const { blob, fileName } = await getFile();
      const link = await createShareLink(blob, fileName, days, lock.on ? lock.password : undefined);
      setMade({ url: link.url, password: lock.on ? lock.password : null });
      void qc.invalidateQueries({ queryKey: ['share-links'] });
      openWhatsAppText(linkNote(note, link.url, link.expiresAt, lock.on));
      showToast({
        type: 'sage',
        text: lock.on ? `Link ready. Send the password ${lock.password} to the client separately.` : 'Link ready.',
      });
    } catch (err) {
      showToast({ type: 'cobalt', text: err instanceof Error ? err.message : 'Could not create the link' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      showToast({ type: 'sage', text: 'Link copied' });
    } catch {
      showToast({ type: 'amber', text: 'Could not copy. Select the link and copy it.' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" type="button" onClick={() => void send()} disabled={disabled || busy}
          title="Send a link that expires, instead of the file">
          <Icon name="chat" size={14} /> {busy ? 'Creating link…' : 'Send secure link on WhatsApp'}
        </button>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Expires in
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value) as ShareDays)}
            disabled={busy} style={{ width: 'auto' }}>
            {SHARE_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
        </label>
      </div>
      <PdfLockOption value={lock} onChange={setLock} disabled={busy} label="Ask for a password to open the link" />
      {made && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" readOnly value={made.url} aria-label="Secure link" onFocus={(e) => e.target.select()}
            style={{ flex: 1, minWidth: 180, fontSize: 12 }} />
          <button className="btn" type="button" onClick={() => void copy()}>Copy link</button>
        </div>
      )}
      <button type="button" className="btn btn-ghost" onClick={() => setManage(true)} style={{ alignSelf: 'flex-start', fontSize: 13 }}>
        Manage secure links
      </button>
      <SharedLinksModal open={manage} onClose={() => setManage(false)} />
    </div>
  );
}

export function SharedLinksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const links = useQuery({ queryKey: ['share-links'], queryFn: listShareLinks, enabled: open });
  const revoke = useMutation({
    mutationFn: revokeShareLink,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['share-links'] });
      showToast({ type: 'sage', text: 'Link cancelled. It no longer opens.' });
    },
    onError: () => showToast({ type: 'cobalt', text: 'Could not cancel the link' }),
  });
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Modal open={open} onClose={onClose} title="Secure links" eyebrow="Shared with clients" width={640}
      footer={<button className="btn" type="button" onClick={onClose}>Close</button>}>
      {links.isLoading && <p className="body-sm">Loading…</p>}
      {links.isError && <p className="body-sm" role="alert">Could not load your links.</p>}
      {links.data?.length === 0 && <p className="body-sm">No links yet.</p>}
      {!!links.data?.length && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ padding: 6 }}>Document</th><th style={{ padding: 6 }}>Opened</th>
              <th style={{ padding: 6 }}>Status</th><th style={{ padding: 6 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {links.data.map((l) => {
              const st = linkStatus(l);
              return (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: 6, overflowWrap: 'anywhere' }}>{l.fileName}{l.hasPassword ? ' · password' : ''}</td>
                  <td style={{ padding: 6 }}>{l.viewCount === 0 ? 'Not yet' : `${l.viewCount}× · last ${fmt(l.lastViewedAt!)}`}</td>
                  <td style={{ padding: 6 }}>
                    {st === 'active' ? `Until ${fmt(l.expiresAt)}` : st === 'revoked' ? 'Cancelled' : 'Expired'}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    {st === 'active' && (
                      <button className="btn" type="button" disabled={revoke.isPending}
                        onClick={() => revoke.mutate(l.id)}>Cancel link</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
