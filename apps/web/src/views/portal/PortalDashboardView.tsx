import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PortalDashboard } from '@lexdraft/types';
import { EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { usePortalAuthStore } from '@/store/portalAuth';
import { portalStrings as t } from './strings';
import { useAlert } from '@/components/ConfirmDialog';

/**
 * Read-mostly client dashboard. One round trip to `/portal/dashboard` returns
 * the counts strip, top matters, hearings, recent documents, and unpaid
 * invoices - per CLIENT_PORTAL.md §4.2 the dashboard must paint in a single
 * fetch, not five.
 */
export function PortalDashboardView() {
  const navigate = useNavigate();
  const client = usePortalAuthStore((s) => s.client);
  const alertDialog = useAlert();

  const dashboard = useQuery({
    queryKey: ['portal', 'dashboard'],
    queryFn: () => portalApi.get<PortalDashboard>('/dashboard'),
    enabled: !!client,
    refetchOnWindowFocus: true,
  });

  async function downloadDoc(id: string): Promise<void> {
    try {
      const res = await portalApi.get<{ downloadUrl: string }>(`/documents/${id}/download-url`);
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch (err) {
      await alertDialog({
        title: t.errDownload,
        message: portalErrorMessage(err, 'Please try again.'),
        tone: 'danger',
      });
    }
  }

  if (dashboard.isLoading) {
    return (
      <div style={pageStyle}>
        <Skeleton width={220} height={22} />
        <div style={{ marginTop: 10 }}><Skeleton width={160} height={13} /></div>
        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ flex: '1 1 140px', minWidth: 140 }}>
              <Skeleton width="60%" height={11} />
              <div style={{ marginTop: 8 }}><Skeleton width={48} height={26} /></div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 28 }}>
          <Skeleton width="100%" height={120} radius="md" />
        </div>
      </div>
    );
  }
  if (dashboard.isError || !dashboard.data) {
    return (
      <div style={pageStyle}>
        <ErrorState
          title={t.dashboardError}
          description={portalErrorMessage(dashboard.error, 'Please try again.')}
        />
      </div>
    );
  }

  const d = dashboard.data;

  return (
    <div style={pageStyle}>
      <header style={{ paddingBottom: 12, borderBottom: '1px solid var(--border, #e4e4e7)' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{d.client.name}</h1>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{d.client.email}</div>
      </header>

      <CountsStrip counts={d.counts} />

      <Section title="Your matters">
        {d.matters.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No active matters yet"
            description="When your advocate adds a matter, it'll show up here."
          />
        ) : (
          <Table headers={['Title', 'CNR', 'Court', 'Stage', 'Status', 'Next hearing', '']}>
            {d.matters.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{c.cnr}</td>
                <td>{c.court}</td>
                <td>{c.stage}</td>
                <td>{c.status}</td>
                <td>{c.next || '-'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => navigate(`/portal/matters/${c.id}`)}
                    style={btnLink}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Upcoming hearings">
        {d.hearings.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No upcoming hearings"
            description="Hearings will appear here once they're scheduled."
          />
        ) : (
          <Table headers={['Date', 'Time', 'Case', 'Court', 'Purpose']}>
            {d.hearings.map((h, i) => (
              <tr key={h.id ?? i}>
                <td>{h.date ?? '-'}</td>
                <td>{h.time}</td>
                <td>{h.case}</td>
                <td>{h.court}</td>
                <td>{h.purpose}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Recent documents">
        {d.documents.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No documents shared with you"
            description="Your advocate will share signed orders, drafts, and other files here."
          />
        ) : (
          <Table headers={['Name', 'Case', 'Type', 'Updated', '']}>
            {d.documents.map((doc) => (
              <tr key={doc.id}>
                <td>
                  {doc.name}
                  {doc.requiresAck && !doc.signedAt && <Pill kind="warning">Action needed</Pill>}
                  {doc.signedAt && <Pill kind="ok">Acknowledged</Pill>}
                </td>
                <td>{doc.case}</td>
                <td>{doc.type}</td>
                <td>{doc.updated}</td>
                <td style={{ textAlign: 'right' }}>
                  {doc.hasFile ? (
                    <button type="button" onClick={() => downloadDoc(doc.id)} style={btnLink}>
                      Download
                    </button>
                  ) : (
                    <span style={{ opacity: 0.5 }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Invoices">
        {d.invoices.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No invoices yet"
            description="Bills from your advocate will appear here when issued."
          />
        ) : (
          <Table headers={['Invoice #', 'Issued', 'Due', 'Amount (₹)', 'Status']}>
            {d.invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.invoiceNo}</td>
                <td>{inv.issuedDate}</td>
                <td>{inv.dueDate}</td>
                <td style={{ textAlign: 'right' }}>
                  {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
                    .format(inv.amountInr)}
                </td>
                <td>
                  <span style={{
                    ...statusPill,
                    background:
                      inv.status === 'paid'    ? '#dcfce7'
                    : inv.status === 'overdue' ? '#fee2e2'
                    :                            '#fef9c3',
                    color:
                      inv.status === 'paid'    ? '#15803d'
                    : inv.status === 'overdue' ? '#b91c1c'
                    :                            '#a16207',
                  }}>
                    {inv.status}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

// ---------- presentational helpers -------------------------------------------

function CountsStrip(props: { counts: PortalDashboard['counts'] }) {
  const items: Array<{ label: string; value: number; emphasise?: boolean }> = [
    { label: 'Active matters', value: props.counts.activeMatters },
    { label: 'Upcoming hearings', value: props.counts.upcomingHearings },
    { label: 'Documents to sign', value: props.counts.documentsToSign, emphasise: props.counts.documentsToSign > 0 },
    { label: 'Open invoices', value: props.counts.openInvoices },
    { label: 'Unread messages', value: props.counts.unreadMessages, emphasise: props.counts.unreadMessages > 0 },
  ];
  return (
    <section style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <div key={it.label} style={{ ...countCard, borderColor: it.emphasise ? '#fde68a' : 'var(--border, #e4e4e7)' }}>
          <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{it.label}</div>
          <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{it.value}</div>
        </div>
      ))}
    </section>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px', fontWeight: 600 }}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function Pill(props: { kind: 'ok' | 'warning'; children: React.ReactNode }) {
  const palette = props.kind === 'ok'
    ? { bg: '#dcfce7', fg: '#15803d' }
    : { bg: '#fef3c7', fg: '#92400e' };
  return (
    <span style={{
      ...statusPill, background: palette.bg, color: palette.fg, marginLeft: 8,
    }}>
      {props.children}
    </span>
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

const pageStyle: React.CSSProperties = {
  maxWidth: 980, margin: '0 auto', padding: '32px 24px 64px',
};
const tableWrap: React.CSSProperties = {
  border: '1px solid var(--border, #e4e4e7)', borderRadius: 8,
  // Horizontal scroll when narrow (phones) so columns don't squish into
  // unreadable stacks. Vertical clip is fine — tables paginate elsewhere.
  overflowX: 'auto',
  overflowY: 'hidden',
  background: 'var(--card, #fff)',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
  // Minimum width to keep the layout legible — the wrap container above
  // takes the slack with a scrollbar on narrower viewports.
  minWidth: 600,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px',
  background: 'var(--bg, #fafafa)', borderBottom: '1px solid var(--border, #e4e4e7)',
  fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted, #71717a)',
};
const btnLink: React.CSSProperties = {
  padding: 0, background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--accent, #2563eb)', fontSize: 13, textDecoration: 'underline',
};
const statusPill: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
};
const countCard: React.CSSProperties = {
  flex: '1 1 140px', minWidth: 140, padding: '12px 14px',
  border: '1px solid var(--border, #e4e4e7)', borderRadius: 8,
  background: 'var(--card, #fff)',
};
