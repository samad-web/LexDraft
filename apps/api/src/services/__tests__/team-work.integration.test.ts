/**
 * team-work (build-docs/features/team-work.md): tasks assigned to a real
 * member, the member is told, live workload per member. Real Postgres;
 * WhatsApp stubbed.
 */
import { vi } from 'vitest';

const wa = vi.hoisted(() => ({ sent: [] as Array<{ phone: string; template: string; params: Record<string, string> }> }));
vi.mock('../whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async () => undefined,
    sendTemplate: async (phone: string, template: string, params: Record<string, string>) => { wa.sent.push({ phone, template, params }); },
  },
}));

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { env } from '../../env';
import { tasksService } from '../tasks.service';
import { notifyCaseLead, teamWorkload } from '../team-work.service';

const sql = () => getIntegrationSql();
// The throwaway test schema keeps 0001's colour priorities: 0007 checks pg_type
// database-wide, sees the migrated public type and skips (the known migration
// idempotency issue). Give this schema the real values, as production has.
beforeAll(async () => {
  const [old] = await sql()<{ n: number }[]>`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_priority' and t.typnamespace = to_regnamespace(current_schema()) and e.enumlabel = 'amber'`;
  if (old!.n) {
    for (const [a, b] of [['vermillion', 'very_high'], ['amber', 'high'], ['cobalt', 'medium'], ['sage', 'low']]) {
      await sql().unsafe(`alter type task_priority rename value '${a}' to '${b}'`);
    }
  }
});
afterEach(() => { wa.sent.length = 0; (env as { WHATSAPP_ASSIGN_TEMPLATE: string }).WHATSAPP_ASSIGN_TEMPLATE = ''; });

async function firmWithTeam() {
  const firm = await seedFirm(`Team ${Date.now()}`, 'Firm');
  const head = await seedUser(firm.id, { name: 'Anantha Krishnan', role: 'Managing Partner', systemRole: 'Firm Admin' });
  const asha = await seedUser(firm.id, { name: 'Asha Rao', role: 'Associate', systemRole: 'Associate' });
  return { firm, head, asha };
}
const notes = async (userId: string) =>
  sql()<Array<{ title: string; body: string | null; view: string }>>`select title, body, view from notifications where user_id = ${userId}::uuid order by created_at`;
const task = (assigneeUserId?: string) => ({
  title: 'Draft written statement', case: 'Rao v. Krishna Agencies', due: '2030-01-15', priority: 'high' as const,
  assignee: 'ME', comments: 0, column: 'pending' as const, ...(assigneeUserId ? { assigneeUserId } : {}),
});

describe('team-work: assign a task to a member', () => {
  it('AC1: the task is saved for the member (initials on the board) and by whom; the member gets a bell', async () => {
    const { firm, head, asha } = await firmWithTeam();
    const t = await tasksService.create(task(asha.id), firm.id, { id: head.id, name: head.name });
    expect(t).toMatchObject({ assignee: 'AR', assigneeUserId: asha.id, assigneeName: 'Asha Rao', createdByUserId: head.id });
    const board = await tasksService.board(firm.id);
    expect(board.pending.find((x) => x.id === t.id)).toMatchObject({ assigneeUserId: asha.id, assigneeName: 'Asha Rao', createdByUserId: head.id });
    const n = await notes(asha.id);
    expect(n).toEqual([expect.objectContaining({ title: 'Anantha Krishnan assigned you a task', view: 'tasks?mine=1' })]);
    expect(n[0]!.body).toContain('Draft written statement');
    expect(await notes(head.id)).toEqual([]); // no bell for the one assigning
  });

  it('AC2: someone outside the firm can never be assigned (400 not_a_member), nothing saved', async () => {
    const { firm, head } = await firmWithTeam();
    const other = await firmWithTeam();
    await expect(tasksService.create(task(other.asha.id), firm.id, { id: head.id, name: head.name }))
      .rejects.toMatchObject({ status: 400, code: 'not_a_member' });
    const board = await tasksService.board(firm.id);
    expect(board.pending).toHaveLength(0);
  });

  it('AC3: re-assigning tells the new member only; a task assigned to yourself sends nothing', async () => {
    const { firm, head, asha } = await firmWithTeam();
    const ravi = await seedUser(firm.id, { name: 'Ravi Kumar', role: 'Associate', systemRole: 'Associate' });
    const t = await tasksService.create(task(head.id), firm.id, { id: head.id, name: head.name });
    expect(await notes(head.id)).toEqual([]);
    await tasksService.update(t.id, { assigneeUserId: asha.id }, firm.id, { id: head.id, name: head.name });
    await tasksService.update(t.id, { assigneeUserId: asha.id, title: 'Draft WS (v2)' }, firm.id, { id: head.id, name: head.name });
    expect(await notes(asha.id)).toHaveLength(1); // same person again: no second bell
    await tasksService.update(t.id, { assigneeUserId: ravi.id }, firm.id, { id: head.id, name: head.name });
    expect(await notes(ravi.id)).toHaveLength(1);
  });

  it('AC4: WhatsApp only with the template switched on and a verified number', async () => {
    const { firm, head, asha } = await firmWithTeam();
    await sql()`update users set phone = '+919876500011', phone_verified_at = now() where id = ${asha.id}::uuid`;
    await tasksService.create(task(asha.id), firm.id, { id: head.id, name: head.name });
    expect(wa.sent).toHaveLength(0); // template off
    (env as { WHATSAPP_ASSIGN_TEMPLATE: string }).WHATSAPP_ASSIGN_TEMPLATE = 'difai_work_assigned';
    await tasksService.create({ ...task(asha.id), title: 'File vakalat' }, firm.id, { id: head.id, name: head.name });
    expect(wa.sent).toEqual([expect.objectContaining({ phone: '+919876500011', template: 'difai_work_assigned' })]);
    expect(wa.sent[0]!.params).toMatchObject({ member_name: 'Asha Rao', assigned_by: 'Anantha Krishnan', work: 'Task: File vakalat', due_date: '15 Jan 2030' });
  });
});

describe('team-work: case lead and workload', () => {
  it('AC5: the new case lead gets a bell naming the case', async () => {
    const { firm, head, asha } = await firmWithTeam();
    const [c] = await sql()<{ id: string }[]>`insert into cases (firm_id, cnr, title, court, stage, client, status, type, kind)
      values (${firm.id}::uuid, 'OS 12/2026', 'Rao v. Krishna Agencies', 'City Civil Court', 'Arguments', 'Venkat Rao', 'Active', 'Civil', 'matter') returning id`;
    await notifyCaseLead(firm.id, c!.id, asha.id, head.id);
    expect(await notes(asha.id)).toEqual([expect.objectContaining({ title: 'Anantha Krishnan made you lead on a case', body: 'Rao v. Krishna Agencies', view: 'cases' })]);
  });

  it('AC6: workload counts each member\'s own lead cases, hearings this week and open/overdue tasks', async () => {
    const { firm, head, asha } = await firmWithTeam();
    const [c] = await sql()<{ id: string }[]>`insert into cases (firm_id, cnr, title, court, stage, client, status, type, kind)
      values (${firm.id}::uuid, 'CC 9/2026', 'Sundaram v. Kumar', 'JM Egmore', 'Evidence', 'Sundaram', 'Active', 'Criminal', 'matter') returning id`;
    await sql()`insert into case_assignments (case_id, user_id, role_on_case) values (${c!.id}::uuid, ${asha.id}::uuid, 'lead')`;
    await sql()`insert into hearings (case_id, case_label, hearing_time, court, purpose, status, hearing_date, firm_id, assigned_to_user_id)
      values (${c!.id}::uuid, 'Sundaram v. Kumar', '10:30 AM', 'JM Egmore', 'Evidence', 'upcoming', (now() at time zone 'Asia/Kolkata')::date + 2, ${firm.id}::uuid, ${asha.id}::uuid)`;
    await tasksService.create(task(asha.id), firm.id, { id: head.id, name: head.name });
    await tasksService.create({ ...task(asha.id), due: '2020-01-01' }, firm.id, { id: head.id, name: head.name });
    const done = await tasksService.create({ ...task(asha.id), column: 'done' }, firm.id, { id: head.id, name: head.name });
    expect(done.column).toBe('done');
    const w = await teamWorkload(firm.id);
    expect(w.find((m) => m.userId === asha.id)).toMatchObject({ leadCases: 1, hearingsThisWeek: 1, openTasks: 2, overdueTasks: 1, role: 'Associate' });
    expect(w.find((m) => m.userId === head.id)).toMatchObject({ leadCases: 0, hearingsThisWeek: 0, openTasks: 0, overdueTasks: 0 });
  });
});

describe('hearing reminders (eCourts sync follow-up, 2026-11-18)', () => {
  async function caseWithHearingIn(firmId: string, days: number, createdBy: string) {
    const [c] = await sql()<{ id: string }[]>`insert into cases (firm_id, cnr, title, court, stage, client, status, type, kind, next_hearing, created_by_user_id)
      values (${firmId}::uuid, ${`CC ${Date.now()}`}, 'Gupta Traders v. Malhotra', 'JM Saket', 'Evidence', 'Gupta Traders', 'Active', 'Criminal', 'matter',
              current_date + ${days}::int, ${createdBy}::uuid) returning id`;
    return c!.id;
  }

  it('AC9: the reminder goes to the case lead, not only the creator', async () => {
    const { sendUpcomingHearingReminders } = await import('../case-sync.service');
    const { firm, head, asha } = await firmWithTeam();
    const id = await caseWithHearingIn(firm.id, 2, head.id);
    await sql()`insert into case_assignments (case_id, user_id, role_on_case) values (${id}::uuid, ${asha.id}::uuid, 'lead')`;
    await sendUpcomingHearingReminders({ caseId: id });
    expect((await notes(asha.id)).map((n) => n.title)).toEqual(['Hearing in 2 days: Gupta Traders v. Malhotra']);
    expect(await notes(head.id)).toEqual([]);
  });

  it('AC10: WhatsApp once, the day before, from the daily run only, with the template on', async () => {
    const { sendUpcomingHearingReminders } = await import('../case-sync.service');
    const { firm, head } = await firmWithTeam();
    await sql()`update users set phone = '+919876500022', phone_verified_at = now() where id = ${head.id}::uuid`;
    const tomorrow = await caseWithHearingIn(firm.id, 1, head.id);
    await caseWithHearingIn(firm.id, 3, head.id);
    (env as { WHATSAPP_HEARING_TEMPLATE: string }).WHATSAPP_HEARING_TEMPLATE = 'difai_hearing_reminder';
    await sendUpcomingHearingReminders({ caseId: tomorrow }); // on-save: bell only
    expect(wa.sent).toHaveLength(0);
    await sendUpcomingHearingReminders(); // the 9 AM run
    const mine = wa.sent.filter((m) => m.phone === '+919876500022');
    expect(mine).toHaveLength(1); // only the hearing tomorrow, not the one in 3 days
    expect(mine[0]).toMatchObject({ template: 'difai_hearing_reminder', params: { case_title: 'Gupta Traders v. Malhotra', court: 'JM Saket' } });
    (env as { WHATSAPP_HEARING_TEMPLATE: string }).WHATSAPP_HEARING_TEMPLATE = '';
  });
});
