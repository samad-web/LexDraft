// Validates the isGarbled() filter against real corpus chunks. Reports
// false-positive risk (legitimate non-English flagged as broken) and
// false-negative risk (broken text that slipped through).

import postgres from 'postgres';
import { env } from '../src/env';

// Inline copy of the production heuristic — keep them in sync.
const ENGLISH_ANCHORS = /\b(the|of|and|or|to|in|by|is|be|for|with|a|an|act|section|shall|any|no|all|such|under|this|that|government|state|central|rules|court|person|provided)\b/i;
const NOISE_SYMBOLS = /[€£¥¢†‡•◦▪▫■□¤¦]/g;

function isGarbled(content: string): boolean {
  if (/[\x00-\x08\x0E-\x1F]/.test(content)) return true;
  if (/\\[:0-9]/.test(content)) return true;
  if (/[~:=*\\|]{4,}/.test(content)) return true;

  const trimmed = content.trim();
  if (trimmed.length < 30) return false;

  const allLetters = (trimmed.match(/\p{L}/gu) ?? []).length;
  const latinLetters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const isPredominantlyLatin = allLetters > 0 && latinLetters / allLetters > 0.5;

  if (isPredominantlyLatin) {
    if (!ENGLISH_ANCHORS.test(trimmed)) return true;
    const noiseCount = (trimmed.match(NOISE_SYMBOLS) ?? []).length;
    if (noiseCount > 0 && noiseCount / trimmed.length > 0.005) return true;
    const tokens = trimmed.split(/\s+/).filter((t) => /\p{L}/u.test(t));
    if (tokens.length >= 8) {
      const wordLike = tokens.filter((t) => /^[A-Za-z]{2,}[A-Za-z'.,;:!?\-]*$/.test(t)).length;
      if (wordLike / tokens.length < 0.55) return true;
    }
  }

  const nonSpace = trimmed.replace(/\s+/g, '');
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

    console.log('\n--- Test 0a: original user paste (mangled punctuation) ---');
    const sample = "1221 ======:===-:_=================== l:l1O'Tf 'lro1fFf-{tflf'fW'fr 'for f1<mr, '1UewfT 'liT *mI'f ~.-f-'1f01''f,l1 (l'fT W-<mft 'liT lW<mT ~ <t. ~il'f)r~, ;jfr ~...:rtf(7)\"k'l.r <i fc;7{r 'fir ~\",fi ;rru lIT ~rri tl\"itrr tM7!1'fir ~r~ \"-t: f..fl' 7Jqf~,'iQ\\ erf'itf rr~f :f,r <ifTtnTt.";
    console.log(`  [${isGarbled(sample) ? 'FILTERED' : 'KEPT    '}] (synthetic — user paste 1)`);

    console.log('\n--- Test 0b: second user paste (currency/degree noise) ---');
    const sample2 = "GSHRA\nr'_—.—__ \"n 4 (9) 699 €896Q £Q UQR QUIAAT_ \" FIQGAR] ¥ ARICK L85 SARG wé 60 9A19 9QE Qg | WTEY 2eQ 6 9T 9QRR AAR] Qceqiq edled Qa QsAIee 6QRAIG 419 4Q, UIQQ 48 YA SICQl YeasA | (2) €99 68937, 8@, QG QUIACR, TM FIAQ W RUEA LNEH @R AR CAg GIIQ Qag S8 mL 10TQ oy Q?.IGQ COOR T 8° 9GIR ARG QAIQIe WrEs &R 6QQ Q flBSQ | 4996} 62 ML @IATQ W 496 aeq nes § LTe9 GAR AAR 8Rg T 1°° Q 34° GAlA QY";
    console.log(`  [${isGarbled(sample2) ? 'FILTERED' : 'KEPT    '}] (synthetic — user paste 2)`);

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
