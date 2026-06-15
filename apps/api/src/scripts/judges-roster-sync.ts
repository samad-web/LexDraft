/* eslint-disable no-console */
/**
 * Sync the sitting-judge roster for all 25 High Courts from the public source
 * into `court_judges`.
 *
 * Usage:
 *   pnpm --filter @lexdraft/api exec tsx src/scripts/judges-roster-sync.ts
 *   pnpm --filter @lexdraft/api exec tsx src/scripts/judges-roster-sync.ts --dry
 *
 * --dry  : fetch + parse + print the per-court counts, but do not write to the DB.
 *
 * Network access is required (one GET to the Wikipedia parse API).
 */
import { syncHighCourtJudges, parseRoster } from '../services/judges-roster.service';
import { closeDb } from '../db/client';

const DRY = process.argv.includes('--dry');

async function main() {
  if (DRY) {
    // Parse-only path: re-fetch and parse without touching the DB.
    const res = await fetch(
      'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_sitting_judges_of_the_high_courts_of_India&prop=text&format=json',
      { headers: { 'User-Agent': 'LexDraft/1.0 judges-roster dry-run' } },
    );
    const json = (await res.json()) as { parse: { text: { '*': string } } };
    const judges = parseRoster(json.parse.text['*']);
    const perCourt: Record<string, number> = {};
    for (const j of judges) perCourt[j.highCourt] = (perCourt[j.highCourt] ?? 0) + 1;
    printSummary(judges.length, perCourt, false);
    return;
  }

  console.log('→ Fetching + parsing public roster and syncing to court_judges…');
  const summary = await syncHighCourtJudges();
  printSummary(summary.totalJudges, summary.perCourt, summary.persisted);
}

function printSummary(total: number, perCourt: Record<string, number>, persisted: boolean) {
  const courts = Object.keys(perCourt).sort();
  console.log(`\n=== ${courts.length} High Courts, ${total} sitting judges ===`);
  for (const c of courts) {
    console.log(`  ${c.replace(' High Court', '').padEnd(32)} ${perCourt[c]}`);
  }
  console.log(persisted ? '\n✔ persisted to court_judges' : '\n(dry run — not persisted)');
}

main()
  .catch((err) => {
    console.error('✘ judges-roster sync failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
