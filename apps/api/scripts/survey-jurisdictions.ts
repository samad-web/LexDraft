// Surveys the corpus to see what jurisdictional prefixes appear in act
// titles. Drives the detectJurisdiction() heuristic in
// laws-search.service.ts. Safe to delete once tuned.

import postgres from 'postgres';
import { env } from '../src/env';

async function main(): Promise<void> {
  const sql = postgres(env.LAWS_DATABASE_URL!, {
    ssl: env.lawsDatabaseSsl ? 'require' : false,
    max: 1,
  });
  try {
    // Count distinct first-words across all act titles. This is the
    // crudest possible cluster — if a state is well-represented in the
    // corpus it'll dominate the head of this list.
    const rows = await sql<{ first_word: string; n: bigint }[]>`
      select split_part(regexp_replace(short_title, '^[\\s.]+', ''), ' ', 1) as first_word,
             count(*) as n
      from acts
      group by first_word
      order by n desc
      limit 50
    `;
    console.log('Top 50 leading words across act titles:');
    console.log('Word'.padEnd(25), 'Count'.padStart(8));
    console.log('-'.repeat(40));
    for (const r of rows) {
      console.log((r.first_word ?? '').padEnd(25), String(r.n).padStart(8));
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
