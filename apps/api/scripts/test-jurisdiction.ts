// Validates detectJurisdiction() against the live corpus. Samples a
// few hundred acts and reports the breakdown plus any titles where
// the heuristic struggles.

import postgres from 'postgres';
import { env } from '../src/env';

// Inline the production heuristic so this script is self-contained.
// Keep in sync with laws-search.service.ts.

interface StateMatcher { canonical: string; patterns: string[] }

const STATES: StateMatcher[] = [
  { canonical: 'Andhra Pradesh',    patterns: ['Andhra Pradesh', 'Andhra'] },
  { canonical: 'Arunachal Pradesh', patterns: ['Arunachal Pradesh', 'Arunachal'] },
  { canonical: 'Assam',             patterns: ['Assam'] },
  { canonical: 'Bihar',             patterns: ['Bihar'] },
  { canonical: 'Chhattisgarh',      patterns: ['Chhattisgarh'] },
  { canonical: 'Goa',               patterns: ['Goa'] },
  { canonical: 'Gujarat',           patterns: ['Gujarat'] },
  { canonical: 'Haryana',           patterns: ['Haryana'] },
  { canonical: 'Himachal Pradesh',  patterns: ['Himachal Pradesh', 'Himachal'] },
  { canonical: 'Jharkhand',         patterns: ['Jharkhand'] },
  { canonical: 'Karnataka',         patterns: ['Karnataka'] },
  { canonical: 'Kerala',            patterns: ['Kerala'] },
  { canonical: 'Madhya Pradesh',    patterns: ['Madhya Pradesh', 'M.P.', 'MP'] },
  { canonical: 'Maharashtra',       patterns: ['Maharashtra', 'Bombay'] },
  { canonical: 'Manipur',           patterns: ['Manipur'] },
  { canonical: 'Meghalaya',         patterns: ['Meghalaya'] },
  { canonical: 'Mizoram',           patterns: ['Mizoram'] },
  { canonical: 'Nagaland',          patterns: ['Nagaland'] },
  { canonical: 'Odisha',            patterns: ['Odisha', 'Orissa'] },
  { canonical: 'Punjab',            patterns: ['Punjab'] },
  { canonical: 'Rajasthan',         patterns: ['Rajasthan'] },
  { canonical: 'Sikkim',            patterns: ['Sikkim'] },
  { canonical: 'Tamil Nadu',        patterns: ['Tamil Nadu', 'Tamilnadu'] },
  { canonical: 'Telangana',         patterns: ['Telangana'] },
  { canonical: 'Tripura',           patterns: ['Tripura'] },
  { canonical: 'Uttar Pradesh',     patterns: ['Uttar Pradesh', 'U.P.', 'UP'] },
  { canonical: 'Uttarakhand',       patterns: ['Uttarakhand', 'Uttaranchal'] },
  { canonical: 'West Bengal',       patterns: ['West Bengal'] },
  { canonical: 'Delhi',             patterns: ['Delhi', 'National Capital Territory'] },
  { canonical: 'Jammu and Kashmir', patterns: ['Jammu and Kashmir', 'Jammu & Kashmir', 'J&K'] },
  { canonical: 'Ladakh',            patterns: ['Ladakh'] },
  { canonical: 'Puducherry',        patterns: ['Puducherry', 'Pondicherry'] },
  { canonical: 'Andaman and Nicobar Islands', patterns: ['Andaman and Nicobar', 'Andaman'] },
  { canonical: 'Chandigarh',        patterns: ['Chandigarh'] },
  { canonical: 'Dadra and Nagar Haveli and Daman and Diu', patterns: ['Dadra', 'Daman'] },
  { canonical: 'Lakshadweep',       patterns: ['Lakshadweep'] },
];

function detect(actTitle: string): { jurisdiction: string; state: string | null } {
  const trimmed = actTitle.replace(/^[\s.,_·:]+/, '').trim();
  const lower = trimmed.toLowerCase();
  for (const s of STATES) {
    for (const p of s.patterns) {
      const pl = p.toLowerCase();
      if (lower.startsWith(pl) && /^[\s.,]/.test(lower.slice(pl.length) || ' ')) {
        return { jurisdiction: 'State', state: s.canonical };
      }
    }
  }
  return { jurisdiction: 'Central', state: null };
}

async function main(): Promise<void> {
  const sql = postgres(env.LAWS_DATABASE_URL!, {
    ssl: env.lawsDatabaseSsl ? 'require' : false,
    max: 1,
  });
  try {
    const rows = await sql<{ short_title: string }[]>`
      select short_title from acts where short_title is not null
    `;

    let central = 0;
    let state = 0;
    const byState = new Map<string, number>();
    const centralSamples: string[] = [];

    for (const r of rows) {
      const d = detect(r.short_title);
      if (d.jurisdiction === 'State' && d.state) {
        state++;
        byState.set(d.state, (byState.get(d.state) ?? 0) + 1);
      } else {
        central++;
        if (centralSamples.length < 15) centralSamples.push(r.short_title);
      }
    }

    console.log(`Total acts: ${rows.length}`);
    console.log(`Central:    ${central} (${(central / rows.length * 100).toFixed(1)}%)`);
    console.log(`State:      ${state} (${(state / rows.length * 100).toFixed(1)}%)`);
    console.log('\nBreakdown by state:');
    console.log('State'.padEnd(35), 'Count'.padStart(8));
    console.log('-'.repeat(50));
    const sorted = Array.from(byState.entries()).sort((a, b) => b[1] - a[1]);
    for (const [s, n] of sorted) console.log(s.padEnd(35), String(n).padStart(8));

    console.log('\nSample of titles classified as Central (sanity check):');
    for (const t of centralSamples) console.log(`  ${t}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
