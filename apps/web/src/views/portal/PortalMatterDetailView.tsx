import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortalAcknowledgeDocumentResponse, PortalMatterDetail } from '@lexdraft/types';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { PortalMessagesPanel } from './PortalMessagesPanel';

/**
 * Single-matter view. Loads everything the client can see about this matter
 * in one round trip: matter metadata, hearings (past + upcoming), documents
 * (with acknowledge button when required), and the matter's message thread.
 */
export function PortalMatterDetailView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const queryKey = ['portal', 'matter', id];

  const matter = useQuery({
    queryKey,
    queryFn: () => portalApi.get<PortalMatterDetail>(`/matters/${id}`),
    enabled: !!id,
    refetchOnWindowFocus: true,
  });

  const ack = useMutation({
    mutationFn: (docId: string) =>
      portalApi.post<PortalAcknowledgeDocumentResponse>(`/documents/${docId}/sign`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['portal', 'dashboard'] });
    },
    onError: (err) => alert(portalErrorMessage(err, 'Could not acknowledge the document.')),
  });

  async function downloadDoc(docId: string): Promise<void> {
    try {
      const res = await portalApi.get<{ downloadUrl: string }>(`/documents/${docId}/download-url`);
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch (err) {
      alert(portalErrorMessage(err, 'Could not get the download link.'));
    }
  }

  if (matter.isLoading) return <div style={pageStyle}><div style={emptyStyle}>Loading matter…</div></div>;
  if (matter.isError || !matter.data) {
    return (
      <div style={pageStyle}>
        <button type="button" onClick={() => navigate('/portal/dashboard')} style={btnSecondary}>← Back</button>
        <div style={emptyStyle}>{portalErrorMessage(matter.error, 'Could not load this matter.')}</div>
      </div>
    );
  }

  const { matter: m, hearings, documents } = matter.data;

  return (
    <div style={pageStyle}>
      <button type="button" onClick={() => navigate('/portal/dashboard')} style={btnSecondary}>← Back to dashboard</button>

      <header style={{ marginTop: 16, paddingBottom: 16, borderBottom: '1px solid var(--border, #e4e4e7)' }}>
        <div style={{ fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {m.type} · {m.cnr}
        </div>
        <h1 style={{ fontSize: 22, margin: '4px 0 6px' }}>{m.title}</h1>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          {m.court} · {m.stage} · <strong>{m.status}</strong>
          {m.next && <> · Next hearing {m.next}</>}
        </div>
      </header>

      <Section title="Hearings">
        {hearings.length === 0 ? (
          <Empty>No hearings on file for this matter.</Empty>
        ) : (
          <Table headers={['Date', 'Time', 'Court', 'Purpose']}>
            {hearings.map((h, i) => (
              <tr key={h.id ?? i}>
                <td>{h.date ?? '—'}</td>
                <td>{h.time}</td>
                <td>{h.court}</td>
                <td>{h.purpose}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Documents">
        {documents.length === 0 ? (
          <Empty>No documents shared on this matter.</Empty>
        ) : (
          <Table headers={['Name', 'Type', 'Updated', 'Status', '']}>
            {documents.map((doc) => {
              const needsAck = doc.requiresAck && !doc.signedAt;
              return (
                <tr key={doc.id}>
                  <td>{doc.name}</td>
                  <td>{doc.type}</td>
                  <td>{doc.updated}</td>
                  <td>
                    {doc.signedAt ? (
                      <Pill kind="ok">Acknowledged</Pill>
                    ) : doc.requiresAck ? (
                      <Pill kind="warning">Action needed</Pill>
                    ) : (
                      <span style={{ opacity: 0.5 }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                      {doc.hasFile && (
                        <button type="button" onClick={() => downloadDoc(doc.id)} style={btnLink}>
                          Download
                        </button>
                      )}
                      {needsAck && (
                        <button
                          type="button"
                          onClick={() => ack.mutate(doc.id)}
                          disabled={ack.isPending}
                          style={btnPrimary}
                        >
                          {ack.isPending && ack.variables === doc.id ? 'Signing…' : 'Acknowledge'}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      <PortalMessagesPanel matterId={m.id} />
    </div>
  );
}

// ---------- presentational helpers (kept local to avoid premature abstraction) -----

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px', fontWeight: 600 }}>{props.title}</h2>
      {props.children}
    </section>
  );
}
function Table(props: { headers: string[]; children: React.ReactNode }) {
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr>{props.headers.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}
function Empty(props: { children: React.ReactNode }) {
  return <div style={emptyStyle}>{props.children}</div>;
}
function Pill(props: { kind: 'ok' | 'warning'; children: React.ReactNode }) {
  const palette = props.kind === 'ok' ? { bg: '#dcfce7', fg: '#15803d' } : { bg: '#fef3c7', fg: '#92400e' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
      background: palette.bg, color: palette.fg,
    }}>
      {props.children}
    </span>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 980, margin: '0 auto', padding: '32px 24px 64px',
};
const tableWrap: React.CSSProperties = {
  border: '1px solid var(--border, #e4e4e7)', borderRadius: 8, overflow: 'hidden',
  background: 'var(--card, #fff)',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px',
  background: 'var(--bg, #fafafa)', borderBottom: '1px solid var(--border, #e4e4e7)',
  fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted, #71717a)',
};
const emptyStyle: React.CSSProperties = {
  padding: '16px 12px', fontSize: 14, opacity: 0.7,
  border: '1px dashed var(--border, #e4e4e7)', borderRadius: 8,
};
const btnSecondary: React.CSSProperties = {
  padding: '6px 12px', fontSize: 13, background: 'transparent',
  border: '1px solid var(--border, #d4d4d8)', borderRadius: 6, cursor: 'pointer',
};
const btnLink: React.CSSProperties = {
  padding: 0, background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--accent, #2563eb)', fontSize: 13, textDecoration: 'underline',
};
const btnPrimary: React.CSSProperties = {
  padding: '6px 12px', fontSize: 13, fontWeight: 500,
  background: 'var(--text, #18181b)', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
