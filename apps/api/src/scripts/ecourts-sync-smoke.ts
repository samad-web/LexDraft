/* eslint-disable no-console */
/**
 * End-to-end smoke test for the eCourts sync pipeline.
 *
 *   1. Picks a firm from the DB.
 *   2. Inserts a temp `cases` row with a known-good CNR.
 *   3. Calls `syncCaseFromEcourts` (the same path the HTTP route uses).
 *   4. Re-reads cases + case_acts + case_parties + hearings and prints them.
 *   5. Deletes the temp row (cascades clean up acts, parties, hearings).
 *
 * Usage: `pnpm --filter @lexdraft/api exec tsx src/scripts/ecourts-sync-smoke.ts [CNR]`
 *
 * Requires DATABASE_URL set and migration 0053 applied.
 */
import { db, closeDb } from '../db/client';
import { syncCaseFromEcourts } from '../services/case-sync.service';
import { casesService } from '../services/cases.service';
import { caseActsService } from '../services/case-acts.service';
import { casePartiesService } from '../services/case-parties.service';

const SAMPLE_CNR = (process.argv[2] ?? 'KLER010001682023').toUpperCase();
const TEMP_TITLE = '[smoke-test] eCourts sync temp matter';

async function main() {
  const sql = db();
  if (!sql) {
    console.error('No DATABASE_URL configured — cannot run smoke test');
    process.exit(2);
  }

  console.log(`→ Using sample CNR ${SAMPLE_CNR}`);

  // 1. Pick any firm (the script is read/write to one firm + creates one row).
  const [firm] = await sql<Array<{ id: string; name: string }>>`
    select id, name from firms limit 1
  `;
  if (!firm) {
    console.error('No firms in the DB — cannot run smoke test');
    process.exit(3);
  }
  console.log(`→ Using firm ${firm.name} (${firm.id})`);

  // 2. Insert a temp case. We use a fresh random suffix on the CNR field if
  //    one with this exact CNR already exists in this firm — but the global
  //    UNIQUE constraint on cnr means duplicates are impossible across firms.
  //    Clean up first if a previous run left a row behind.
  // Clean up any leftover from a previous run — by title (firm-scoped) AND
  // by CNR (global, since the column has a unique constraint).
  await sql`
    delete from cases
    where (firm_id = ${firm.id}::uuid and title = ${TEMP_TITLE})
       or  cnr = ${SAMPLE_CNR}
  `;
  const [created] = await sql<Array<{ id: string }>>`
    insert into cases (firm_id, cnr, title, court, stage, client, status, type, kind)
    values (${firm.id}::uuid, ${SAMPLE_CNR}, ${TEMP_TITLE},
            'pending sync', 'pending sync', '', 'Active', 'pending', 'matter')
    returning id
  `;
  if (!created) {
    console.error('Could not create temp case');
    process.exit(4);
  }
  const caseId = created.id;
  console.log(`→ Created temp case ${caseId}`);

  try {
    // 3. Run the sync — same code path the HTTP route hits.
    console.log('→ Syncing from eCourts…');
    const result = await syncCaseFromEcourts(caseId, firm.id);

    console.log('\n=== sync result ===');
    console.log({
      changes: result.changes,
      hearingsReplaced: result.hearingsReplaced,
      actsReplaced: result.actsReplaced,
      partiesReplaced: result.partiesReplaced,
      side: result.side,
      surfaceOnly: result.surfaceOnly,
    });

    // 4. Re-read everything and prove it landed.
    const stored = await casesService.get(caseId, firm.id);
    console.log('\n=== cases row (after sync) ===');
    console.log({
      title:        stored?.title,
      court:        stored?.court,
      client:       stored?.client,
      status:       stored?.status,
      next:         stored?.next,
      type:         stored?.type,
      judge:        stored?.judge,
      filingNo:     stored?.filingNo,
      efilNo:       stored?.efilNo,
      stateCode:    stored?.stateCode,
      districtCode: stored?.districtCode,
      courtCode:    stored?.courtCode,
      estCode:      stored?.estCode,
      firNo:        stored?.firNo,
      firYear:      stored?.firYear,
      firDetails:   stored?.firDetails,
      policeStCode: stored?.policeStCode,
      ecourtsSyncedAt: stored?.ecourtsSyncedAt,
    });

    const acts = await caseActsService.listForCase(caseId, firm.id);
    console.log(`\n=== case_acts (${acts.length}) ===`);
    for (const a of acts) {
      console.log(`  ${a.actName.padEnd(30)} §${a.section}`);
    }

    const parties = await casePartiesService.listForCase(caseId, firm.id);
    console.log(`\n=== case_parties (${parties.length}) ===`);
    for (const p of parties) {
      const lbl = p.roleLabel ? ` (${p.roleLabel})` : '';
      const adv = p.advocateName ? ` — adv: ${p.advocateName}` : '';
      console.log(`  ${p.side.padEnd(11)} ${p.partyName}${lbl}${adv}`);
    }

    const hearings = await sql<Array<{ hearing_date: string; purpose: string; judge: string }>>`
      select hearing_date::text as hearing_date, purpose, judge
      from hearings where case_id = ${caseId}::uuid
      order by hearing_date nulls last
    `;
    console.log(`\n=== hearings (${hearings.length}) ===`);
    for (const h of hearings) {
      console.log(`  ${(h.hearing_date ?? '').padEnd(12)} ${h.purpose} — ${h.judge ?? ''}`);
    }

    console.log('\n✔ smoke test passed');
  } finally {
    // 5. Clean up the temp row. ON DELETE CASCADE removes its acts, parties,
    //    hearings, assignments, etc.
    await sql`delete from cases where id = ${caseId}::uuid`;
    console.log(`→ Cleaned up temp case ${caseId}`);
    await closeDb();
  }
}

main().catch(async (err) => {
  console.error('✘ smoke test failed:', err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
