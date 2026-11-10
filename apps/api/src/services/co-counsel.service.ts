import { db } from '../db/client';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '../lib/errors';
import { assignmentsService, isHeadRole, type Actor } from './assignments.service';
import { authService } from './auth.service';
import { notificationsStore } from './notifications.service';
import { normalizePhone } from './phone-otp.service';
import { generateId, generateToken, isoPlusDays } from './invitations.service';
import { firmIdForUser } from './tenant';
import type {
  AcceptHandoverByTokenInput,
  AcceptHandoverResult,
  CaseGuestGrant,
  CreateHandoverRequestInput,
  GuestCaseDetail,
  GuestCaseView,
  GuestDocumentView,
  GuestHearingView,
  GuestNoteView,
  HandoverRequest,
  HandoverStatus,
  HandoverTargetKind,
} from '../types/co-counsel.types';

// =============================================================================
// co-counsel.service
//
// Cross-firm case handover: an advocate who cannot attend a matter hands the
// whole case to an advocate OUTSIDE their firm, who may not have a DifAi
// account yet. Same-firm handover already exists (assignments.service.ts) and
// is reused here unchanged when the target turns out to be a teammate.
//
// Two target shapes (build-docs/features/co-counsel-lockdown.md):
//   - in_firm_user  -> delegate straight to assignmentsService.setCaseLead
//   - open_link     -> an `invitations` row (kind='co_counsel_handover')
//                      bound to the recipient's WhatsApp number. Only a
//                      person who proves that number by OTP can accept -
//                      a new advocate (account created) or an existing
//                      DifAi user whose verified phone matches.
// (existing_external_user / new_external_invite are legacy rows only.)
//
// A cross-firm accept never joins the referring firm. The guest's only access
// is one active `case_guest_grants` row = one case, read through the
// guest-scoped queries below. Every firm-scoped route resolves the guest to
// their own firm, so the referring firm's other cases, clients and documents
// stay unreachable. Revoke / leave flips the grant and drops the guest's
// case_assignments row (their matter-chat membership) in one transaction.
// =============================================================================

const INVITATION_TTL_DAYS = 7;

interface HandoverRow {
  id: string;
  case_id: string;
  case_title: string;
  case_cnr: string;
  source_firm_id: string;
  requested_by: string;
  requested_by_name: string | null;
  target_kind: HandoverTargetKind;
  target_user_id: string | null;
  target_name: string | null;
  target_email: string | null;
  target_phone: string | null;
  invitation_id: string | null;
  reason: string | null;
  urgency: 'normal' | 'urgent';
  status: HandoverStatus;
  attributed_signup: boolean;
  created_at: Date;
  resolved_at: Date | null;
}

function fromRow(r: HandoverRow): HandoverRequest {
  return {
    id: r.id,
    caseId: r.case_id,
    caseTitle: r.case_title,
    caseCnr: r.case_cnr,
    sourceFirmId: r.source_firm_id,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    targetKind: r.target_kind,
    targetUserId: r.target_user_id,
    targetName: r.target_name,
    targetEmail: r.target_email,
    targetPhone: r.target_phone ?? null,
    invitationId: r.invitation_id,
    reason: r.reason,
    urgency: r.urgency,
    status: r.status,
    attributedSignup: r.attributed_signup,
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
  };
}

const HANDOVER_SELECT = `
  select
    hr.id, hr.case_id, c.title as case_title, c.cnr as case_cnr,
    hr.source_firm_id, hr.requested_by, ru.name as requested_by_name,
    hr.target_kind, hr.target_user_id, hr.target_name, hr.target_email, hr.target_phone,
    hr.invitation_id, hr.reason, hr.urgency, hr.status, hr.attributed_signup,
    hr.created_at, hr.resolved_at
  from handover_requests hr
  join cases c on c.id = hr.case_id
  left join users ru on ru.id = hr.requested_by
`;

/**
 * Fetch a single handover_requests row, fully joined, by id. Used right
 * after inserting a new row - as two separate statements rather than one
 * `WITH inserted AS (INSERT ... RETURNING id) <select>` CTE. The CTE form
 * was tried first but returns zero rows with this driver (postgres-js) when
 * the select half is spliced in via `sql.unsafe()` after an INSERT CTE -
 * reproduced directly against the DB outside the app, so it's a real
 * driver/query-shape incompatibility, not a data problem. Two plain
 * statements sidesteps it entirely and is easier to read besides.
 */
async function fetchHandoverById(sql: NonNullable<ReturnType<typeof db>>, id: string): Promise<HandoverRow> {
  const [row] = await sql<HandoverRow[]>`${sql.unsafe(HANDOVER_SELECT)} where hr.id = ${id}::uuid`;
  return row!;
}

function grantFromRow(r: {
  id: string; case_id: string; guest_user_id: string; granting_firm_id: string;
  handover_request_id: string | null; status: string; created_at: Date; revoked_at: Date | null;
}): CaseGuestGrant {
  return {
    id: r.id,
    caseId: r.case_id,
    guestUserId: r.guest_user_id,
    grantingFirmId: r.granting_firm_id,
    handoverRequestId: r.handover_request_id,
    status: r.status as CaseGuestGrant['status'],
    createdAt: r.created_at.toISOString(),
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
  };
}

/** Mirrors assignments.service's authorisation: firm heads may hand off any
 *  matter in their firm; an ordinary advocate only a matter they currently
 *  lead ("self-handoff"). */
async function assertCanInitiateHandover(caseId: string, firmId: string, actor: Actor): Promise<void> {
  if (isHeadRole(actor)) return;
  const lead = await assignmentsService.getCaseLead(caseId, firmId);
  if (!lead || lead.id !== actor.id) {
    throw new ForbiddenError('Only the current lead or a firm head can hand off this matter');
  }
}

export const coCounselService = {
  async listForFirm(firmId: string | null): Promise<HandoverRequest[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    // A link past its 7 days must not keep reading "Waiting to accept".
    await sql`
      update handover_requests hr set status = 'expired', resolved_at = now()
      from invitations i
      where i.id = hr.invitation_id and hr.source_firm_id = ${firmId}::uuid
        and hr.status = 'pending' and i.expires_at < now()
    `;
    const rows = await sql<HandoverRow[]>`
      ${sql.unsafe(HANDOVER_SELECT)}
      where hr.source_firm_id = ${firmId}::uuid
      order by
        case hr.status when 'pending' then 0 else 1 end,
        hr.created_at desc
    `;
    return rows.map(fromRow);
  },

  async requestHandover(args: {
    caseId: string;
    firmId: string | null;
    actor: Actor;
    input: CreateHandoverRequestInput;
  }): Promise<HandoverRequest> {
    const { caseId, firmId, actor, input } = args;
    if (!firmId) throw new UnprocessableEntityError('No firm attached');
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    const [matter] = await sql<Array<{ id: string; title: string; cnr: string }>>`
      select id, title, cnr from cases where id = ${caseId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!matter) throw new NotFoundError('Matter not found');

    await assertCanInitiateHandover(caseId, firmId, actor);

    const [actorRow] = await sql<Array<{ name: string; firm_name: string | null }>>`
      select u.name, f.name as firm_name from users u
      left join firms f on f.id = u.firm_id
      where u.id = ${actor.id}::uuid limit 1
    `;
    const actorName = actorRow?.name ?? 'A colleague';
    const actorFirmName = actorRow?.firm_name ?? matter.title;

    // Share link/QR bound to the recipient's WhatsApp number. The referring
    // advocate sends it however they like; a forwarded copy is useless to
    // anyone who can't pass the OTP for that number.
    if ('open' in input.target) {
      const phone = normalizePhone(input.target.phone);
      const invitationId = generateId();
      const token = generateToken();
      const expiresAt = isoPlusDays(INVITATION_TTL_DAYS);
      await sql`
        insert into invitations (
          id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
          status, token, expires_at, message, kind, case_id, phone
        ) values (
          ${invitationId}, ${firmId}::uuid, null, 'Of Counsel', ${actorFirmName},
          ${actor.id}::uuid, ${actorName},
          'pending', ${token}, ${expiresAt}, ${input.reason ?? null},
          'co_counsel_handover', ${caseId}::uuid, ${phone}
        )
      `;
      const [inserted] = await sql<Array<{ id: string }>>`
        insert into handover_requests (
          case_id, source_firm_id, requested_by, target_kind,
          target_phone, invitation_id, reason, urgency
        ) values (
          ${caseId}::uuid, ${firmId}::uuid, ${actor.id}::uuid, 'open_link',
          ${phone}, ${invitationId}, ${input.reason ?? null}, ${input.urgency ?? 'normal'}
        )
        returning id
      `;
      const row = await fetchHandoverById(sql, inserted!.id);
      return { ...fromRow(row), shareToken: token };
    }

    // Teammate in the caller's own firm only. Outside advocates always go
    // through the phone-bound link above.
    const targetUserId = input.target.existingUserId;
    const [targetUser] = await sql<Array<{ id: string }>>`
      select id from users
      where id = ${targetUserId}::uuid and status = 'active' and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!targetUser) {
      throw new BadRequestError('Pick a colleague in your firm, or share a link with an advocate outside it');
    }
    await assignmentsService.setCaseLead({ caseId, firmId, targetUserId, actor });
    const [inserted] = await sql<Array<{ id: string }>>`
      insert into handover_requests (
        case_id, source_firm_id, requested_by, target_kind, target_user_id,
        status, resolved_at
      ) values (
        ${caseId}::uuid, ${firmId}::uuid, ${actor.id}::uuid, 'in_firm_user', ${targetUserId}::uuid,
        'accepted', now()
      )
      returning id
    `;
    return fromRow(await fetchHandoverById(sql, inserted!.id));
  },

  async cancelHandover(id: string, firmId: string | null, userId: string): Promise<HandoverRequest> {
    if (!firmId) throw new NotFoundError('Handover request not found');
    const sql = db();
    if (!sql) throw new NotFoundError('Handover request not found');

    const [existing] = await sql<Array<{ requested_by: string; status: HandoverStatus }>>`
      select requested_by, status from handover_requests
      where id = ${id}::uuid and source_firm_id = ${firmId}::uuid limit 1
    `;
    if (!existing) throw new NotFoundError('Handover request not found');
    if (existing.status !== 'pending') {
      throw new ConflictError('Only pending handover requests can be cancelled');
    }
    if (existing.requested_by !== userId) {
      const [actorRow] = await sql<Array<{ role: string; is_superadmin: boolean }>>`
        select role, is_superadmin from users where id = ${userId}::uuid limit 1
      `;
      const actor: Actor = { id: userId, role: actorRow?.role ?? '', isSuperadmin: !!actorRow?.is_superadmin };
      if (!isHeadRole(actor)) {
        throw new ForbiddenError('Only the requester or a firm head can cancel this request');
      }
    }

    await sql`
      update handover_requests set status = 'cancelled', resolved_at = now()
      where id = ${id}::uuid and source_firm_id = ${firmId}::uuid
    `;
    const [row] = await sql<HandoverRow[]>`${sql.unsafe(HANDOVER_SELECT)} where hr.id = ${id}::uuid`;
    return fromRow(row!);
  },

  /**
   * Revoke an accepted cross-firm handover (requester or firm head). The
   * guest loses the case page, the guest list entry and the matter chat at
   * once; the referring firm keeps everything.
   */
  async revokeHandover(id: string, firmId: string | null, actor: Actor): Promise<HandoverRequest> {
    if (!firmId) throw new NotFoundError('Handover request not found');
    const sql = db();
    if (!sql) throw new NotFoundError('Handover request not found');
    const [existing] = await sql<Array<{
      requested_by: string; status: HandoverStatus; target_kind: HandoverTargetKind;
      target_user_id: string | null; case_id: string; case_title: string;
    }>>`
      select hr.requested_by, hr.status, hr.target_kind, hr.target_user_id, hr.case_id, c.title as case_title
      from handover_requests hr join cases c on c.id = hr.case_id
      where hr.id = ${id}::uuid and hr.source_firm_id = ${firmId}::uuid limit 1
    `;
    if (!existing) throw new NotFoundError('Handover request not found');
    if (existing.status !== 'accepted' || existing.target_kind === 'in_firm_user' || !existing.target_user_id) {
      throw new ConflictError('Only an accepted handover to an outside advocate can be revoked');
    }
    if (existing.requested_by !== actor.id && !isHeadRole(actor)) {
      throw new ForbiddenError('Only the requester or a firm head can remove access');
    }
    await endGuestAccess(sql, existing.case_id, existing.target_user_id);

    const guestFirmId = await firmIdForUser(existing.target_user_id);
    if (guestFirmId) {
      await notificationsStore.create({
        firmId: guestFirmId,
        userId: existing.target_user_id,
        title: `Access removed: ${existing.case_title}`,
        body: `The referring firm has removed your access to "${existing.case_title}".`,
        tone: 'amber',
        view: 'co-counsel',
      });
    }
    return fromRow(await fetchHandoverById(sql, id));
  },

  /** The guest drops a case themselves. Same effect as a revoke. */
  async leaveGuestCase(userId: string, caseId: string): Promise<void> {
    const sql = db();
    if (!sql || !(await assertGuestGrant(sql, userId, caseId))) throw new NotFoundError('Case not found');
    await endGuestAccess(sql, caseId, userId);
  },

  /** Public token lookup - safe subset only, no internal ids. */
  async lookupInviteByToken(token: string): Promise<{
    caseTitle: string; caseCnr: string; invitedName: string | null; sourceFirmName: string; reason: string | null; expiresAt: string;
    /** Last 4 digits of the WhatsApp number the link is bound to, so the
     *  recipient knows which number to verify. Null on legacy rows. */
    phoneHint: string | null;
  }> {
    const sql = db();
    if (!sql) throw new NotFoundError('Invitation not found');
    await sql`
      update invitations set status = 'expired'
      where token = ${token} and status = 'pending' and expires_at < now()
    `;
    const [row] = await sql<Array<{
      case_title: string; case_cnr: string; invited_name: string | null; firm_name: string;
      message: string | null; status: string; expires_at: Date; phone: string | null;
    }>>`
      select c.title as case_title, c.cnr as case_cnr, i.invited_name, i.firm_name, i.message, i.status, i.expires_at, i.phone
      from invitations i
      join cases c on c.id = i.case_id
      where i.token = ${token} and i.kind = 'co_counsel_handover'
      limit 1
    `;
    if (!row) throw new NotFoundError('Invitation not found');
    if (row.status === 'expired') throw new ConflictError('This invitation has expired');
    if (row.status !== 'pending') throw new ConflictError(`This invitation is ${row.status}`);
    return {
      caseTitle: row.case_title,
      caseCnr: row.case_cnr,
      invitedName: row.invited_name,
      sourceFirmName: row.firm_name,
      reason: row.message,
      expiresAt: row.expires_at.toISOString(),
      phoneHint: row.phone ? row.phone.slice(-4) : null,
    };
  },

  /**
   * Brand-new advocate accepting an invite by token: creates their account
   * (own trial Solo firm, never the referring firm), then the guest grant,
   * in one transaction.
   */
  async acceptByToken(token: string, body: AcceptHandoverByTokenInput): Promise<AcceptHandoverResult> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');
    const invRow = await loadPendingInvite(sql, token);

    // Every check happens BEFORE the account exists, so a refused link never
    // leaves a stray account behind.
    const { google, phone } = await authService.verifiedSignup(body.signupToken);
    assertClaimant(invRow, { phone, email: google.email });

    const auth = await authService.registerCoCounselGuest({
      name: body.name.trim(),
      email: google.email,
      googleSub: google.sub,
      phone,
    });
    const grant = await claimInvite(sql, invRow.id, auth.user.id, true);
    return { auth, grant: grantFromRow(grant), upsell: { eligible: true } };
  },

  /**
   * A signed-in DifAi user accepting a link. Their account's verified
   * WhatsApp number must be the one the link is bound to. They keep their
   * own firm; the grant is the only thing that changes.
   */
  async acceptByTokenAsUser(token: string, userId: string): Promise<AcceptHandoverResult> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');
    const invRow = await loadPendingInvite(sql, token);
    const [user] = await sql<Array<{ firm_id: string | null; email: string; phone: string | null; phone_verified_at: Date | null }>>`
      select firm_id, email, phone, phone_verified_at from users where id = ${userId}::uuid and status = 'active' limit 1
    `;
    if (!user) throw new NotFoundError('Account not found');
    if (user.firm_id === invRow.firm_id) {
      throw new ConflictError('You are in the firm that shared this matter - open it from your Cases list');
    }
    assertClaimant(invRow, { phone: user.phone_verified_at ? user.phone : null, email: user.email });

    const grant = await claimInvite(sql, invRow.id, userId, false);
    const isPaidFirm = user.firm_id ? await hasActivePaidPlan(user.firm_id) : false;
    return { grant: grantFromRow(grant), upsell: { eligible: !isPaidFirm } };
  },

  /** Read-only case summary for a cross-firm guest - deliberately narrower
   *  than the full Case DTO (no client billing, no eCourts identity cols). */
  async guestCaseView(userId: string, caseId: string): Promise<GuestCaseView> {
    const sql = db();
    if (!sql) throw new NotFoundError('Case not found');
    const [row] = await sql<Array<{
      title: string; cnr: string; court: string; stage: string; status: string;
      next_hearing: Date | string | null; granting_firm_id: string; created_at: Date;
    }>>`
      select c.title, c.cnr, c.court, c.stage, c.status, c.next_hearing,
             g.granting_firm_id, g.created_at
      from case_guest_grants g
      join cases c on c.id = g.case_id
      where g.case_id = ${caseId}::uuid and g.guest_user_id = ${userId}::uuid and g.status = 'active'
      limit 1
    `;
    if (!row) throw new NotFoundError('Case not found');
    const [firm] = await sql<Array<{ name: string }>>`select name from firms where id = ${row.granting_firm_id}::uuid limit 1`;
    return {
      caseId,
      title: row.title,
      cnr: row.cnr,
      court: row.court,
      stage: row.stage,
      status: row.status,
      nextHearing: row.next_hearing ? (row.next_hearing instanceof Date ? row.next_hearing.toISOString().slice(0, 10) : row.next_hearing) : null,
      grantedBy: firm?.name ?? 'another firm',
      grantedAt: row.created_at.toISOString(),
    };
  },

  /** Hearings for a case the caller holds an active guest grant on.
   *  Deliberately a fresh query, not a reuse of hearings.service.ts's
   *  firm-wide listers - those assume the caller's own firmId owns every row
   *  they return, which is false for a cross-firm guest. */
  async listGuestHearings(userId: string, caseId: string): Promise<GuestHearingView[]> {
    const sql = db();
    if (!sql) return [];
    if (!(await assertGuestGrant(sql, userId, caseId))) return [];
    const rows = await sql<Array<{
      id: string; hearing_date: Date | string | null; hearing_time: string;
      court: string; purpose: string; status: 'today' | 'upcoming' | 'past';
    }>>`
      select id, hearing_date, hearing_time, court, purpose, status
      from hearings
      where case_id = ${caseId}::uuid
      order by hearing_date asc nulls last, hearing_time asc
    `;
    return rows.map((r) => ({
      id: r.id,
      date: r.hearing_date ? (r.hearing_date instanceof Date ? r.hearing_date.toISOString().slice(0, 10) : r.hearing_date) : null,
      time: r.hearing_time,
      court: r.court,
      purpose: r.purpose,
      status: r.status,
    }));
  },

  /** Document metadata (no file bytes) for a case the caller holds an active
   *  guest grant on. Same reasoning as listGuestHearings - a fresh query
   *  rather than widening documents.service.ts's firm-scoped listers. */
  async listGuestDocuments(userId: string, caseId: string): Promise<GuestDocumentView[]> {
    const sql = db();
    if (!sql) return [];
    if (!(await assertGuestGrant(sql, userId, caseId))) return [];
    const rows = await sql<Array<{ id: string; name: string; type: string; updated_label: string; storage_key: string | null }>>`
      select id, name, type, updated_label, storage_key
      from documents
      where case_id = ${caseId}::uuid
      order by created_at desc
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      updated: r.updated_label,
      hasFile: !!r.storage_key,
    }));
  },

  /** Shared-visibility case notes only - a guest must never see another
   *  advocate's private working notes, same rule caseNotesService.list
   *  applies to firm members themselves. */
  async listGuestNotes(userId: string, caseId: string): Promise<GuestNoteView[]> {
    const sql = db();
    if (!sql) return [];
    if (!(await assertGuestGrant(sql, userId, caseId))) return [];
    const rows = await sql<Array<{
      id: string; author_name: string | null; title: string | null; body: string; created_at: Date | string;
    }>>`
      select n.id, u.name as author_name, n.title, n.body, n.created_at
      from case_notes n
      left join users u on u.id = n.author_user_id
      where n.case_id = ${caseId}::uuid and n.visibility = 'shared'
      order by n.created_at desc
    `;
    return rows.map((r) => ({
      id: r.id,
      authorName: r.author_name ?? 'Unknown',
      title: r.title,
      body: r.body,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
    }));
  },

  /** Everything a guest's case page needs in one call. 404s as a whole if
   *  the grant doesn't exist/isn't active, rather than returning partial
   *  empty sections that could be mistaken for "no hearings yet". */
  async guestCaseDetail(userId: string, caseId: string): Promise<GuestCaseDetail> {
    const summary = await coCounselService.guestCaseView(userId, caseId);
    const [hearings, documents, notes] = await Promise.all([
      coCounselService.listGuestHearings(userId, caseId),
      coCounselService.listGuestDocuments(userId, caseId),
      coCounselService.listGuestNotes(userId, caseId),
    ]);
    return { summary, hearings, documents, notes };
  },

  /** All cases the caller has active cross-firm guest access to. */
  async listGuestCases(userId: string): Promise<GuestCaseView[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Array<{ case_id: string }>>`
      select case_id from case_guest_grants where guest_user_id = ${userId}::uuid and status = 'active'
    `;
    const views = await Promise.all(rows.map((r) => coCounselService.guestCaseView(userId, r.case_id)));
    return views;
  },
};

async function hasActivePaidPlan(firmId: string): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  const [row] = await sql<Array<{ plan_status: string | null }>>`
    select plan_status from firms where id = ${firmId}::uuid limit 1
  `;
  return row?.plan_status === 'active';
}

type Sql = NonNullable<ReturnType<typeof db>>;

interface InviteRow {
  id: string; case_id: string; firm_id: string; email: string | null; phone: string | null;
  status: string; expires_at: Date;
}

async function loadPendingInvite(sql: Sql, token: string): Promise<InviteRow> {
  const [inv] = await sql<InviteRow[]>`
    select id, case_id, firm_id, email, phone, status, expires_at from invitations
    where token = ${token} and kind = 'co_counsel_handover' limit 1
  `;
  if (!inv) throw new NotFoundError('Invitation not found');
  if (inv.status !== 'pending') throw new ConflictError(`This invitation is ${inv.status}`);
  if (inv.expires_at.getTime() < Date.now()) throw new ConflictError('This invitation has expired');
  if (!inv.case_id) throw new UnprocessableEntityError('Invitation has no linked case');
  return inv;
}

/** Only the intended advocate may claim a link: the WhatsApp number it is
 *  bound to (current links), else the email it was sent to (legacy
 *  email-first rows). A legacy open link with neither is refused outright -
 *  it was claimable by anyone, so the sender must issue a new one. */
export function assertClaimant(inv: Pick<InviteRow, 'phone' | 'email'>, who: { phone: string | null; email: string }): void {
  if (inv.phone) {
    if (who.phone !== inv.phone) {
      throw new ForbiddenError(`This link is for the WhatsApp number ending ${inv.phone.slice(-4)}. Verify that number to accept.`);
    }
    return;
  }
  if (inv.email) {
    if (inv.email.toLowerCase() !== who.email.toLowerCase()) {
      throw new ForbiddenError(`This invitation was sent to ${inv.email}. Continue with the Google account for that email.`);
    }
    return;
  }
  throw new ForbiddenError('This link is no longer valid. Ask the advocate who shared it for a new one.');
}

type GrantRow = Parameters<typeof grantFromRow>[0];

/** Grant + chat membership + request/invite resolution in one transaction.
 *  The invite row is locked, so two people racing on one link can't both win. */
async function claimInvite(sql: Sql, invitationId: string, userId: string, newAccount: boolean): Promise<GrantRow> {
  return sql.begin(async (tx) => {
    const [inv] = await tx<Array<{ case_id: string; firm_id: string; status: string }>>`
      select case_id, firm_id, status from invitations where id = ${invitationId} for update
    `;
    if (!inv || inv.status !== 'pending') throw new ConflictError('This invitation has already been used');
    const [req] = await tx<Array<{ id: string }>>`
      select id from handover_requests where invitation_id = ${invitationId} limit 1
    `;
    const [g] = await tx<GrantRow[]>`
      insert into case_guest_grants (case_id, guest_user_id, granting_firm_id, handover_request_id)
      values (${inv.case_id}::uuid, ${userId}::uuid, ${inv.firm_id}::uuid, ${req?.id ?? null})
      on conflict (case_id, guest_user_id) do update
        set status = 'active', revoked_at = null, created_at = now(), handover_request_id = excluded.handover_request_id
      returning id, case_id, guest_user_id, granting_firm_id, handover_request_id, status, created_at, revoked_at
    `;
    await tx`
      insert into case_assignments (case_id, user_id, role_on_case)
      values (${inv.case_id}::uuid, ${userId}::uuid, 'collaborator')
      on conflict (case_id, user_id) do nothing
    `;
    await tx`update invitations set status = 'accepted', accepted_at = now() where id = ${invitationId}`;
    if (req) {
      await tx`
        update handover_requests
        set status = 'accepted', resolved_at = now(), target_user_id = ${userId}::uuid,
            target_name = (select name from users where id = ${userId}::uuid),
            attributed_signup = ${newAccount}
        where id = ${req.id}::uuid
      `;
    }
    if (newAccount) {
      await tx`
        update users set acquired_via = 'co_counsel_handover', acquired_via_handover_id = ${req?.id ?? null}
        where id = ${userId}::uuid
      `;
    }
    return g!;
  });
}

/** Revoke / leave: grant off, chat membership gone, request marked revoked. */
async function endGuestAccess(sql: Sql, caseId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update case_guest_grants set status = 'revoked', revoked_at = now()
      where case_id = ${caseId}::uuid and guest_user_id = ${userId}::uuid and status = 'active'
    `;
    await tx`
      delete from case_assignments
      where case_id = ${caseId}::uuid and user_id = ${userId}::uuid and role_on_case <> 'lead'
    `;
    await tx`
      update handover_requests set status = 'revoked', resolved_at = now()
      where case_id = ${caseId}::uuid and target_user_id = ${userId}::uuid and status = 'accepted'
        and target_kind <> 'in_firm_user'
    `;
  });
}

/** True when `userId` holds an active case_guest_grants row for `caseId`.
 *  Shared by every listGuest* query below so a guest's case-scoped reads all
 *  gate on the exact same check as guestCaseView - no risk of one query
 *  accidentally being more permissive than another. */
async function assertGuestGrant(sql: NonNullable<ReturnType<typeof db>>, userId: string, caseId: string): Promise<boolean> {
  const [row] = await sql<Array<{ id: string }>>`
    select id from case_guest_grants
    where case_id = ${caseId}::uuid and guest_user_id = ${userId}::uuid and status = 'active'
    limit 1
  `;
  return !!row;
}
