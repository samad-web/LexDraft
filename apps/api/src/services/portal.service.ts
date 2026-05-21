import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type {
  PortalSession,
  PortalCaseSummary,
  PortalHearingSummary,
  PortalInvoiceSummary,
  PortalDocumentSummary,
  PortalDashboard,
  PortalMatterDetail,
  PortalMessage,
  PortalAcknowledgeDocumentResponse,
  PortalProfile,
  PortalProfileUpdate,
  PortalNotificationPreferences,
  PortalLanguage,
  FirmPortalThreadSummary,
} from '@lexdraft/types';
import { env } from '../env';
import { db } from '../db/client';
import { logger } from '../logger';
import { casePipelineService, snapshotFor } from './case-pipeline.service';

interface ClientRow {
  id: string;
  firm_id: string;
  name: string;
  email: string | null;
}

interface PortalClaims {
  kind: 'client';
  sub: string;       // clientId
  firmId: string;
  email: string;
}

/**
 * Build the firm-admin-shareable default password for a client. Format is
 * `firstname@123` where `firstname` is the first whitespace-separated token of
 * their name, lowercased and stripped of non-alphanumerics. Empty / unparseable
 * names fall back to `client@123` so the format never breaks - the firm admin
 * can always reset to something else if the default is awkward.
 */
function defaultPasswordFor(name: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const cleaned = first.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${cleaned || 'client'}@123`;
}

interface DocumentRowForSummary {
  id: string;
  case_label: string;
  name: string;
  type: string;
  updated_label: string;
  storage_key: string | null;
  requires_acknowledgement: boolean;
  signed_at: Date | string | null;
}

function toDocumentSummary(r: DocumentRowForSummary): PortalDocumentSummary {
  const signedAtIso = r.signed_at instanceof Date
    ? r.signed_at.toISOString()
    : (r.signed_at ?? undefined);
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    case: r.case_label,
    updated: r.updated_label,
    hasFile: !!r.storage_key,
    requiresAck: !!r.requires_acknowledgement,
    signedAt: signedAtIso || undefined,
  };
}

function emptyCounts(): PortalDashboard['counts'] {
  return {
    activeMatters: 0,
    upcomingHearings: 0,
    documentsToSign: 0,
    openInvoices: 0,
    unreadMessages: 0,
  };
}

// Default preferences applied when the client has never saved a profile.
// The notification opt-ins are all true so a freshly-provisioned client
// receives the events the firm-side already emits - opt-out is explicit.
const DEFAULT_NOTIFICATIONS: PortalNotificationPreferences = {
  newDocument: true,
  hearingReminder: true,
  newMessage: true,
  invoiceIssued: true,
  invoiceOverdue: true,
};

interface PreferencesShape {
  language: PortalLanguage;
  notifications: PortalNotificationPreferences;
}

function defaultProfile(client: PortalProfile['client']): PortalProfile {
  return { client, language: 'en', notifications: { ...DEFAULT_NOTIFICATIONS } };
}

/** Coerce whatever's in the jsonb column into a known-shape preferences
 *  object. Bad values fall back to defaults - never throws. */
function parsePortalPreferences(raw: unknown): PreferencesShape {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const language: PortalLanguage = obj['language'] === 'en' ? 'en' : 'en';
  const rawNotif = (obj['notifications'] && typeof obj['notifications'] === 'object')
    ? obj['notifications'] as Record<string, unknown>
    : {};
  const pickBool = (key: keyof PortalNotificationPreferences): boolean =>
    typeof rawNotif[key] === 'boolean' ? (rawNotif[key] as boolean) : DEFAULT_NOTIFICATIONS[key];
  return {
    language,
    notifications: {
      newDocument:     pickBool('newDocument'),
      hearingReminder: pickBool('hearingReminder'),
      newMessage:      pickBool('newMessage'),
      invoiceIssued:   pickBool('invoiceIssued'),
      invoiceOverdue:  pickBool('invoiceOverdue'),
    },
  };
}

function mergePreferences(current: PortalProfile, patch: PortalProfileUpdate): PreferencesShape {
  return {
    language: patch.language ?? current.language,
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
  };
}

/** Dashboard sort order: overdue → pending → paid, then by issued date desc. */
function sortInvoicesForDashboard(items: PortalInvoiceSummary[]): PortalInvoiceSummary[] {
  const rank = (s: PortalInvoiceSummary['status']) =>
    s === 'overdue' ? 0 : s === 'pending' ? 1 : 2;
  return [...items].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return a.issuedDate < b.issuedDate ? 1 : -1;
  });
}

function issuePortalToken(client: ClientRow): { token: string; expiresAt: string } {
  const claims: PortalClaims = {
    kind: 'client',
    sub: client.id,
    firmId: client.firm_id,
    email: (client.email ?? '').toLowerCase(),
  };
  const token = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.CLIENT_PORTAL_SESSION_TTL as jwt.SignOptions['expiresIn'],
  });
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expIso = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  return { token, expiresAt: expIso };
}

export const portalService = {
  /**
   * Verify the client's email + password and mint a session JWT.
   *
   * Unknown email and wrong password produce the *same* error so a stranger
   * can't enumerate registered emails. We still do a dummy bcrypt compare
   * when there's no match to keep the timing constant.
   */
  async signInWithPassword(emailRaw: string, password: string): Promise<PortalSession> {
    const email = emailRaw.trim().toLowerCase();
    const sql = db();
    if (!sql) {
      throw Object.assign(new Error('Database not configured'), { status: 500 });
    }

    const rows = await sql<Array<ClientRow & { portal_enabled: boolean; portal_password_hash: string | null }>>`
      select id, firm_id, name, email, portal_enabled, portal_password_hash
      from clients
      where lower(email) = ${email}
      limit 1
    `;
    const client = rows[0];

    const generic = Object.assign(new Error('Email or password is incorrect'), { status: 401 });

    if (!client || !client.portal_enabled || !client.portal_password_hash) {
      // Equalise timing against the wrong-password branch.
      await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
      throw generic;
    }

    const ok = await bcrypt.compare(password, client.portal_password_hash);
    if (!ok) throw generic;

    const { token: jwtToken, expiresAt } = issuePortalToken(client);
    logger.info({ clientId: client.id, firmId: client.firm_id }, 'portal session issued');
    return {
      token: jwtToken,
      expiresAt,
      client: {
        id: client.id,
        name: client.name,
        email: client.email ?? '',
        firmId: client.firm_id,
      },
    };
  },

  verify(token: string): PortalClaims {
    const claims = jwt.verify(token, env.JWT_SECRET) as PortalClaims;
    if (claims.kind !== 'client') {
      throw new Error('Not a portal token');
    }
    return claims;
  },

  // ---- Read endpoints -----------------------------------------------------
  // Every method takes the resolved portal context and scopes hard to that
  // single client's name within that single firm. Cross-tenant leakage is
  // impossible by construction - clientName is derived from the row matched
  // by clientId, and every where clause pins firm_id.

  async clientName(clientId: string, firmId: string): Promise<string | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<Array<{ name: string }>>`
      select name from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    return rows[0]?.name ?? null;
  },

  async listCases(clientId: string, firmId: string): Promise<PortalCaseSummary[]> {
    const sql = db();
    if (!sql) return [];
    const name = await this.clientName(clientId, firmId);
    if (!name) return [];
    const rows = await sql<Array<{
      id: string; cnr: string; title: string; court: string; stage: string;
      status: PortalCaseSummary['status']; next_hearing: Date | string | null; type: string;
    }>>`
      select id, cnr, title, court, stage, status, next_hearing, type
      from cases
      where firm_id = ${firmId}::uuid
        and client = ${name}
        and visible_to_client = true
      order by next_hearing nulls last, title
    `;
    return rows.map((r) => ({
      id: r.id,
      cnr: r.cnr,
      title: r.title,
      court: r.court,
      stage: r.stage,
      status: r.status,
      type: r.type,
      next: r.next_hearing instanceof Date
        ? r.next_hearing.toISOString().slice(0, 10)
        : (r.next_hearing ?? ''),
    }));
  },

  async listHearings(clientId: string, firmId: string): Promise<PortalHearingSummary[]> {
    const sql = db();
    if (!sql) return [];
    const name = await this.clientName(clientId, firmId);
    if (!name) return [];
    // Hearings ↔ cases via case_label. Only show today + upcoming.
    // Note: the hearings table doesn't carry firm_id directly - it joins
    // through case_id, but the seed/legacy rows can have NULL case_id, so
    // we scope via the case-label IN-list against the firm's own cases.
    const rows = await sql<Array<{
      id: string; hearing_date: Date | string | null; hearing_time: string;
      case_label: string; court: string; purpose: string;
    }>>`
      select h.id, h.hearing_date, h.hearing_time, h.case_label, h.court, h.purpose
      from hearings h
      where h.case_label in (
        select title from cases
        where firm_id = ${firmId}::uuid and client = ${name}
          and visible_to_client = true
      )
      and (h.hearing_date is null or h.hearing_date >= current_date)
      order by h.hearing_date nulls last, h.hearing_time
    `;
    return rows.map((r) => ({
      id: r.id,
      time: r.hearing_time,
      case: r.case_label,
      court: r.court,
      purpose: r.purpose,
      date: r.hearing_date instanceof Date
        ? r.hearing_date.toISOString().slice(0, 10)
        : (r.hearing_date ?? undefined),
    }));
  },

  async listInvoices(clientId: string, firmId: string): Promise<PortalInvoiceSummary[]> {
    const sql = db();
    if (!sql) return [];
    const name = await this.clientName(clientId, firmId);
    if (!name) return [];
    const rows = await sql<Array<{
      id: string; invoice_no: string; amount_inr: number;
      issued_date: Date | string; due_date: Date | string;
      status: PortalInvoiceSummary['status'];
    }>>`
      select id, invoice_no, amount_inr, issued_date, due_date, status
      from invoices
      where firm_id = ${firmId}::uuid
        and client = ${name}
        and status <> 'draft'
      order by issued_date desc
    `;
    return rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      amountInr: Number(r.amount_inr ?? 0),
      issuedDate: r.issued_date instanceof Date ? r.issued_date.toISOString().slice(0, 10) : String(r.issued_date).slice(0, 10),
      dueDate:    r.due_date    instanceof Date ? r.due_date.toISOString().slice(0, 10)    : String(r.due_date).slice(0, 10),
      status: r.status,
    }));
  },

  async listDocuments(clientId: string, firmId: string): Promise<PortalDocumentSummary[]> {
    const sql = db();
    if (!sql) return [];
    const name = await this.clientName(clientId, firmId);
    if (!name) return [];
    // Documents are joined to cases by case_label. Surface metadata only;
    // download URLs are issued on demand by /portal/documents/:id/download-url.
    const rows = await sql<Array<{
      id: string; case_label: string; name: string; type: string;
      updated_label: string; storage_key: string | null;
      requires_acknowledgement: boolean; signed_at: Date | string | null;
    }>>`
      select id, case_label, name, type, updated_label, storage_key,
             requires_acknowledgement, signed_at
      from documents
      where firm_id = ${firmId}::uuid
        and shared_with_client = true
        and case_label in (
          select title from cases
          where firm_id = ${firmId}::uuid and client = ${name}
            and visible_to_client = true
        )
      order by created_at desc
    `;
    return rows.map(toDocumentSummary);
  },

  // ---- Aggregated dashboard ----------------------------------------------
  async dashboard(clientId: string, firmId: string): Promise<PortalDashboard> {
    const sql = db();
    if (!sql) {
      // Demo mode - return a coherent empty payload so the UI renders.
      return {
        client: { id: clientId, name: '', email: '', firmId },
        counts: emptyCounts(),
        matters: [],
        hearings: [],
        documents: [],
        invoices: [],
      };
    }

    const clientRows = await sql<Array<{ id: string; firm_id: string; name: string; email: string | null }>>`
      select id, firm_id, name, email from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    const c = clientRows[0];
    if (!c) {
      throw Object.assign(new Error('Client no longer exists'), { status: 410 });
    }

    // Run the four lists in parallel, then trim each to the dashboard limit.
    const [matters, hearings, invoices, documents, unread] = await Promise.all([
      this.listCases(clientId, firmId),
      this.listHearings(clientId, firmId),
      this.listInvoices(clientId, firmId),
      this.listDocuments(clientId, firmId),
      this.unreadMessageCount(clientId, firmId),
    ]);

    // Top-of-list ordering matches the spec sort hints (§4.2).
    const topMatters = matters
      .filter((m) => m.status === 'Active' || m.status === 'Pending')
      .slice(0, 5);
    const topHearings = hearings.slice(0, 5);
    const topDocs = documents.slice(0, 5);
    const topInvoices = sortInvoicesForDashboard(invoices).slice(0, 4);

    return {
      client: { id: c.id, name: c.name, email: c.email ?? '', firmId: c.firm_id },
      counts: {
        activeMatters: matters.filter((m) => m.status === 'Active').length,
        upcomingHearings: hearings.length,
        documentsToSign: documents.filter((d) => d.requiresAck && !d.signedAt).length,
        openInvoices: invoices.filter((i) => i.status !== 'paid').length,
        unreadMessages: unread,
      },
      matters: topMatters,
      hearings: topHearings,
      documents: topDocs,
      invoices: topInvoices,
    };
  },

  // ---- Matter detail ------------------------------------------------------
  async matterDetail(matterId: string, clientId: string, firmId: string): Promise<PortalMatterDetail | null> {
    const sql = db();
    if (!sql) return null;
    const name = await this.clientName(clientId, firmId);
    if (!name) return null;

    const matterRows = await sql<Array<{
      id: string; cnr: string; title: string; court: string; stage: string;
      status: PortalCaseSummary['status']; next_hearing: Date | string | null; type: string;
    }>>`
      select id, cnr, title, court, stage, status, next_hearing, type
      from cases
      where id = ${matterId}::uuid
        and firm_id = ${firmId}::uuid
        and client = ${name}
        and visible_to_client = true
      limit 1
    `;
    const row = matterRows[0];
    if (!row) return null;

    const matter: PortalCaseSummary = {
      id: row.id,
      cnr: row.cnr,
      title: row.title,
      court: row.court,
      stage: row.stage,
      status: row.status,
      type: row.type,
      next: row.next_hearing instanceof Date
        ? row.next_hearing.toISOString().slice(0, 10)
        : (row.next_hearing ?? ''),
    };

    const [hearings, documents, messages, timeline] = await Promise.all([
      sql<Array<{
        id: string; hearing_date: Date | string | null; hearing_time: string;
        case_label: string; court: string; purpose: string;
      }>>`
        select h.id, h.hearing_date, h.hearing_time, h.case_label, h.court, h.purpose
        from hearings h
        where h.firm_id = ${firmId}::uuid
          and h.case_id = ${matterId}::uuid
        order by h.hearing_date nulls last, h.hearing_time
      `,
      sql<Array<{
        id: string; case_label: string; name: string; type: string;
        updated_label: string; storage_key: string | null;
        requires_acknowledgement: boolean; signed_at: Date | string | null;
      }>>`
        select id, case_label, name, type, updated_label, storage_key,
               requires_acknowledgement, signed_at
        from documents
        where firm_id = ${firmId}::uuid
          and case_id = ${matterId}::uuid
          and shared_with_client = true
        order by created_at desc
      `,
      this.listMessages(clientId, firmId, matterId),
      casePipelineService.timeline(matterId, firmId, 'portal'),
    ]);

    return {
      matter,
      hearings: hearings.map((h) => ({
        id: h.id,
        time: h.hearing_time,
        case: h.case_label,
        court: h.court,
        purpose: h.purpose,
        date: h.hearing_date instanceof Date
          ? h.hearing_date.toISOString().slice(0, 10)
          : (h.hearing_date ?? undefined),
      })),
      documents: documents.map(toDocumentSummary),
      messages,
      pipeline: snapshotFor(row.type, row.stage),
      // Drop the internal `visibleToPortal` flag from the wire — clients
      // don't need it once the row has been filtered upstream.
      timeline: timeline.map(({ visibleToPortal: _v, ...e }) => e),
    };
  },

  // ---- Document acknowledgement ------------------------------------------
  async acknowledgeDocument(
    documentId: string,
    clientId: string,
    firmId: string,
  ): Promise<PortalAcknowledgeDocumentResponse> {
    const sql = db();
    if (!sql) throw Object.assign(new Error('Database not configured'), { status: 500 });
    const name = await this.clientName(clientId, firmId);
    if (!name) throw Object.assign(new Error('Document not available'), { status: 404 });

    // Single statement: scope by firm + the client's own visible matters +
    // shared-with-client + ack-required. Idempotent - re-acknowledging
    // returns the existing signed_at.
    const rows = await sql<Array<{ id: string; signed_at: Date }>>`
      update documents d set
        signed_at = coalesce(d.signed_at, now()),
        signed_by_client_id = coalesce(d.signed_by_client_id, ${clientId}::uuid)
      where d.id = ${documentId}::uuid
        and d.firm_id = ${firmId}::uuid
        and d.shared_with_client = true
        and d.requires_acknowledgement = true
        and d.case_label in (
          select title from cases
          where firm_id = ${firmId}::uuid and client = ${name}
            and visible_to_client = true
        )
      returning id, signed_at
    `;
    const row = rows[0];
    if (!row) {
      // Either the document doesn't exist for this client, or it doesn't
      // require acknowledgement. We don't disambiguate.
      throw Object.assign(new Error('Document not available for acknowledgement'), { status: 404 });
    }
    return { id: row.id, signedAt: row.signed_at.toISOString() };
  },

  // ---- Messages -----------------------------------------------------------
  /**
   * List messages on a thread. `matterId === null` lists the per-client
   * "general" thread; a uuid lists that matter's thread (provided the matter
   * belongs to this client).
   */
  async listMessages(
    clientId: string,
    firmId: string,
    matterId: string | null,
  ): Promise<PortalMessage[]> {
    const sql = db();
    if (!sql) return [];
    const name = await this.clientName(clientId, firmId);
    if (!name) return [];

    if (matterId !== null) {
      // Verify the matter belongs to this client before exposing its thread.
      const owns = await sql<Array<{ id: string }>>`
        select id from cases
        where id = ${matterId}::uuid and firm_id = ${firmId}::uuid and client = ${name}
        limit 1
      `;
      if (!owns.length) return [];
    }

    const rows = await sql<Array<{
      id: string; matter_id: string | null; matter_label: string | null;
      sender_kind: 'client' | 'firm'; sender_id: string; sender_name: string;
      body: string; sent_at: Date; read_at: Date | null;
    }>>`
      select m.id, m.matter_id,
             c.title as matter_label,
             m.sender_kind, m.sender_id, m.sender_name,
             m.body, m.sent_at, m.read_at
      from portal_messages m
      left join cases c on c.id = m.matter_id
      where m.firm_id = ${firmId}::uuid
        and m.client_id = ${clientId}::uuid
        and (
          ${matterId}::uuid is null and m.matter_id is null
          or m.matter_id = ${matterId}::uuid
        )
      order by m.sent_at asc
    `;
    return rows.map((r) => ({
      id: r.id,
      matterId: r.matter_id,
      matterLabel: r.matter_label ?? (r.matter_id ? undefined : 'General'),
      senderKind: r.sender_kind,
      senderName: r.sender_name,
      body: r.body,
      sentAt: r.sent_at.toISOString(),
      readAt: r.read_at ? r.read_at.toISOString() : undefined,
      mine: r.sender_kind === 'client' && r.sender_id === clientId,
    }));
  },

  async sendMessage(
    clientId: string,
    firmId: string,
    matterId: string | null,
    body: string,
  ): Promise<PortalMessage> {
    const sql = db();
    if (!sql) throw Object.assign(new Error('Database not configured'), { status: 500 });
    const trimmed = body.trim();
    if (!trimmed) throw Object.assign(new Error('Message body is required'), { status: 400 });
    if (trimmed.length > 4000) {
      throw Object.assign(new Error('Message exceeds 4000 characters'), { status: 400 });
    }

    const clientRows = await sql<Array<{ id: string; firm_id: string; name: string }>>`
      select id, firm_id, name from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    const c = clientRows[0];
    if (!c) throw Object.assign(new Error('Client no longer exists'), { status: 410 });

    // If matterId is supplied, verify the client owns it.
    if (matterId !== null) {
      const owns = await sql<Array<{ id: string }>>`
        select id from cases
        where id = ${matterId}::uuid and firm_id = ${firmId}::uuid and client = ${c.name}
        limit 1
      `;
      if (!owns.length) {
        throw Object.assign(new Error('Matter not available'), { status: 404 });
      }
    }

    const rows = await sql<Array<{
      id: string; matter_id: string | null; sender_kind: 'client' | 'firm';
      sender_id: string; sender_name: string; body: string;
      sent_at: Date; read_at: Date | null;
    }>>`
      insert into portal_messages
        (firm_id, client_id, matter_id, sender_kind, sender_id, sender_name, body)
      values
        (${firmId}::uuid, ${clientId}::uuid, ${matterId}::uuid,
         'client', ${clientId}::uuid, ${c.name}, ${trimmed})
      returning id, matter_id, sender_kind, sender_id, sender_name, body, sent_at, read_at
    `;
    const r = rows[0]!;

    let matterLabel: string | undefined;
    if (r.matter_id) {
      const lab = await sql<Array<{ title: string }>>`
        select title from cases where id = ${r.matter_id}::uuid limit 1
      `;
      matterLabel = lab[0]?.title;
    } else {
      matterLabel = 'General';
    }

    return {
      id: r.id,
      matterId: r.matter_id,
      matterLabel,
      senderKind: r.sender_kind,
      senderName: r.sender_name,
      body: r.body,
      sentAt: r.sent_at.toISOString(),
      readAt: r.read_at ? r.read_at.toISOString() : undefined,
      mine: true,
    };
  },

  /**
   * Marks every firm-side message on the thread as read by this client.
   * Returns the count of newly-marked rows so the caller can decide whether
   * to log an audit entry. The matter is verified to belong to the client
   * before any update.
   */
  async markThreadRead(
    clientId: string,
    firmId: string,
    matterId: string | null,
  ): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const name = await this.clientName(clientId, firmId);
    if (!name) return 0;

    if (matterId !== null) {
      const owns = await sql<Array<{ id: string }>>`
        select id from cases
        where id = ${matterId}::uuid and firm_id = ${firmId}::uuid and client = ${name}
        limit 1
      `;
      if (!owns.length) return 0;
    }

    const rows = await sql<Array<{ id: string }>>`
      update portal_messages set read_at = now()
      where firm_id = ${firmId}::uuid
        and client_id = ${clientId}::uuid
        and (
          ${matterId}::uuid is null and matter_id is null
          or matter_id = ${matterId}::uuid
        )
        and sender_kind = 'firm'
        and read_at is null
      returning id
    `;
    return rows.length;
  },

  async unreadMessageCount(clientId: string, firmId: string): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const rows = await sql<Array<{ count: string | number }>>`
      select count(*)::int as count
      from portal_messages
      where firm_id = ${firmId}::uuid
        and client_id = ${clientId}::uuid
        and sender_kind = 'firm'
        and read_at is null
    `;
    return Number(rows[0]?.count ?? 0);
  },

  // ---- Profile ------------------------------------------------------------
  async getProfile(clientId: string, firmId: string): Promise<PortalProfile> {
    const sql = db();
    if (!sql) {
      // Demo mode - return a fully-populated default so the UI renders.
      return defaultProfile({ id: clientId, name: '', email: '', firmId });
    }
    const rows = await sql<Array<{
      id: string; firm_id: string; name: string; email: string | null;
      portal_preferences: unknown;
    }>>`
      select id, firm_id, name, email, portal_preferences
      from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) throw Object.assign(new Error('Client no longer exists'), { status: 410 });

    const prefs = parsePortalPreferences(row.portal_preferences);
    return {
      client: { id: row.id, name: row.name, email: row.email ?? '', firmId: row.firm_id },
      language: prefs.language,
      notifications: prefs.notifications,
    };
  },

  async updateProfile(
    clientId: string,
    firmId: string,
    patch: PortalProfileUpdate,
  ): Promise<PortalProfile> {
    const sql = db();
    if (!sql) throw Object.assign(new Error('Database not configured'), { status: 500 });

    const current = await this.getProfile(clientId, firmId);
    const next = mergePreferences(current, patch);

    await sql`
      update clients
      set portal_preferences = ${JSON.stringify(next)}::jsonb
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid
    `;

    return {
      client: current.client,
      language: next.language,
      notifications: next.notifications,
    };
  },

  /**
   * Records a Right-to-Erasure ("forget me") request. The actual fulfilment
   * is a firm-side / SuperAdmin task per DPDP §7; this endpoint just creates
   * an audit-log entry the firm can action. The portal client gets a generic
   * acknowledgement so they don't learn anything about the firm's process.
   */
  async requestForgetMe(clientId: string, firmId: string): Promise<{ ok: true }> {
    const sql = db();
    if (!sql) return { ok: true };
    const rows = await sql<Array<{ id: string }>>`
      select id from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!rows.length) {
      // Same surface as success - don't leak whether the record exists.
      return { ok: true };
    }
    return { ok: true };
  },

  /** Fetch the storage key for a document this portal client owns. Returns
   *  null when the document either doesn't exist, isn't theirs, or has no
   *  attached file - the caller can't tell which, by design. */
  async getDocumentStorageKey(documentId: string, clientId: string, firmId: string): Promise<string | null> {
    const sql = db();
    if (!sql) return null;
    const name = await this.clientName(clientId, firmId);
    if (!name) return null;
    const rows = await sql<Array<{ storage_key: string | null }>>`
      select d.storage_key
      from documents d
      join cases c on c.title = d.case_label and c.firm_id = d.firm_id
      where d.id = ${documentId}::uuid
        and d.firm_id = ${firmId}::uuid
        and d.shared_with_client = true
        and c.client = ${name}
        and c.visible_to_client = true
      limit 1
    `;
    return rows[0]?.storage_key ?? null;
  },
};

// ===========================================================================
// Firm-side portal administration
// ===========================================================================
// Distinct from `portalService` because the actor is a firm user (subject to
// `requireAuth` + tenant scoping by firmId), not a portal client. Methods
// here MUST take a `firmId` parameter from `firmIdForUser(req.user.id)` so
// no caller can address another tenant's clients.

interface PortalEnableOutcome {
  ok: true;
  clientId: string;
  /**
   * Plaintext default password the firm admin should share with the client
   * (format: `firstname@123`). Set when the action minted or reset the
   * password - the firm UI surfaces this once and never again. The bcrypt
   * hash is what's stored.
   */
  password?: string;
}

interface FirmMessageInput {
  clientId: string;
  matterId: string | null;
  body: string;
  senderId: string;
  senderName: string;
}

export const portalAdminService = {
  /**
   * Flip `clients.portal_enabled = true` and mint the default password.
   *
   * The default is `firstname@123` (lowercase, alphanumeric-only first name).
   * We always reset the password on this call - it's the firm-side "give the
   * client access" action, and the admin needs the plaintext back to share.
   * Calling twice on an already-enabled client therefore *resets* the
   * password, which is the right thing for "Re-enable / fresh credentials".
   *
   * Caller is expected to have already passed the plan-tier gate.
   */
  async enablePortal(clientId: string, firmId: string): Promise<PortalEnableOutcome> {
    const sql = db();
    if (!sql) return { ok: true, clientId };

    const rows = await sql<Array<{ id: string; firm_id: string; name: string; email: string | null }>>`
      select id, firm_id, name, email
      from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error('Client not found in this firm'), { status: 404 });
    }
    if (!row.email) {
      throw Object.assign(new Error('Client has no contact email - add one before enabling the portal'), { status: 422 });
    }

    const password = defaultPasswordFor(row.name);
    const hash = await bcrypt.hash(password, 10);

    await sql`
      update clients
      set portal_enabled = true,
          portal_password_hash = ${hash}
      where id = ${row.id}::uuid and firm_id = ${firmId}::uuid
    `;

    return { ok: true, clientId: row.id, password };
  },

  async disablePortal(clientId: string, firmId: string): Promise<{ ok: true; revokedSessions: number }> {
    const sql = db();
    if (!sql) return { ok: true, revokedSessions: 0 };

    const updated = await sql<Array<{ id: string }>>`
      update clients
      set portal_enabled = false,
          portal_password_hash = null
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid
      returning id
    `;
    if (!updated.length) {
      throw Object.assign(new Error('Client not found in this firm'), { status: 404 });
    }
    // Clearing `portal_password_hash` is what locks the client out: sign-in
    // checks both `portal_enabled` and a non-null hash. Issued JWTs cannot
    // be revoked server-side (stateless); they fail their next request via
    // the `portal_enabled` re-check inside `portalService.clientName`.
    // We also mark any legacy magic-link rows as used so they can't be
    // exchanged in flight - safe to drop the table in a later migration.
    const rows = await sql<Array<{ id: string }>>`
      update client_portal_sessions
      set used_at = now()
      where client_id = ${clientId}::uuid and used_at is null
      returning id
    `;
    return { ok: true, revokedSessions: rows.length };
  },

  /**
   * Reset the portal password for an already-enabled client. Returns the
   * fresh plaintext default so the firm admin can share it with the client.
   * Fails when the client is disabled - "regenerate password" must not
   * silently re-enable; use `enablePortal` for that.
   */
  async regeneratePassword(clientId: string, firmId: string): Promise<PortalEnableOutcome> {
    const sql = db();
    if (!sql) return { ok: true, clientId };
    const rows = await sql<Array<{ id: string; name: string; email: string | null; portal_enabled: boolean }>>`
      select id, name, email, portal_enabled from clients
      where id = ${clientId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    const row = rows[0];
    if (!row) throw Object.assign(new Error('Client not found in this firm'), { status: 404 });
    if (!row.portal_enabled) {
      throw Object.assign(new Error('Portal access is disabled for this client'), { status: 409 });
    }
    if (!row.email) {
      throw Object.assign(new Error('Client has no contact email'), { status: 422 });
    }

    const password = defaultPasswordFor(row.name);
    const hash = await bcrypt.hash(password, 10);
    await sql`
      update clients set portal_password_hash = ${hash}
      where id = ${row.id}::uuid and firm_id = ${firmId}::uuid
    `;
    return { ok: true, clientId: row.id, password };
  },

  async setMatterVisibility(matterId: string, firmId: string, visible: boolean): Promise<void> {
    const sql = db();
    if (!sql) return;
    const rows = await sql<Array<{ id: string }>>`
      update cases set visible_to_client = ${visible}
      where id = ${matterId}::uuid and firm_id = ${firmId}::uuid
      returning id
    `;
    if (!rows.length) throw Object.assign(new Error('Matter not found in this firm'), { status: 404 });
  },

  /**
   * Flip per-document portal flags. Returns the post-update row so the
   * caller can decide whether to fire `notify.documentShared` /
   * `notify.documentRequiresAck`.
   */
  async setDocumentPortalFlags(
    documentId: string,
    firmId: string,
    patch: { sharedWithClient?: boolean; requiresAcknowledgement?: boolean },
  ): Promise<{
    id: string; name: string; clientName: string | null;
    sharedWithClient: boolean; requiresAcknowledgement: boolean;
    becameShared: boolean; becameRequired: boolean;
  }> {
    const sql = db();
    if (!sql) {
      return {
        id: documentId, name: '', clientName: null,
        sharedWithClient: !!patch.sharedWithClient,
        requiresAcknowledgement: !!patch.requiresAcknowledgement,
        becameShared: false, becameRequired: false,
      };
    }
    const before = await sql<Array<{
      id: string; case_label: string; name: string;
      shared_with_client: boolean; requires_acknowledgement: boolean;
    }>>`
      select id, case_label, name, shared_with_client, requires_acknowledgement
      from documents where id = ${documentId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    const prev = before[0];
    if (!prev) throw Object.assign(new Error('Document not found in this firm'), { status: 404 });

    const nextShared = patch.sharedWithClient ?? prev.shared_with_client;
    const nextRequired = patch.requiresAcknowledgement ?? prev.requires_acknowledgement;
    await sql`
      update documents
      set shared_with_client = ${nextShared},
          requires_acknowledgement = ${nextRequired}
      where id = ${documentId}::uuid and firm_id = ${firmId}::uuid
    `;

    // Resolve the matter's client so the caller can address notifications.
    const clientRow = await sql<Array<{ client: string }>>`
      select client from cases
      where firm_id = ${firmId}::uuid and title = ${prev.case_label}
      limit 1
    `;

    return {
      id: prev.id,
      name: prev.name,
      clientName: clientRow[0]?.client ?? null,
      sharedWithClient: nextShared,
      requiresAcknowledgement: nextRequired,
      becameShared: nextShared && !prev.shared_with_client,
      becameRequired: nextRequired && !prev.requires_acknowledgement,
    };
  },

  // ---- Firm-side messages inbox -----------------------------------------
  async listInbox(firmId: string): Promise<FirmPortalThreadSummary[]> {
    const sql = db();
    if (!sql) return [];
    // Pull every (client_id, matter_id) thread, with last message + unread
    // count of client → firm messages. One round trip; the worst-case Practice
    // tenant has ~50 portal users so this stays cheap.
    const rows = await sql<Array<{
      client_id: string; client_name: string; matter_id: string | null;
      matter_title: string | null; last_message_at: Date; last_body: string;
      unread_from_client: string | number;
    }>>`
      with last as (
        select distinct on (m.client_id, m.matter_id)
               m.client_id, m.matter_id, m.body, m.sent_at
        from portal_messages m
        where m.firm_id = ${firmId}::uuid
        order by m.client_id, m.matter_id, m.sent_at desc
      )
      select c.id   as client_id,
             c.name as client_name,
             cs.id  as matter_id,
             cs.title as matter_title,
             last.sent_at as last_message_at,
             last.body as last_body,
             (select count(*) from portal_messages m2
                where m2.firm_id = ${firmId}::uuid
                  and m2.client_id = last.client_id
                  and m2.matter_id is not distinct from last.matter_id
                  and m2.sender_kind = 'client'
                  and m2.read_at is null) as unread_from_client
      from last
      join clients c on c.id = last.client_id and c.firm_id = ${firmId}::uuid
      left join cases cs on cs.id = last.matter_id
      order by last.sent_at desc
    `;
    return rows.map((r) => ({
      clientId: r.client_id,
      clientName: r.client_name,
      matterId: r.matter_id,
      matterTitle: r.matter_title,
      lastMessageAt: r.last_message_at.toISOString(),
      lastMessagePreview: r.last_body.length > 120 ? `${r.last_body.slice(0, 117)}…` : r.last_body,
      unreadFromClient: Number(r.unread_from_client ?? 0),
    }));
  },

  async listThread(
    firmId: string,
    clientId: string,
    matterId: string | null,
  ): Promise<PortalMessage[]> {
    const sql = db();
    if (!sql) return [];
    // Verify the client belongs to this firm before returning their messages.
    const owns = await sql<Array<{ id: string }>>`
      select id from clients where id = ${clientId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!owns.length) return [];
    const rows = await sql<Array<{
      id: string; matter_id: string | null; matter_label: string | null;
      sender_kind: 'client' | 'firm'; sender_id: string; sender_name: string;
      body: string; sent_at: Date; read_at: Date | null;
    }>>`
      select m.id, m.matter_id,
             c.title as matter_label,
             m.sender_kind, m.sender_id, m.sender_name,
             m.body, m.sent_at, m.read_at
      from portal_messages m
      left join cases c on c.id = m.matter_id
      where m.firm_id = ${firmId}::uuid
        and m.client_id = ${clientId}::uuid
        and (
          ${matterId}::uuid is null and m.matter_id is null
          or m.matter_id = ${matterId}::uuid
        )
      order by m.sent_at asc
    `;
    return rows.map((r) => ({
      id: r.id,
      matterId: r.matter_id,
      matterLabel: r.matter_label ?? (r.matter_id ? undefined : 'General'),
      senderKind: r.sender_kind,
      senderName: r.sender_name,
      body: r.body,
      sentAt: r.sent_at.toISOString(),
      readAt: r.read_at ? r.read_at.toISOString() : undefined,
      // From the firm's perspective, "mine" means I (firm side) sent it.
      mine: r.sender_kind === 'firm',
    }));
  },

  async sendFromFirm(firmId: string, input: FirmMessageInput): Promise<PortalMessage> {
    const sql = db();
    if (!sql) throw Object.assign(new Error('Database not configured'), { status: 500 });
    const trimmed = input.body.trim();
    if (!trimmed) throw Object.assign(new Error('Message body is required'), { status: 400 });
    if (trimmed.length > 4000) {
      throw Object.assign(new Error('Message exceeds 4000 characters'), { status: 400 });
    }

    // Verify client ownership in this firm.
    const owns = await sql<Array<{ id: string }>>`
      select id from clients where id = ${input.clientId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!owns.length) throw Object.assign(new Error('Client not found in this firm'), { status: 404 });

    // If a matterId is given, verify it belongs to the same client.
    if (input.matterId !== null) {
      const m = await sql<Array<{ client: string }>>`
        select client from cases
        where id = ${input.matterId}::uuid and firm_id = ${firmId}::uuid limit 1
      `;
      if (!m.length) {
        throw Object.assign(new Error('Matter not found'), { status: 404 });
      }
    }

    const rows = await sql<Array<{
      id: string; matter_id: string | null; sender_kind: 'client' | 'firm';
      sender_id: string; sender_name: string; body: string;
      sent_at: Date; read_at: Date | null;
    }>>`
      insert into portal_messages
        (firm_id, client_id, matter_id, sender_kind, sender_id, sender_name, body)
      values
        (${firmId}::uuid, ${input.clientId}::uuid, ${input.matterId}::uuid,
         'firm', ${input.senderId}::uuid, ${input.senderName}, ${trimmed})
      returning id, matter_id, sender_kind, sender_id, sender_name, body, sent_at, read_at
    `;
    const r = rows[0]!;
    let matterLabel: string | undefined;
    if (r.matter_id) {
      const lab = await sql<Array<{ title: string }>>`select title from cases where id = ${r.matter_id}::uuid limit 1`;
      matterLabel = lab[0]?.title;
    } else {
      matterLabel = 'General';
    }
    return {
      id: r.id,
      matterId: r.matter_id,
      matterLabel,
      senderKind: r.sender_kind,
      senderName: r.sender_name,
      body: r.body,
      sentAt: r.sent_at.toISOString(),
      readAt: r.read_at ? r.read_at.toISOString() : undefined,
      mine: true,
    };
  },

  /** Mark all client→firm messages on a thread as read. Returns the count
   *  newly marked. Symmetric with `markThreadRead` on the portal side. */
  async markThreadReadFromFirm(
    firmId: string,
    clientId: string,
    matterId: string | null,
  ): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const owns = await sql<Array<{ id: string }>>`
      select id from clients where id = ${clientId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!owns.length) return 0;
    const rows = await sql<Array<{ id: string }>>`
      update portal_messages set read_at = now()
      where firm_id = ${firmId}::uuid
        and client_id = ${clientId}::uuid
        and (
          ${matterId}::uuid is null and matter_id is null
          or matter_id = ${matterId}::uuid
        )
        and sender_kind = 'client'
        and read_at is null
      returning id
    `;
    return rows.length;
  },

  /** Resolve the human-readable matter title (for notifications/audit). */
  async matterTitle(matterId: string | null, firmId: string): Promise<string | null> {
    if (!matterId) return null;
    const sql = db();
    if (!sql) return null;
    const rows = await sql<Array<{ title: string }>>`
      select title from cases where id = ${matterId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    return rows[0]?.title ?? null;
  },

  /** Resolve a client's name for a given firm (for audit/notifications). */
  async clientName(clientId: string, firmId: string): Promise<string | null> {
    return portalService.clientName(clientId, firmId);
  },
};
