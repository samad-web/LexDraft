// =============================================================================
// pipeline-live — runs the REAL four-stage pipeline against the configured LLM
// (reads apps/api/.env). Bypasses the quota/DB wrapper so it can run standalone;
// it exercises the exact same prompts, retrieval, gate, and audit as the route.
//
//   run:  npx tsx apps/api/src/scripts/pipeline-live.ts
//   (uses LLM_PROVIDER / *_API_KEY from apps/api/.env)
// =============================================================================

import 'dotenv/config';
import { offenceKbService } from '../services/offence-kb.service';
import {
  resolveProvider,
  providerTag,
  complete,
  parseJsonLoose,
} from '../lib/llm-drafting';
import {
  buildExtractStage,
  buildClassifyStage,
  buildDraftStage,
  buildVerifyStage,
  type OffenceCandidate,
} from '../lib/drafting-prompts';
import type { OffenceEntry } from '../types/offence-kb.types';

// Scenarios, selectable via the first CLI arg (default: cheating).
const SCENARIOS: Record<string, string> = {
  cheating:
    'Bail application for my client Ramesh Kumar. He was arrested on 5 August 2026 in ' +
    'FIR 112/2025 at Ashok Nagar Police Station. Allegation is cheating — the complainant ' +
    'says Ramesh took Rs 4,00,000 promising a flat booking and never delivered. Ramesh has ' +
    'no prior record, is a permanent resident, and is ready to cooperate with the ' +
    'investigation. We are moving before the Court of Session. Relief: regular bail.',
  // Entrustment-then-dishonesty — should surface CBT (316) as consider_instead vs cheating (318).
  breach_of_trust:
    'Bail for my client Suresh. Complainant handed over Rs 2,00,000 to Suresh in trust to ' +
    'invest on his behalf under a written arrangement, and Suresh later refused to return it ' +
    'and used it for himself. FIR alleges cheating. No prior record. Sessions Court, regular bail.',
  // Grievous hurt by weapon — tests hurt-cluster disambiguation.
  hurt:
    'Bail for my client Anil. Allegation is that during a quarrel he attacked the complainant ' +
    'with a knife causing a deep wound and a fractured arm. FIR at City PS. First offence. ' +
    'Sessions Court, regular bail.',
};

const scenarioKey = process.argv[2] ?? 'cheating';
const BRIEF = SCENARIOS[scenarioKey] ?? SCENARIOS.cheating!;

function toCandidate(e: OffenceEntry): OffenceCandidate {
  return {
    id: e.id, offenceName: e.offenceName, law: e.law, section: e.section,
    sectionTitle: e.sectionTitle, essentialIngredients: e.essentialIngredients,
    commonlyConfusedWith: e.commonlyConfusedWith,
  };
}

function hr(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${'═'.repeat(70)}\n${title}\n${'═'.repeat(70)}`);
}

async function main(): Promise<void> {
  const provider = resolveProvider();
  // eslint-disable-next-line no-console
  console.log(`Provider: ${providerTag(provider)}`);
  if (provider === 'none') {
    // eslint-disable-next-line no-console
    console.log('No LLM key configured — set XAI_API_KEY or ANTHROPIC_API_KEY in apps/api/.env');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`\nSCENARIO: ${scenarioKey}\nBRIEF:\n${BRIEF}`);

  // ---- STAGE 1: EXTRACT ----
  hr('STAGE 1 — EXTRACT (real LLM)');
  const s1 = buildExtractStage({ docType: 'regular_bail', requiredFields: ['applicant_name', 'fir_no', 'court'], brief: BRIEF });
  const r1 = await complete(provider, s1.system, s1.user, 2500);
  const facts = parseJsonLoose<Record<string, unknown>>(r1.text) ?? {};
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(facts, null, 2));

  // ---- RETRIEVAL ----
  const alleged = (facts.alleged_offences as string[] | undefined) ?? [];
  const candidates = offenceKbService.candidatesFor(alleged);
  hr('RETRIEVAL — KB candidates (grounding set)');
  // eslint-disable-next-line no-console
  console.log(`alleged: ${JSON.stringify(alleged)}`);
  // eslint-disable-next-line no-console
  console.log(`candidates: ${candidates.map((c) => `${c.id} (${c.law} ${c.section})`).join(', ') || '(none)'}`);

  // ---- STAGE 2: CLASSIFY ----
  hr('STAGE 2 — CLASSIFY (KB-grounded, real LLM)');
  let selected: Array<{ id: string; confidence?: string; why?: string; ingredients_missing?: string[] }> = [];
  let considerInstead: Array<{ id: string; reason: string }> = [];
  if (candidates.length > 0) {
    const s2 = buildClassifyStage({ factsJson: JSON.stringify(facts), candidates: candidates.map(toCandidate) });
    const r2 = await complete(provider, s2.system, s2.user, 1500);
    const parsed = parseJsonLoose<{ selected?: typeof selected; consider_instead?: typeof considerInstead; unresolved?: string[] }>(r2.text) ?? {};
    const candidateIds = new Set(candidates.map((c) => c.id));
    selected = (parsed.selected ?? []).filter((s) => candidateIds.has(s.id)); // grounding guard
    considerInstead = (parsed.consider_instead ?? []).filter((c) => offenceKbService.getById(c.id));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ selected, consider_instead: considerInstead, unresolved: parsed.unresolved }, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log('(no candidates — nothing to classify)');
  }

  // ---- GATE ----
  hr('GATE — verified vs suggested');
  const sections = selected
    .map((sel) => {
      const e = offenceKbService.getById(sel.id);
      if (!e) return null;
      return { citation: `${e.law} ${e.section}`, offenceName: e.offenceName, verified: e.verification === 'verified', status: e.verification };
    })
    .filter((s): s is NonNullable<typeof s> => !!s);
  for (const s of sections) {
    // eslint-disable-next-line no-console
    console.log(`  ${s.verified ? '✓ VERIFIED ' : '• SUGGESTED'}  ${s.citation} — ${s.offenceName}  [${s.status}]`);
  }

  // ---- STAGE 3: DRAFT ----
  hr('STAGE 3 — DRAFT (real LLM)');
  const s3 = buildDraftStage({
    docType: 'regular_bail', forum: 'Court of Session', factsJson: JSON.stringify(facts),
    sections: sections.map((s) => ({ citation: s.citation, offenceName: s.offenceName, verified: s.verified })),
    blocks: [
      { block: 'grounds', instruction: 'State the grounds for grant of bail (no prior record, roots in community, willingness to cooperate, no tampering risk).' },
      { block: 'prayer', instruction: 'State the precise relief: regular bail pending trial.' },
    ],
  });
  const r3 = await complete(provider, s3.system, s3.user, 4000);
  const draft = parseJsonLoose<Record<string, string>>(r3.text) ?? {};
  for (const [k, v] of Object.entries(draft)) {
    // eslint-disable-next-line no-console
    console.log(`\n[${k.toUpperCase()}]\n${v}`);
  }

  // ---- STAGE 4: VERIFY ----
  hr('STAGE 4 — VERIFY / AUDIT (real LLM)');
  const draftText = Object.values(draft).join('\n\n');
  const allowed = sections.map((s) => s.citation);
  const s4 = buildVerifyStage({ draftText, allowedCitations: allowed, factsJson: JSON.stringify(facts) });
  const r4 = await complete(provider, s4.system, s4.user, 1200);
  const audit = parseJsonLoose<Record<string, unknown>>(r4.text) ?? {};
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(audit, null, 2));
  const blocked = ((audit.unauthorised_citations as string[]) ?? []).length > 0 || ((audit.old_law_references as string[]) ?? []).length > 0;
  hr(blocked ? '⛔ RESULT: BLOCKED (review before export)' : '✅ RESULT: passed audit — ready for advocate review');
  // eslint-disable-next-line no-console
  console.log(`allowed citations: ${allowed.join(', ') || '(none)'}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('pipeline-live failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
