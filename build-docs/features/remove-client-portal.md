# Remove client portal + client messages

## Purpose
Owner decision (2026-11-16): only advocates use DifAi. No client sign-in, no client messages.
Also closes a security gap: portal passwords were `firstname@123` (guessable), no change-password, no sign-in lockout.

## Live usage at decision time
1 client with portal access (sayed), 0 portal messages, 0 portal sessions, 0 documents shared with clients.

## Scope
Delete (client-portal only):
- API: routes/portal.routes.ts, routes/portal-admin.routes.ts, middleware/portalAuth.ts, services/portal.service.ts, services/portal-plan-gate.ts, their test portal.test.ts.
- Web: views/portal/* (9 files), views/PortalInboxView.tsx, hooks/usePortalAdmin.ts, lib/portalApi.ts, store/portalAuth.ts, components/pipeline/PipelineCanvas.tsx (only used by the portal).
- Docs: CLIENT_PORTAL.md.
Edit:
- routes/index.ts (mounts), env.ts + .env.docker (CLIENT_PORTAL_* vars), notifications.service.ts (client-portal emails), dashboard-today.service.ts (unread client messages count), audit.service.ts (client-actor join).
- hearings.routes.ts / invoices.routes.ts: drop the "email the client" step (only fired for portal clients; text says "sign in to your portal"; SMTP is not set on prod anyway).
- Web: App.tsx routes, nav "Client Messages", dashboard "Client messages" KPI/attention slot, ClientsView Portal column + KPI tile, ClientDetailView pill, CaseDetailView "Visible to client", DocumentsView "Shared"/"Ack req'd" columns, NewApplicationModal "Visible on client portal", ApplicationsPanel label, hint copy, CSS for portal/inbox, robots.txt.
- Shared types: portal-only types and the clientMessages attention key.

## Kept on purpose
- Database: no tables or columns dropped (no data loss, no live migration). Columns like clients.portal_enabled, documents.shared_with_client, cases.visible_to_client stay but nothing reads them for clients. Schema cleanup can be a later migration if wanted.
- Pass-through of visible_to_client / visible_to_portal in cases/pipeline services (harmless; avoids touching integration tests).
- Team Chat, matter chat, secure share links, WhatsApp share: unrelated, unchanged.
- Old portal.* rows in audit_log stay as history.

## Impact / what could break
- Advocate dashboard: must drop the portal_messages count cleanly (else empty slot or SQL error if table ever dropped).
- Clients grid: 4-tile KPI row becomes 3; table colSpans 7→6; Documents colSpan 8→6.
- /portal URLs: no route → nginx still serves the app shell (portal stays in the SPA list) → app shows its normal not-found / redirects to sign-in.

## Edge cases
- sayed's existing access: ends when the API routes are gone (any portal token is rejected: route doesn't exist).
- Bookmarked /portal links: land on the app's fallback, no error page loop.

## Acceptance criteria
- No /api/portal* or /api/portal-admin* route (404).
- No Portal column, Client Messages nav, client-message KPI, visibility/share toggles in the advocate UI.
- Dashboard, Clients, Documents, Case detail, Applications load without errors.
- Full web + API suites pass (except the known pre-existing anthropic-failover test); tsc clean.
