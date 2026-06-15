import { db } from '../db/client';
import { BadRequestError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../lib/errors';

// =============================================================================
// assignments.service
//
// Handover / assignment of matters and hearings within a firm.
//
// Authorisation model (agreed with the user):
//   - A firm "head" — Firm Admin or Practice Group Lead (or a superadmin) —
//     can assign any matter/hearing to anyone in the firm.
//   - An ordinary advocate can only hand off their OWN work: a matter they
//     currently lead, or a hearing they're currently assigned to (or whose
//     matter they lead). This is the "self-handoff" path.
//
// Case-level lead lives in `case_assignments` (role_on_case='lead'); the
// per-hearing override lives in `hearings.assigned_to_user_id` (migration
// 0059). An unassigned hearing implicitly belongs to the matter's lead.
// =============================================================================

export interface Teammate {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Actor {
  id: string;
  role: string;
  isSuperadmin: boolean;
}

// Role names that count as a firm "head" for assignment purposes. These are
// the seeded system roles with firm-wide authority (see migration 0009).
const HEAD_ROLES: ReadonlySet<string> = new Set(['Firm Admin', 'Practice Group Lead', 'Managing Partner']);

export function isHeadRole(actor: Actor): boolean {
  return actor.isSuperadmin || HEAD_ROLES.has(actor.role);
}

const TEAMMATE_COLS = 'id, name, email, role';

export const assignmentsService = {
  /** Active members of the firm — the pool of people work can be handed to. */
  async listTeammates(firmId: string | null): Promise<Teammate[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    return sql<Teammate[]>`
      select ${sql.unsafe(TEAMMATE_COLS)}
      from users
      where firm_id = ${firmId}::uuid and status = 'active'
      order by name asc
    `;
  },

  /** The current lead advocate on a matter, or null if none assigned. */
  async getCaseLead(caseId: string, firmId: string | null): Promise<Teammate | null> {
    if (!firmId) return null;
    const sql = db();
    if (!sql) return null;
    const [row] = await sql<Teammate[]>`
      select u.id, u.name, u.email, u.role
      from case_assignments ca
      join cases c on c.id = ca.case_id
      join users u on u.id = ca.user_id
      where ca.case_id = ${caseId}::uuid
        and ca.role_on_case = 'lead'
        and c.firm_id = ${firmId}::uuid
      limit 1
    `;
    return row ?? null;
  },

  /**
   * Hand a matter to another advocate (set the lead). Removes the previous
   * lead row and installs the target as lead. Authorised for firm heads, or
   * for the current lead handing off their own matter.
   */
  async setCaseLead(args: {
    caseId: string;
    firmId: string | null;
    targetUserId: string;
    actor: Actor;
  }): Promise<Teammate> {
    const { caseId, firmId, targetUserId, actor } = args;
    if (!firmId) throw new UnprocessableEntityError('No firm attached');
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    const [matter] = await sql<Array<{ id: string }>>`
      select id from cases where id = ${caseId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!matter) throw new NotFoundError('Matter not found');

    const target = await this.requireTeammate(targetUserId, firmId);

    if (!isHeadRole(actor)) {
      const current = await this.getCaseLead(caseId, firmId);
      if (!current || current.id !== actor.id) {
        throw new ForbiddenError('Only the current lead or a firm head can reassign this matter');
      }
    }

    await sql.begin(async (tx) => {
      await tx`delete from case_assignments where case_id = ${caseId}::uuid and role_on_case = 'lead'`;
      await tx`
        insert into case_assignments (case_id, user_id, role_on_case)
        values (${caseId}::uuid, ${targetUserId}::uuid, 'lead')
        on conflict (case_id, user_id) do update set role_on_case = 'lead', assigned_at = now()
      `;
    });
    return target;
  },

  /** The advocate explicitly assigned to a hearing, or null (falls back to lead). */
  async getHearingAssignee(hearingId: string, firmId: string | null): Promise<Teammate | null> {
    if (!firmId) return null;
    const sql = db();
    if (!sql) return null;
    const [row] = await sql<Teammate[]>`
      select u.id, u.name, u.email, u.role
      from hearings h
      join cases c on c.id = h.case_id
      join users u on u.id = h.assigned_to_user_id
      where h.id = ${hearingId}::uuid and c.firm_id = ${firmId}::uuid
      limit 1
    `;
    return row ?? null;
  },

  /**
   * Assign (or clear, with targetUserId=null) a single hearing. Authorised for
   * firm heads, the matter's lead, or the hearing's current assignee.
   */
  async assignHearing(args: {
    hearingId: string;
    firmId: string | null;
    targetUserId: string | null;
    actor: Actor;
  }): Promise<Teammate | null> {
    const { hearingId, firmId, targetUserId, actor } = args;
    if (!firmId) throw new UnprocessableEntityError('No firm attached');
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    const [hearing] = await sql<Array<{ id: string; case_id: string }>>`
      select h.id, h.case_id
      from hearings h
      join cases c on c.id = h.case_id
      where h.id = ${hearingId}::uuid and c.firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!hearing) throw new NotFoundError('Hearing not found');

    let target: Teammate | null = null;
    if (targetUserId) target = await this.requireTeammate(targetUserId, firmId);

    if (!isHeadRole(actor)) {
      const lead = await this.getCaseLead(hearing.case_id, firmId);
      const assignee = await this.getHearingAssignee(hearingId, firmId);
      const mayHandoff = lead?.id === actor.id || assignee?.id === actor.id;
      if (!mayHandoff) {
        throw new ForbiddenError('Only the matter lead, the current assignee, or a firm head can reassign this hearing');
      }
    }

    await sql`
      update hearings h
      set assigned_to_user_id = ${targetUserId}::uuid
      from cases c
      where h.case_id = c.id and h.id = ${hearingId}::uuid and c.firm_id = ${firmId}::uuid
    `;
    return target;
  },

  /** Resolve a target user, asserting they're an active member of the firm. */
  async requireTeammate(userId: string, firmId: string): Promise<Teammate> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');
    const [row] = await sql<Teammate[]>`
      select ${sql.unsafe(TEAMMATE_COLS)}
      from users
      where id = ${userId}::uuid and firm_id = ${firmId}::uuid and status = 'active'
      limit 1
    `;
    if (!row) throw new BadRequestError('That person is not an active member of your firm');
    return row;
  },
};
