// =============================================================================
// offence-kb-smoke — functional check of the retrieval service.
//
// Asserts the behaviours Stage 2 depends on:
//   1. plain words ("cheating") retrieve the right entry,
//   2. vernacular/alias ("dhoka") retrieve it too,
//   3. an ambiguous phrase surfaces the confusion-pair,
//   4. candidatesFor() de-dupes across multiple alleged offences,
//   5. every returned candidate is a REAL KB id (no fabrication possible).
//
//   run:  npx tsx apps/api/src/scripts/offence-kb-smoke.ts
// exits non-zero if any assertion fails.
// =============================================================================

import { offenceKbService } from '../services/offence-kb.service';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  // eslint-disable-next-line no-console
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// eslint-disable-next-line no-console
console.log('\n1) plain word "cheating"');
const cheating = offenceKbService.search('cheating');
check('top hit is bns-318-cheating', cheating[0]?.entry.id === 'bns-318-cheating', cheating[0]?.entry.id);
check('top hit is a phrase match (score 1)', cheating[0]?.score === 1, String(cheating[0]?.score));

// eslint-disable-next-line no-console
console.log('\n2) vernacular alias "dhoka"');
const dhoka = offenceKbService.search('dhoka');
check('resolves to bns-318-cheating', dhoka.some((h) => h.entry.id === 'bns-318-cheating'));

// eslint-disable-next-line no-console
console.log('\n3) breach-of-trust wording surfaces the CBT entry (not cheating)');
const cbt = offenceKbService.search('entrusted money misappropriated');
check('bns-316 present in results', cbt.some((h) => h.entry.id === 'bns-316-criminal-breach-of-trust'), cbt.map((h) => h.entry.id).join(', '));

// eslint-disable-next-line no-console
console.log('\n4) grievous hurt by knife');
const hurt = offenceKbService.search('attacked with a knife caused deep wound');
check('surfaces a hurt/weapon offence', hurt.some((h) => ['bns-118-hurt-by-dangerous-weapon', 'bns-117-grievous-hurt'].includes(h.entry.id)), hurt.map((h) => h.entry.id).join(', '));

// eslint-disable-next-line no-console
console.log('\n5) candidatesFor de-dupes across multiple alleged offences');
const pool = offenceKbService.candidatesFor(['cheating', 'criminal breach of trust', 'cheating']);
const ids = pool.map((e) => e.id);
check('no duplicate ids', new Set(ids).size === ids.length, ids.join(', '));
check('includes both cheating and CBT', ids.includes('bns-318-cheating') && ids.includes('bns-316-criminal-breach-of-trust'));

// eslint-disable-next-line no-console
console.log('\n6) grounding guarantee — every candidate id resolves back to the KB');
const allResolve = pool.every((e) => offenceKbService.getById(e.id) !== null);
check('every candidate is a real KB entry', allResolve);

// eslint-disable-next-line no-console
console.log('\n7) confusion-pair expansion for cheating');
const cheatingEntry = offenceKbService.getById('bns-318-cheating')!;
const confused = offenceKbService.expandConfusedWith(cheatingEntry).map((e) => e.id);
check('cheating is confused with CBT', confused.includes('bns-316-criminal-breach-of-trust'), confused.join(', '));

// eslint-disable-next-line no-console
console.log('\n8) exact section lookup');
check('BNS 318(4) -> cheating', offenceKbService.getBySection({ law: 'BNS', section: '318(4)' })?.id === 'bns-318-cheating');

// eslint-disable-next-line no-console
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
if (failures > 0) process.exit(1);
