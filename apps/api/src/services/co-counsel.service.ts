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
import { emailService } from './email.service';
import { notificationsStore } from './notifications.service';
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
// whole case to an advocate OUTSIDE their firm, who may not have a LexDraft
// account yet. Same-firm handover already exists (assignments.service.ts) and
// is reused here unchanged when the target turns out to be a teammate.
//
// Three target shapes (see handover_target_kind, migration 0073):
//   - in_firm_user            -> delegate straight to assignmentsService.setCaseLead
//   - existing_external_user  -> notify; they accept while logged in
//   - new_external_invite     -> create an `invitations` row (kind=
//                                'co_counsel_handover'); accepting creates
//                                their account AND the guest grant together
//
// A cross-firm accept never joins the referring firm - it provisions the
// receiving advocate their own trial Solo firm (authService.registerCoCounselGuest)
// and grants them read-only access to exactly this one case via
// `case_guest_grants` (tenant.ts::hasCaseAccess). This is Phase 1: read-only
// (case summary, notes) guest access + a static upgrade CTA. See the approved
// plan (co-counsel handover) for the Phase 2 scope (write-access parity,
// real payment capture).
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

    // Target shape 0: open link/QR - no recipient known yet. Creates a
    // passwordless-until-accepted invitation with no email; the referring
    // advocate shares the link/QR themselves via whatever channel they like.
    // The accepting person supplies their own name/email/password later.
    if ('open' in input.target) {
      const invitationId = generateId();
      const token = generateToken();
      const expiresAt = isoPlusDays(INVITATION_TTL_DAYS);
      await sql`
        insert into invitations (
          id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
          status, token, expires_at, message, kind, case_id
        ) values (
          ${invitationId}, ${firmId}::uuid, null, 'Of Counsel', ${actorFirmName},
          ${actor.id}::uuid, ${actorName},
          'pending', ${token}, ${expiresAt}, ${input.reason ?? null},
          'co_counsel_handover', ${caseId}::uuid
        )
      `;
      const [inserted] = await sql<Array<{ id: string }>>`
        insert into handover_requests (
          case_id, source_firm_id, requested_by, target_kind,
          invitation_id, reason, urgency
        ) values (
          ${caseId}::uuid, ${firmId}::uuid, ${actor.id}::uuid, 'open_link',
          ${invitationId}, ${input.reason ?? null}, ${input.urgency ?? 'normal'}
        )
        returning id
      `;
      const row = await fetchHandoverById(sql, inserted!.id);
      return { ...fromRow(row), shareToken: token };
    }

    // Target shape 1: explicit existing-user id.
    if ('existingUserId' in input.target) {
      const targetUserId = input.target.existingUserId;
      const [targetUser] = await sql<Array<{ id: string; name: string; email: string; firm_id: string | null }>>`
        select id, name, email, firm_id from users where id = ${targetUserId}::uuid and status = 'active' limit 1
      `;
      if (!targetUser) throw new BadRequestError('Target user not found');

      if (targetUser.firm_id === firmId) {
        // Same firm - this is today's in-firm handover. Delegate, then log
        // an already-accepted audit row so the two flows show up in one list.
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
      }

      // Cross-firm, existing account - notify and let them accept explicitly.
      const [inserted] = await sql<Array<{ id: string }>>`
        insert into handover_requests (
          case_id, source_firm_id, requested_by, target_kind, target_user_id,
          target_name, target_email, reason, urgency
        ) values (
          ${caseId}::uuid, ${firmId}::uuid, ${actor.id}::uuid, 'existing_external_user', ${targetUserId}::uuid,
          ${targetUser.name}, ${targetUser.email}, ${input.reason ?? null}, ${input.urgency ?? 'normal'}
        )
        returning id
      `;
      const created = fromRow(await fetchHandoverById(sql, inserted!.id));

      const recipientFirmId = await firmIdForUser(targetUserId);
      if (recipientFirmId) {
        await notificationsStore.create({
          firmId: recipientFirmId,
          userId: targetUserId,
          title: `Case handover request: ${matter.title}`,
          body: `${actorName} has asked you to take over "${matter.title}" (${matter.cnr}).`,
          tone: 'amber',
          view: 'co-counsel',
        });
      }
      await emailService.send({
        to: targetUser.email,
        subject: `Case handover request: ${matter.title}`,
        body:
          `You've been asked to take over the matter "${matter.title}" (${matter.cnr}).\n\n` +
          (input.reason ? `Reason: ${input.reason}\n\n` : '') +
          `Sign in to LexDraft and open Co-Counsel requests to accept or decline.`,
      });
      return created;
    }

    // Target shape 2: brand-new external advocate, identified by contact info.
    const { name, email, phone } = input.target;
    const normalizedEmail = email.toLowerCase().trim();

    const [existingByEmail] = await sql<Array<{ id: string; firm_id: string | null }>>`
      select id, firm_id from users where lower(email) = ${normalizedEmail} limit 1
    `;
    if (existingByEmail) {
      // They already have an account after all - route through the
      // existing-user path so we don't create a duplicate account later.
      return coCounselService.requestHandover({
        caseId,
        firmId,
        actor,
        input: { ...input, target: { existingUserId: existingByEmail.id } },
      });
    }

    const invitationId = generateId();
    const token = generateToken();
    const expiresAt = isoPlusDays(INVITATION_TTL_DAYS);
    await sql`
      insert into invitations (
        id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
        status, token, expires_at, message, kind, case_id, phone, invited_name
      ) values (
        ${invitationId}, ${firmId}::uuid, ${normalizedEmail}, 'Of Counsel', ${actorFirmName},
        ${actor.id}::uuid, ${actorName},
        'pending', ${token}, ${expiresAt}, ${input.reason ?? null},
        'co_counsel_handover', ${caseId}::uuid, ${phone ?? null}, ${name}
      )
    `;

    const [insertedRow] = await sql<Array<{ id: string }>>`
      insert into handover_requests (
        case_id, source_firm_id, requested_by, target_kind,
        target_name, target_email, target_phone, invitation_id, reason, urgency
      ) values (
        ${caseId}::uuid, ${firmId}::uuid, ${actor.id}::uuid, 'new_external_invite',
        ${name}, ${normalizedEmail}, ${phone ?? null}, ${invitationId}, ${input.reason ?? null}, ${input.urgency ?? 'normal'}
      )
      returning id
    `;
    const row = await fetchHandoverById(sql, insertedRow!.id);
    const created = fromRow(row);

    await emailService.send({
      to: normalizedEmail,
      subject: `${actorName} needs you to take over a matter on LexDraft`,
      body:
        `You've been invited to take over the matter "${matter.title}" (${matter.cnr}) on LexDraft.\n\n` +
        (input.reason ? `Reason: ${input.reason}\n\n` : '') +
        `Accept here: /co-counsel/accept/${token}\n\n` +
        `This link expires in ${INVITATION_TTL_DAYS} days.`,
    });
    return created;
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
   * Existing user (possibly cross-firm) accepting a handover request they
   * were notified about. Creates the guest grant in a transaction; does not
   * touch the accepting user's own firm_id.
   */
  async acceptExisting(requestId: string, acceptingUserId: string): Promise<AcceptHandoverResult> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    const [reqRow] = await sql<Array<{
      id: string; case_id: string; source_firm_id: string; target_user_id: string | null; status: HandoverStatus;
    }>>`
      select id, case_id, source_firm_id, target_user_id, status from handover_requests
      where id = ${requestId}::uuid limit 1
    `;
    if (!reqRow) throw new NotFoundError('Handover request not found');
    if (reqRow.status !== 'pending') throw new ConflictError(`This request is ${reqRow.status}`);
    if (reqRow.target_user_id !== acceptingUserId) {
      throw new ForbiddenError('This handover request was not sent to you');
    }

    const grant = await sql.begin(async (tx) => {
      const [g] = await tx<Array<{
        id: string; case_id: string; guest_user_id: string; granting_firm_id: string;
        handover_request_id: string | null; status: string; created_at: Date; revoked_at: Date | null;
      }>>`
        insert into case_guest_grants (case_id, guest_user_id, granting_firm_id, handover_request_id)
        values (${reqRow.case_id}::uuid, ${acceptingUserId}::uuid, ${reqRow.source_firm_id}::uuid, ${reqRow.id}::uuid)
        on conflict (case_id, guest_user_id) do update set status = 'active', revoked_at = null
        returning id, case_id, guest_user_id, granting_firm_id, handover_request_id, status, created_at, revoked_at
      `;
      await tx`
        insert into case_assignments (case_id, user_id, role_on_case)
        values (${reqRow.case_id}::uuid, ${acceptingUserId}::uuid, 'collaborator')
        on conflict (case_id, user_id) do nothing
      `;
      await tx`update handover_requests set status = 'accepted', resolved_at = now() where id = ${reqRow.id}::uuid`;
      return g!;
    });

    const recipientFirmId = await firmIdForUser(acceptingUserId);
    const isPaidFirm = recipientFirmId ? await hasActivePaidPlan(recipientFirmId) : false;
    return { grant: grantFromRow(grant), upsell: { eligible: !isPaidFirm } };
  },

  /** Public token lookup - safe subset only, no internal ids. */
  async lookupInviteByToken(token: string): Promise<{
    caseTitle: string; caseCnr: string; invitedName: string | null; sourceFirmName: string; reason: string | null; expiresAt: string; requiresEmail: boolean;
  }> {
    const sql = db();
    if (!sql) throw new NotFoundError('Invitation not found');
    await sql`
      update invitations set status = 'expired'
      where token = ${token} and status = 'pending' and expires_at < now()
    `;
    const [row] = await sql<Array<{
      case_title: string; case_cnr: string; invited_name: string | null; firm_name: string;
      message: string | null; status: string; expires_at: Date; email: string | null;
    }>>`
      select c.title as case_title, c.cnr as case_cnr, i.invited_name, i.firm_name, i.message, i.status, i.expires_at, i.email
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
      requiresEmail: !row.email,
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

    const [invRow] = await sql<Array<{
      id: string; case_id: string; firm_id: string; email: string | null; status: string; expires_at: Date;
    }>>`
      select id, case_id, firm_id, email, status, expires_at from invitations
      where token = ${token} and kind = 'co_counsel_handover' limit 1
    `;
    if (!invRow) throw new NotFoundError('Invitation not found');
    if (invRow.status !== 'pending') throw new ConflictError(`This invitation is ${invRow.status}`);
    if (invRow.expires_at.getTime() < Date.now()) throw new ConflictError('This invitation has expired');
    if (!invRow.case_id) throw new UnprocessableEntityError('Invitation has no linked case');

    // Open-link invites (migration 0074) have no email on file - the
    // accepting advocate supplies their own. Email-first invites already
    // know the recipient's address; body.email is ignored for those so a
    // forged body can't redirect an addressed invite to a different inbox.
    const email = invRow.email ?? body.email?.toLowerCase().trim();
    if (!email) throw new BadRequestError('Email is required to accept this invitation');

    const auth = await authService.registerCoCounselGuest({
      name: body.name.trim(),
      email,
      password: body.password,
    });
    const newUser = auth.user;

    const [reqRow] = await sql<Array<{ id: string }>>`
      select id from handover_requests where invitation_id = ${invRow.id} limit 1
    `;

    const grant = await sql.begin(async (tx) => {
      const [g] = await tx<Array<{
        id: string; case_id: string; guest_user_id: string; granting_firm_id: string;
        handover_request_id: string | null; status: string; created_at: Date; revoked_at: Date | null;
      }>>`
        insert into case_guest_grants (case_id, guest_user_id, granting_firm_id, handover_request_id)
        values (${invRow.case_id}::uuid, ${newUser.id}::uuid, ${invRow.firm_id}::uuid, ${reqRow?.id ?? null})
        returning id, case_id, guest_user_id, granting_firm_id, handover_request_id, status, created_at, revoked_at
      `;
      await tx`
        insert into case_assignments (case_id, user_id, role_on_case)
        values (${invRow.case_id}::uuid, ${newUser.id}::uuid, 'collaborator')
        on conflict (case_id, user_id) do nothing
      `;
      await tx`update invitations set status = 'accepted', accepted_at = now() where id = ${invRow.id}`;
      if (reqRow) {
        await tx`
          update handover_requests
          set status = 'accepted', resolved_at = now(), target_user_id = ${newUser.id}::uuid, attributed_signup = true
          where id = ${reqRow.id}::uuid
        `;
      }
      await tx`
        update users set acquired_via = 'co_counsel_handover', acquired_via_handover_id = ${reqRow?.id ?? null}
        where id = ${newUser.id}::uuid
      `;
      return g!;
    });

    return {
      auth,
      grant: grantFromRow(grant),
      upsell: { eligible: true },
    };
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
