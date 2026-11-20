/**
 * Daily brief against real Postgres. Maps to build-docs/features/daily-brief.md
 * AC1-AC5.
 */
import { describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { addDays, dailyBrief, istDay } from '../daily-brief.service';

const sql = () => getIntegrationSql();
const today = istDay(new Date());

async function advocate(name: string, nextHearing: string | null = null) {
  const firm = await seedFirm(name, 'Solo');
  const user = await seedUser(firm.id);
  await sql()`update users set status = 'active' where id = ${user.id}::uuid`;
  const [c] = await sql()<{ id: string }[]>`
    insert into cases (firm_id, cnr, title, court, stage, client, status, type, next_hearing, created_by_user_id)
    values (${firm.id}::uuid, ${'CNR-' + name}, ${name + ' v. State'}, 'Madras HC', 'Filing', 'Client', 'Active', 'Civil', ${nextHearing}, ${user.id}::uuid)
    returning id`;
  return { firmId: firm.id, userId: user.id, caseId: c!.id };
}

const briefs = (userId: string, kind: 'morning' | 'evening') =>
  sql()<{ title: string; body: string; view: string; created_at: Date }[]>`
    select title, body, view, created_at from notifications where user_id = ${userId}::uuid and dedupe_key = ${`brief:${kind}:${today}`}`;

describe('AC1 morning brief at 07:00', () => {
  it('lists an eCourts-synced hearing today and opens the cause list', async () => {
    const a = await advocate('Ravi', today);
    await dailyBrief.sendMorning();
    expect(await briefs(a.userId, 'morning')).toMatchObject([{ title: 'Today: 1 hearing', body: 'Ravi v. State.', view: 'causelist' }]);
  });
});

describe('AC2 quiet day', () => {
  it('names the next hearing; no brief at all when nothing is coming', async () => {
    const later = await advocate('Later', addDays(today, 5));
    const empty = await advocate('Empty');
    await dailyBrief.sendMorning();
    const [b] = await briefs(later.userId, 'morning');
    expect(b?.title).toBe('No hearings today');
    expect(b?.body).toMatch(/^Next: Later v\. State on /);
    expect(await briefs(empty.userId, 'morning')).toHaveLength(0);
  });
});

describe('AC3 evening brief covers eCourts, manual and diary hearings', () => {
  it('counts a case once even when listed in cases and hearings, and adds diary entries', async () => {
    const tomorrow = addDays(today, 1);
    const a = await advocate('Kumar', tomorrow);
    await sql()`insert into hearings (case_id, firm_id, case_label, hearing_time, court, purpose, status, hearing_date)
      values (${a.caseId}::uuid, ${a.firmId}::uuid, 'Kumar v. State', '10:30', 'Madras HC', 'Arguments', 'upcoming', ${tomorrow})`;
    await sql()`insert into diary_entries (firm_id, entry_date, kind, case_label, next_hearing_date)
      values (${a.firmId}::uuid, ${today}, 'hearing', 'Meena v. Rajesh', ${tomorrow})`;
    await dailyBrief.sendEvening();
    expect(await briefs(a.userId, 'evening')).toMatchObject([
      { title: 'Tomorrow: 2 hearings', body: 'Kumar v. State (10:30, Madras HC) · Meena v. Rajesh.' },
    ]);
  });
});

describe('AC4 no double pushes', () => {
  it('morning is sent once; evening updates only when tomorrow changes', async () => {
    const tomorrow = addDays(today, 1);
    const a = await advocate('Once', today);
    await dailyBrief.sendMorning();
    const [m1] = await briefs(a.userId, 'morning');
    await dailyBrief.sendMorning();
    const [m2] = await briefs(a.userId, 'morning');
    expect(m2?.created_at).toEqual(m1?.created_at);

    await sql()`update cases set next_hearing = ${tomorrow} where id = ${a.caseId}::uuid`;
    await dailyBrief.sendEvening();
    const [e1] = await briefs(a.userId, 'evening');
    await dailyBrief.sendEvening();
    const [e2] = await briefs(a.userId, 'evening');
    expect(e1?.title).toBe('Tomorrow: 1 hearing');
    expect(e2?.created_at).toEqual(e1?.created_at);

    await sql()`
      insert into cases (firm_id, cnr, title, court, stage, client, status, type, next_hearing, created_by_user_id)
      values (${a.firmId}::uuid, 'CNR-Once2', 'Second v. State', 'Madras HC', 'Filing', 'Client', 'Active', 'Civil', ${tomorrow}, ${a.userId}::uuid)`;
    await dailyBrief.sendEvening();
    const rows = await briefs(a.userId, 'evening');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Tomorrow: 2 hearings');
  });
});

describe('AC5 switched off', () => {
  it('sends no brief to a user who turned it off', async () => {
    const a = await advocate('Off', today);
    await dailyBrief.setOn(a.userId, false);
    expect(await dailyBrief.isOn(a.userId)).toBe(false);
    await dailyBrief.sendMorning();
    expect(await briefs(a.userId, 'morning')).toHaveLength(0);
  });
});
