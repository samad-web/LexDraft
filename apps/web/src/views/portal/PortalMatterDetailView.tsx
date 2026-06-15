import { Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CaseApplication,
  CasePipeline,
  MatterTimelineEvent,
  PortalAcknowledgeDocumentResponse,
  PortalMatterDetail,
} from '@lexdraft/types';
import { EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { PortalMessagesPanel } from './PortalMessagesPanel';
import { PipelineCanvas } from '@/components/pipeline/PipelineCanvas';
import { useAlert } from '@/components/ConfirmDialog';

/**
 * Single-matter view. Loads everything the client can see about this matter
 * in one round trip: matter metadata, hearings (past + upcoming), documents
 * (with acknowledge button when required), and the matter's message thread.
 */
export function PortalMatterDetailView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const alertDialog = useAlert();
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
    onError: (err) => {
      void alertDialog({
        title: 'Could not acknowledge the document',
        message: portalErrorMessage(err, 'Please try again.'),
        tone: 'danger',
      });
    },
  });

  async function downloadDoc(docId: string): Promise<void> {
    try {
      const res = await portalApi.get<{ downloadUrl: string }>(`/documents/${docId}/download-url`);
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch (err) {
      await alertDialog({
        title: 'Could not get the download link',
        message: portalErrorMessage(err, 'Please try again.'),
        tone: 'danger',
      });
    }
  }

  if (matter.isLoading) {
    return (
      <div style={pageStyle}>
        <Skeleton width={120} height={26} />
        <div style={{ marginTop: 16 }}><Skeleton width="60%" height={22} /></div>
        <div style={{ marginTop: 10 }}><Skeleton width="40%" height={13} /></div>
        <div style={{ marginTop: 24 }}><Skeleton width="100%" height={140} radius="md" /></div>
        <div style={{ marginTop: 16 }}><Skeleton width="100%" height={140} radius="md" /></div>
      </div>
    );
  }
  if (matter.isError || !matter.data) {
    return (
      <div style={pageStyle}>
        <button type="button" onClick={() => navigate('/portal/dashboard')} style={btnSecondary}>← Back</button>
        <div style={{ marginTop: 16 }}>
          <ErrorState
            title="Couldn't load this matter"
            description={portalErrorMessage(matter.error, 'Please try again.')}
          />
        </div>
      </div>
    );
  }

  const { matter: m, hearings, documents, pipeline, graph, applications, timeline } = matter.data;
  const hasGraph = !!graph && graph.nodes.length > 0;

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

      {hasGraph ? (
        <Section title="Where the matter stands">
          <PipelineCanvas graph={graph!} />
        </Section>
      ) : pipeline && pipeline.stages.length > 0 ? (
        <Section title="Where the matter stands">
          <PipelineStepper pipeline={pipeline} />
          {pipeline.currentIndex === -1 && (
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 8 }}>
              Your advocate is updating this matter's stage. Check back shortly.
            </div>
          )}
        </Section>
      ) : null}

      {applications && applications.length > 0 && (
        <Section title="Applications">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {applications.map((a) => (
              <PortalApplicationRow key={a.id} app={a} />
            ))}
          </div>
        </Section>
      )}

      {timeline && timeline.length > 0 && (
        <Section title="Activity">
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {timeline.map((event) => (
              <PortalTimelineRow key={event.id} event={event} />
            ))}
          </ol>
        </Section>
      )}

      <Section title="Hearings">
        {hearings.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No hearings on file"
            description="Hearings on this matter will appear here once scheduled."
          />
        ) : (
          <Table headers={['Date', 'Time', 'Court', 'Purpose']}>
            {hearings.map((h, i) => (
              <tr key={h.id ?? i}>
                <td>{h.date ?? '-'}</td>
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
          <EmptyState
            variant="inline"
            title="No documents shared"
            description="Documents your advocate shares on this matter will appear here."
          />
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
                      <span style={{ opacity: 0.5 }}>-</span>
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
function PipelineStepper({ pipeline }: { pipeline: CasePipeline }) {
  const { stages, currentIndex } = pipeline;
  return (
    <div style={{ display: 'flex', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
      {stages.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const fg = done ? '#fff' : active ? '#fff' : 'var(--muted, #71717a)';
        const bg = done ? 'var(--accent, #2563eb)' : active ? 'var(--text, #18181b)' : 'var(--bg, #fafafa)';
        const border = done || active ? 'transparent' : 'var(--border, #e4e4e7)';
        return (
          <Fragment key={s}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 96, flex: '0 0 auto' }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: bg, color: fg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                style={{
                  fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--text, #18181b)' : 'var(--muted, #71717a)',
                  whiteSpace: 'nowrap', textAlign: 'center',
                }}
              >
                {s}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div
                style={{
                  flex: 1, minWidth: 24, height: 1,
                  background: i < currentIndex ? 'var(--accent, #2563eb)' : 'var(--border, #e4e4e7)',
                  marginTop: 14,
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function PortalTimelineRow({ event }: { event: MatterTimelineEvent }) {
  const date = event.at ? event.at.slice(0, 10) : '';
  const palette: Record<MatterTimelineEvent['kind'], string> = {
    stage: '#15803d',
    hearing: '#2563eb',
    document: '#b45309',
    application: '#7c3aed',
    note: '#71717a',
  };
  return (
    <li
      style={{
        display: 'flex', gap: 14, padding: '12px 14px', marginBottom: 8,
        border: '1px solid var(--border, #e4e4e7)', borderRadius: 8,
        borderLeft: `3px solid ${palette[event.kind] ?? '#71717a'}`,
        background: 'var(--card, #fff)',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted, #71717a)', minWidth: 80, paddingTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {date}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted, #71717a)', marginBottom: 4 }}>
          {event.kind}
          {event.actorName && <> · {event.actorName}</>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: event.body ? 4 : 0 }}>{event.title}</div>
        {event.body && <div style={{ fontSize: 13, opacity: 0.75 }}>{event.body}</div>}
      </div>
    </li>
  );
}

const APP_KIND_LABEL: Record<CaseApplication['kind'], string> = {
  ia: 'Interim Application', appeal: 'Appeal', execution: 'Execution',
  review: 'Review', bail: 'Bail', other: 'Application',
};
const APP_STATUS_COLOR: Record<CaseApplication['status'], string> = {
  pending: '#b45309', allowed: '#15803d', dismissed: '#b3261e',
  withdrawn: '#71717a', disposed: '#2563eb',
};

function PortalApplicationRow({ app }: { app: CaseApplication }) {
  const color = APP_STATUS_COLOR[app.status];
  return (
    <div
      style={{
        display: 'flex', gap: 14, alignItems: 'center', padding: '12px 14px',
        border: '1px solid var(--border, #e4e4e7)', borderRadius: 8,
        borderLeft: `3px solid ${color}`, background: 'var(--card, #fff)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--muted, #71717a)', marginBottom: 4 }}>
          {APP_KIND_LABEL[app.kind]}
          {app.appType && <> · {app.appType}</>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{app.label || APP_KIND_LABEL[app.kind]}</div>
        {(app.filedOn || app.orderOn) && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {app.filedOn && <>Filed {app.filedOn}</>}
            {app.filedOn && app.orderOn && <> · </>}
            {app.orderOn && <>Order {app.orderOn}</>}
          </div>
        )}
      </div>
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
        fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
        color, border: `1px solid ${color}`,
      }}>
        {app.status}
      </span>
    </div>
  );
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
