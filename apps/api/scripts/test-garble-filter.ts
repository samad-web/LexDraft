// Validates the isGarbled() filter against real corpus chunks. Reports
// false-positive risk (legitimate non-English flagged as broken) and
// false-negative risk (broken text that slipped through).

import postgres from 'postgres';
import { env } from '../src/env';

// Inline copy of the production heuristic — keep them in sync.
function isGarbled(content: string): boolean {
  if (/[\x00-\x08\x0E-\x1F]/.test(content)) return true;
  if (/\\[:0-9]/.test(content)) return true;
  if (/[~:=*\\|]{4,}/.test(content)) return true;
  const nonSpace = content.replace(/\s+/g, '');
  if (nonSpace.length < 30) return false;
  const valid = nonSpace.match(/[\p{L}\p{M}\p{N}.,;:()'"\-–—]/gu);
  const ratio = (valid?.length ?? 0) / nonSpace.length;
  return ratio < 0.65;
}

async function main(): Promise<void> {
  const sql = postgres(env.LAWS_DATABASE_URL!, {
    ssl: env.lawsDatabaseSsl ? 'require' : false,
    max: 1,
  });

  try {
    // Headline: how much of the corpus does the calibrated filter drop?
    console.log('--- Corpus-wide impact ---');
    const sampleAll = await sql<{ content: string }[]>`
      select content from chunks order by random() limit 5000
    `;
    let dropped = 0;
    for (const r of sampleAll) if (isGarbled(r.content)) dropped++;
    console.log(`  ${dropped} / ${sampleAll.length} of a 5000-row sample = ${(dropped / sampleAll.length * 100).toFixed(2)}%`);

    console.log('--- Test 1: known-broken Tamil/Malayalam acts ---');
    const broken = await sql<{ act: string; content: string }[]>`
      select a.short_title as act, c.content
      from chunks c
      join acts a on a.id = c.act_id
      where a.short_title in (
        'Tamil Nadu Silkworm Diseases (Prevention and Eradication) Act, 1948',
        'Kerala Lifts and Escalators Act, 2013',
        'Tamil Nadu Prevention of Begging Act, 1945'
      )
      limit 5
    `;
    for (const r of broken) {
      const flagged = isGarbled(r.content);
      console.log(`  [${flagged ? 'FILTERED' : 'KEPT    '}] ${r.act}`);
      console.log(`              ${r.content.slice(0, 100).replace(/\s+/g, ' ')}…`);
    }

    console.log('\n--- Test 2: legitimate Hindi sections (Electricity Act) ---');
    const hindi = await sql<{ act: string; content: string }[]>`
      select a.short_title as act, c.content
      from chunks c
      join acts a on a.id = c.act_id
      where a.short_title = 'Electricity Act, 2003'
        and c.content ~ '[ऀ-ॿ]'
      limit 3
    `;
    for (const r of hindi) {
      const flagged = isGarbled(r.content);
      console.log(`  [${flagged ? 'FILTERED' : 'KEPT    '}] ${r.act}`);
      console.log(`              ${r.content.slice(0, 100).replace(/\s+/g, ' ')}…`);
    }

    console.log('\n--- Test 0: the kind of garbage user pasted ---');
    const sample = "1221 ======:===-:_=================== l:l1O'Tf 'lro1fFf-{tflf'fW'fr 'for f1<mr, '1UewfT 'liT *mI'f ~.-f-'1f01''f,l1 (l'fT W-<mft 'liT lW<mT ~ <t. ~il'f)r~, ;jfr ~...:rtf(7)\"k'l.r <i fc;7{r 'fir ~\",fi ;rru lIT ~rri tl\"itrr tM7!1'fir ~r~ \"-t: f..fl' 7Jqf~,'iQ\\ erf'itf rr~f :f,r <ifTtnTt.";
    console.log(`  [${isGarbled(sample) ? 'FILTERED' : 'KEPT    '}] (synthetic — user paste)`);

    console.log('\n--- Test 3: clean English sections (BNS) ---');
    const english = await sql<{ act: string; content: string }[]>`
      select a.short_title as act, c.content
      from chunks c
      join acts a on a.id = c.act_id
      where a.short_title = 'Bharatiya Nyaya Sanhita, 2023'
        and c.content !~ '[ऀ-ॿ]'
      limit 3
    `;
    for (const r of english) {
      const flagged = isGarbled(r.content);
      console.log(`  [${flagged ? 'FILTERED' : 'KEPT    '}] ${r.act}`);
      console.log(`              ${r.content.slice(0, 100).replace(/\s+/g, ' ')}…`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
