import type { TeamMemberWorkload } from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { BadRequestError } from '../lib/errors';
import { logger } from '../logger';
import { notificationsStore } from './notifications.service';
import { whatsappService } from './whatsapp.service';

// =============================================================================
// team-work (owner 2026-11-18, build-docs/features/team-work.md): work is
// assigned to a real member and the member is told — a bell in the app and,
// once the owner has an approved Wasi template (WHATSAPP_ASSIGN_TEMPLATE), a
// WhatsApp message. Plus each member's live workload for the Team page.
// =============================================================================

export interface Member { id: string; name: string; phone: string | null }

/** Initials for the board avatar ("Asha Rao" -> "AR"), max 4 letters. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts.map((p) => p[0]).join('') : (parts[0] ?? '').slice(0, 2);
  return s.toUpperCase().slice(0, 4) || 'ME';
}

/** The active member `userId` of `firmId`, or a 400 (never another firm's user). */
export async function requireMember(firmId: string, userId: string): Promise<Member> {
  const sql = db();
  if (!sql) throw new BadRequestError('Members need the database.');
  const [m] = await sql<Array<{ id: string; name: string; phone: string | null; verified: boolean }>>`
    select id, name, phone, phone_verified_at is not null as verified from users
    where id::text = ${userId} and firm_id = ${firmId}::uuid and status = 'active' and not is_superadmin
    limit 1`;
  if (!m) throw new BadRequestError('Choose a member of your team.', { code: 'not_a_member' });
  return { id: m.id, name: m.name, phone: m.verified ? m.phone : null };
}

const dayLabel = (iso?: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No due date';

/** Tell `member` that `actorName` gave them work. Never throws; no message to yourself. */
export async function notifyAssigned(args: {
  firmId: string; actorId: string; actorName: string; member: Member;
  kind: 'task' | 'case'; title: string; due?: string | null; dedupeKey: string;
}): Promise<void> {
  const { firmId, actorId, actorName, member, kind, title, due, dedupeKey } = args;
  if (member.id === actorId) return;
  const what = kind === 'task' ? `Task: ${title}` : `Case: ${title}`;
  await notificationsStore.create({
    firmId, userId: member.id, tone: 'cobalt', icon: kind === 'task' ? 'tasks' : 'cases',
    view: kind === 'task' ? 'tasks?mine=1' : 'cases',
    title: kind === 'task' ? `${actorName} assigned you a task` : `${actorName} made you lead on a case`,
    body: kind === 'task' ? `${title} · due ${dayLabel(due)}` : title,
    dedupeKey,
  });
  const template = env.WHATSAPP_ASSIGN_TEMPLATE.trim();
  if (template && member.phone) {
    await whatsappService.sendTemplate(member.phone, template, {
      member_name: member.name.slice(0, 60) || 'there',
      assigned_by: actorName.slice(0, 60),
      work: what.slice(0, 200),
      due_date: kind === 'task' ? dayLabel(due) : '-',
      app_link: `${env.webPublicBaseUrl.replace(/\/$/, '')}/app/${kind === 'task' ? 'tasks?mine=1' : 'cases'}`,
    }).catch((err: unknown) => logger.warn({ err, firmId, kind }, 'assignment WhatsApp not sent'));
  }
}

/** Each active member's real workload: lead cases, their hearings this week,
 *  their open and overdue tasks. */
export async function teamWorkload(firmId: string): Promise<TeamMemberWorkload[]> {
  const sql = db();
  if (!sql) return [];
  const rows = await sql<Array<{ id: string; name: string; role: string | null; lead: number; hearings: number; open: number; overdue: number }>>`
    select u.id, u.name, coalesce(r.name, u.role) as role,
      (select count(*)::int from case_assignments ca join cases c on c.id = ca.case_id
         where ca.user_id = u.id and ca.role_on_case = 'lead' and c.firm_id = ${firmId}::uuid
           and c.status in ('Active', 'Pending')) as lead,
      (select count(*)::int from hearings h
         where h.firm_id = ${firmId}::uuid and h.assigned_to_user_id = u.id
           and h.hearing_date between (now() at time zone 'Asia/Kolkata')::date
                                  and (now() at time zone 'Asia/Kolkata')::date + 6) as hearings,
      (select count(*)::int from tasks t
         where t.firm_id = ${firmId}::uuid and t.assignee_user_id = u.id and t.column_name <> 'done') as open,
      (select count(*)::int from tasks t
         where t.firm_id = ${firmId}::uuid and t.assignee_user_id = u.id and t.column_name <> 'done'
           and t.due_date < (now() at time zone 'Asia/Kolkata')::date) as overdue
    from users u left join roles r on r.id = u.role_id
    where u.firm_id = ${firmId}::uuid and u.status = 'active' and not u.is_superadmin
    order by u.created_at`;
  return rows.map((r) => ({
    userId: r.id, name: r.name, role: r.role ?? 'Member',
    leadCases: r.lead, hearingsThisWeek: r.hearings, openTasks: r.open, overdueTasks: r.overdue,
  }));
}

/** The signed-in user as the one assigning work (name for the message). */
export async function actorFor(userId: string | undefined): Promise<{ id: string; name: string } | undefined> {
  const sql = db();
  if (!sql || !userId) return undefined;
  const [u] = await sql<Array<{ id: string; name: string }>>`select id, name from users where id::text = ${userId} limit 1`;
  return u ? { id: u.id, name: u.name || 'A colleague' } : undefined;
}

/** After PUT /cases/:id/lead: tell the new lead. Never throws. */
export async function notifyCaseLead(firmId: string | null, caseId: string, leadUserId: string, actorUserId: string | undefined): Promise<void> {
  const sql = db();
  if (!sql || !firmId) return;
  try {
    const [c] = await sql<Array<{ title: string }>>`select title from cases where id::text = ${caseId} and firm_id = ${firmId}::uuid limit 1`;
    const actor = await actorFor(actorUserId);
    if (!c || !actor) return;
    const member = await requireMember(firmId, leadUserId);
    await notifyAssigned({ firmId, actorId: actor.id, actorName: actor.name, member, kind: 'case', title: c.title, dedupeKey: `case-lead:${caseId}:${member.id}` });
  } catch (err) {
    logger.warn({ err, caseId }, 'case-lead notification not sent');
  }
}
