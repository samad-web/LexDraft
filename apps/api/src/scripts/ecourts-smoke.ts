/**
 * Manual smoke-test for the eCourts integration. Hits the live API:
 *   1. Bootstraps a JWT through `appReleaseWebService.php`
 *   2. Looks up a known sample CNR (Kerala bail matter)
 *   3. Lists all Indian states (proves reference-data path + JWT reuse)
 *
 * Usage: `pnpm --filter @lexdraft/api exec tsx src/scripts/ecourts-smoke.ts [CNR]`
 *
 * This script bypasses HTTP/auth — it imports the service layer directly,
 * which is enough to validate that the encrypted protocol, JWT bootstrap,
 * and session reuse all work end-to-end. Network access is required.
 */
import { listStates, lookupByCnr } from '../services/ecourts.service';

const SAMPLE_CNR = process.argv[2] ?? 'KLER010001682023';

async function main() {
  console.log(`→ Looking up CNR ${SAMPLE_CNR}…`);
  const history = await lookupByCnr(SAMPLE_CNR);
  if (!history) {
    console.error('No case found.');
    process.exit(1);
  }

  console.log('\n=== case header ===');
  console.log({
    cino:           history.cino,
    case_no:        history.case_no,
    filing_no:      history.filing_no,
    pet:            history.pet_name,
    pet_adv:        history.pet_adv,
    res:            history.res_name,
    date_of_filing: history.date_of_filing,
    decided:        history.date_of_decision ?? '(pending)',
    disposition:   history.disp_name ?? '(pending)',
    court:          history.court_name,
    judge:          history.desgname,
    state:          history.state_name,
    district:       history.district_name,
  });

  if (history.historyOfCaseHearing?.length) {
    console.log(`\n=== ${history.historyOfCaseHearing.length} hearings ===`);
    for (const h of history.historyOfCaseHearing) {
      console.log(`  ${h.todays_date1}  ${h.purpose.padEnd(25)} → ${h.nextdate || '(disposed)'} (${h.judge_name})`);
    }
  }

  if (history.finalOrder?.length) {
    console.log(`\n=== ${history.finalOrder.length} final orders ===`);
    for (const o of history.finalOrder) {
      console.log(`  ${o.order_date1f}  ${o.order_details}  ${o.filename}`);
    }
  }

  console.log('\n→ Fetching states list (also exercises JWT reuse)…');
  const states = await listStates();
  console.log(`Got ${states.length} states. Sample: ${states.slice(0, 3).map((s) => s.state_name).join(', ')}…`);

  console.log('\n✔ smoke test passed');
}

main().catch((err) => {
  console.error('✘ smoke test failed:', err);
  process.exit(1);
});
