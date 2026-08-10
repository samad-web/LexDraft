// =============================================================================
// drafting-prompts-smoke — renders all four stage prompts for a sample brief so
// a developer can SEE the grounding contract without wiring an LLM yet.
//
// It uses the real offence-kb.json as the candidate source for Stage 2, so you
// can confirm the classifier is only ever offered real, KB-backed sections.
//
//   run:  npx tsx apps/api/src/scripts/drafting-prompts-smoke.ts
// =============================================================================

import kbRaw from '../data/offence-kb.json';
import {
  buildExtractStage,
  buildClassifyStage,
  buildDraftStage,
  buildVerifyStage,
  type OffenceCandidate,
} from '../lib/drafting-prompts';

interface KbEntry {
  id: string;
  offenceName: string;
  law: string;
  section: string;
  sectionTitle: string;
  aliases: string[];
  essentialIngredients: string[];
  commonlyConfusedWith: string[];
  verification: string;
}
const entries = (kbRaw as { entries: KbEntry[] }).entries;

// A realistic bail brief an advocate might dictate.
const BRIEF =
  'Bail application for my client Ramesh Kumar. He was arrested on 5 August 2026 in ' +
  'FIR 112/2025 at Ashok Nagar Police Station. Allegation is cheating — the complainant ' +
  'says Ramesh took Rs 4,00,000 promising a flat booking and never delivered. Ramesh has ' +
  'no prior record, is a permanent resident, and is ready to cooperate with the investigation. ' +
  'We are moving before the Court of Session. Relief: regular bail.';

// ---- Stage 1 ---------------------------------------------------------------
const s1 = buildExtractStage({
  docType: 'regular_bail',
  requiredFields: ['applicant_name', 'fir_no', 'police_station', 'court', 'relief_sought'],
  brief: BRIEF,
});

// ---- naive retrieval for the smoke test (alias substring match) ------------
// Production uses the offence-kb.service (alias/keyword/vector). Here we just
// show that Stage 2 is only ever handed REAL KB ids.
function retrieve(pleaWords: string[]): OffenceCandidate[] {
  const hay = pleaWords.join(' ').toLowerCase();
  return entries
    .filter((e) => e.aliases.some((a) => hay.includes(a.toLowerCase())))
    .map((e) => ({
      id: e.id,
      offenceName: e.offenceName,
      law: e.law,
      section: e.section,
      sectionTitle: e.sectionTitle,
      essentialIngredients: e.essentialIngredients,
      commonlyConfusedWith: e.commonlyConfusedWith,
    }));
}
const candidates = retrieve(['cheating']);

const s2 = buildClassifyStage({
  factsJson: JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: BRIEF }, null, 0),
  candidates,
});

// ---- Stage 3 ---------------------------------------------------------------
// Assume Stage 2 chose bns-318-cheating; the verification gate keeps it SUGGESTED
// because the KB entry is still `needs-review`.
const chosen = entries.find((e) => e.id === 'bns-318-cheating')!;
const s3 = buildDraftStage({
  docType: 'regular_bail',
  forum: 'Court of Session',
  factsJson: JSON.stringify({ facts_narrative: BRIEF }, null, 0),
  sections: [
    {
      citation: `${chosen.law} ${chosen.section}`,
      offenceName: chosen.offenceName,
      verified: chosen.verification === 'verified', // false today -> rendered as SUGGESTED
    },
  ],
  blocks: [
    { block: 'grounds', instruction: 'State the grounds for grant of bail (no prior record, roots in community, willingness to cooperate).' },
    { block: 'prayer', instruction: 'Precise relief: regular bail pending trial.' },
  ],
});

// ---- Stage 4 ---------------------------------------------------------------
const s4 = buildVerifyStage({
  draftText:
    'It is respectfully submitted that the applicant is falsely implicated in an offence ' +
    'which may attract BNS 318(4), subject to counsel’s confirmation...',
  allowedCitations: ['BNS 318(4)'],
  factsJson: JSON.stringify({ facts_narrative: BRIEF }, null, 0),
});

function show(title: string, p: { system: string; user: string }): void {
  // eslint-disable-next-line no-console
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
  // eslint-disable-next-line no-console
  console.log('--- SYSTEM ---\n' + p.system);
  // eslint-disable-next-line no-console
  console.log('\n--- USER ---\n' + p.user);
}

// eslint-disable-next-line no-console
console.log(`Retrieved ${candidates.length} KB candidate(s) for "cheating": ${candidates.map((c) => c.id).join(', ')}`);
show('STAGE 1 — EXTRACT', s1);
show('STAGE 2 — CLASSIFY (candidates are REAL KB ids only)', s2);
show('STAGE 3 — DRAFT (318(4) rendered as SUGGESTED, not VERIFIED)', s3);
show('STAGE 4 — VERIFY (audits against allowed citations)', s4);
