import { PortalMessagesPanel } from './PortalMessagesPanel';
import { portalStrings as t } from './strings';

/**
 * Standalone view for the per-client "general" thread (matterId = null).
 * Per CLIENT_PORTAL.md §4.7: every client gets one general thread plus one
 * thread per matter; matter threads live inside the matter detail view.
 */
export function PortalMessagesView() {
  return (
    <div style={pageStyle}>
      <header style={{ paddingBottom: 12, borderBottom: '1px solid var(--border, #e4e4e7)' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t.messagesGeneralTitle}</h1>
        <p style={{ fontSize: 13, opacity: 0.7, margin: 0, maxWidth: 640 }}>
          {t.messagesGeneralIntro}
        </p>
      </header>
      <PortalMessagesPanel matterId={null} />
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 980, margin: '0 auto', padding: '32px 24px 64px',
};
