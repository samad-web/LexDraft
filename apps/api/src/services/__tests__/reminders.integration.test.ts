/**
 * Reminders against real Postgres. Maps to the acceptance criteria in
 * build-docs/features/reminders.md (AC1-AC4).
 */
import { describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { remindersService } from '../reminders.service';
import { sendDiaryReminders } from '../case-sync.service';

const sql = () => getIntegrationSql();

async function firmWithCase(name: string, nextHearing: string | null = null) {
  const firm = await seedFirm(name, 'Solo');
  const user = await seedUser(firm.id);
  await sql()`update users set status = 'active' where id = ${user.id}::uuid`;
  const [c] = await sql()<{ id: string }[]>`
    insert into cases (firm_id, cnr, title, court, stage, client, status, type, next_hearing, created_by_user_id)
    values (${firm.id}::uuid, ${'CNR-' + name}, ${name + ' v. State'}, 'Madras HC', 'Filing', 'Client', 'Active', 'Civil', ${nextHearing}, ${user.id}::uuid)
    returning id`;
  return { firmId: firm.id, userId: user.id, caseId: c!.id };
}

const notes = (userId: string) =>
  sql()<{ title: string; view: string; dedupe_key: string }[]>`select title, view, dedupe_key from notifications where user_id = ${userId}::uuid order by created_at`;

describe('AC1 a reminder set for a time fires once', () => {
  it('sends a due reminder to the bell, linked to the case, exactly once', async () => {
    const { firmId, userId, caseId } = await firmWithCase('Ramesh');
    const r = await remindersService.create(userId, firmId, { caseId, title: 'Prepare cross of PW-1', remindAt: new Date(Date.now() + 120_000).toISOString() });
    expect(r.caseTitle).toBe('Ramesh v. State');
    await sql()`update reminders set remind_at = now() - interval '1 minute' where id = ${r.id}::uuid`;

    const [first, second] = [await remindersService.sendDue(), await remindersService.sendDue()];
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(second.sent).toBe(0);
    const n = await notes(userId);
    expect(n.filter((x) => x.dedupe_key === `reminder:${r.id}`)).toEqual([
      { title: 'Reminder: Prepare cross of PW-1', view: `cases/${caseId}`, dedupe_key: `reminder:${r.id}` },
    ]);
  });

  it('does not send a reminder before its time', async () => {
    const { firmId, userId } = await firmWithCase('Later');
    await remindersService.create(userId, firmId, { title: 'Later', remindAt: new Date(Date.now() + 3_600_000).toISOString() });
    await remindersService.sendDue();
    expect((await notes(userId)).filter((x) => x.title === 'Reminder: Later')).toHaveLength(0);
  });
});

describe('AC2 Court Diary "remind N days before" fires', () => {
  it('notifies the firm on the reminder day', async () => {
    const { firmId, userId } = await firmWithCase('Diary');
    await sql()`insert into diary_entries (firm_id, entry_date, kind, case_label, next_hearing_date, reminder_offset_days)
      values (${firmId}::uuid, (now() at time zone 'Asia/Kolkata')::date, 'hearing', 'Meena v. Rajesh',
              (now() at time zone 'Asia/Kolkata')::date + 2, 2)`;
    const s = await sendDiaryReminders();
    expect(s.reminded).toBeGreaterThanOrEqual(1);
    expect((await notes(userId)).some((x) => x.title === 'Reminder: Meena v. Rajesh - next date in 2 days' && x.view === 'diary')).toBe(true);
  });
});

// AC3 (evening before) is covered by daily-brief.integration.test.ts.

describe('AC4 reminders are private to their owner', () => {
  it('lists and deletes only your own; other firms cannot attach to your case', async () => {
    const mine = await firmWithCase('Mine');
    const other = await firmWithCase('Other');
    const r = await remindersService.create(mine.userId, mine.firmId, { caseId: mine.caseId, title: 'Mine', remindAt: new Date(Date.now() + 600_000).toISOString() });

    expect((await remindersService.list(other.userId)).map((x) => x.id)).not.toContain(r.id);
    expect(await remindersService.remove(other.userId, r.id)).toBe(false);
    await expect(remindersService.create(other.userId, other.firmId, { caseId: mine.caseId, title: 'x', remindAt: new Date(Date.now() + 600_000).toISOString() }))
      .rejects.toThrow(/Case not found/);

    expect((await remindersService.list(mine.userId, mine.caseId)).map((x) => x.id)).toEqual([r.id]);
    expect(await remindersService.remove(mine.userId, r.id)).toBe(true);
    expect(await remindersService.list(mine.userId)).toEqual([]);
  });
});
