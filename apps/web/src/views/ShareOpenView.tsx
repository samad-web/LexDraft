import { useEffect, useId, useState, type FormEvent } from 'react';
import { Wordmark } from '@/components/brand/Logo';
import { fetchShareMeta, openShare } from '@/lib/share-link';

/** Public page a client lands on from a secure share link (/s#<token>). The token
 *  sits after #, which browsers never send to a server, so no log records it. */
export function ShareOpenView() {
  const [token] = useState(() => window.location.hash.slice(1));
  const id = useId();
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof fetchShareMeta>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchShareMeta(token).then((m) => live && setMeta(m)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [token]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const open = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!meta || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await openShare(token, meta.needsPassword ? password : undefined);
      const url = URL.createObjectURL(blob);
      setFileUrl(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError((err as Error).message);
      // 404 after wrong passwords = locked or gone: nothing more to try here.
      if (status === 404) setMeta(null);
    } finally {
      setBusy(false);
    }
  };

  const until = meta ? new Date(meta.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const size = meta ? (meta.fileSize >= 1_048_576 ? `${(meta.fileSize / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(meta.fileSize / 1024))} KB`) : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header style={{ borderBottom: '1px solid var(--border-subtle)', padding: 16 }}>
        <div style={{ maxWidth: 520, margin: '0 auto', fontSize: 22 }}><Wordmark /></div>
      </header>
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '40px 16px' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Shared document</div>
        {!meta && !error && <p className="body-md">Checking the link…</p>}
        {meta && (
          <form onSubmit={open} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h1 className="heading-md" style={{ margin: 0, overflowWrap: 'anywhere' }}>{meta.fileName}</h1>
            <p className="body-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{size} · link works until {until}</p>
            {meta.needsPassword && (
              <>
                <label htmlFor={`${id}-pw`} className="body-sm">Password (the sender gave it to you separately)</label>
                <input
                  id={`${id}-pw`}
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${id}-err` : undefined}
                  autoFocus
                />
              </>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy || (meta.needsPassword && password.length < 4)}>
              {busy ? 'Opening…' : 'Download document'}
            </button>
            {fileUrl && (
              <a className="body-sm" href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)' }}>
                Open in a new tab
              </a>
            )}
          </form>
        )}
        {error && (
          <p id={`${id}-err`} role="alert" className="body-md" style={{ marginTop: 16 }}>{error}</p>
        )}
        <p className="body-sm" style={{ marginTop: 40, color: 'var(--text-secondary)' }}>
          Sent to you through DifAi by your advocate. Don't forward this link.
        </p>
      </main>
    </div>
  );
}
