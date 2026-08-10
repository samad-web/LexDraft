// =============================================================================
// orchestrator-smoke — validates the orchestrator's NON-LLM logic deterministically.
//
// The LLM stages need a provider; here we force the provider OFF and assert the
// graceful-degradation contract, then unit-test the pure gate/guard helpers that
// protect against hallucinated sections.
//
// NOTE: The AUTHORITATIVE full-pipeline validation (all four stages, gate,
// grounding guard, audit-block) is the vitest suite, which mocks the LLM and
// runs with `pnpm test:orchestrator`. This standalone script is a quick manual
// check and MUST be run with the provider forced off (it reads env at import
// time, so the var has to be on the command line, not set in-script):
//
//   LLM_PROVIDER=none JWT_SECRET=dev-secret-0123456789 \
//     npx tsx apps/api/src/scripts/orchestrator-smoke.ts
// =============================================================================

import { draftingOrchestratorService } from '../services/drafting-orchestrator.service';
import { offenceKbService } from '../services/offence-kb.service';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) failures += 1;
  // eslint-disable-next-line no-console
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  // ---- 1. Graceful degradation when the provider is off -------------------
  // eslint-disable-next-line no-console
  console.log('\n1) provider off -> manual-entry shell, never throws');
  const res = await draftingOrchestratorService.run(
    {
      docType: 'regular_bail',
      forum: 'Court of Session',
      brief: 'Client Ramesh cheated of Rs 4,00,000, FIR 112/2025, seeks regular bail.',
      requiredFields: ['applicant_name', 'fir_no'],
      blocks: [{ block: 'grounds', instruction: 'grounds for bail' }],
    },
    { firmId: 'firm_1', userId: 'user_1' },
  );
  check('returns a result (no throw)', !!res);
  check('modelUsed is fallback:none', res.modelUsed === 'fallback:none', res.modelUsed);
  check('no stages ran', !res.stagesRun.extract && !res.stagesRun.classify, JSON.stringify(res.stagesRun));
  check('not blocked (nothing to block)', res.blocked === false);
  check('advisory explains the fallback', res.advisories.some((a) => /disabled|empty/i.test(a)));

  // ---- 2. Empty brief also degrades safely -------------------------------
  // eslint-disable-next-line no-console
  console.log('\n2) empty brief -> safe shell');
  const empty = await draftingOrchestratorService.run(
    { docType: 'x', forum: 'y', brief: '   ', requiredFields: [], blocks: [] },
    { firmId: 'firm_1', userId: 'user_1' },
  );
  check('empty brief returns shell', empty.modelUsed === 'fallback:none' && empty.draft && Object.keys(empty.draft).length === 0);

  // ---- 3. GATE logic: verification status -> VERIFIED vs SUGGESTED --------
  // All current KB entries are `needs-review`, so any resolved section must be
  // treated as SUGGESTED (verified === false). This is the safety default.
  // eslint-disable-next-line no-console
  console.log('\n3) gate: needs-review entries resolve as SUGGESTED, not VERIFIED');
  const cheating = offenceKbService.getById('bns-318-cheating')!;
  check('cheating entry is needs-review', cheating.verification === 'needs-review', cheating.verification);
  // Simulate the gate the orchestrator applies:
  const gated = { verified: cheating.verification === 'verified' };
  check('gate marks it SUGGESTED (verified=false)', gated.verified === false);

  // ---- 4. GROUNDING GUARD: invented ids are dropped ----------------------
  // The orchestrator filters classify.selected to real candidate ids. Prove the
  // guard: an id not among candidates must not resolve.
  // eslint-disable-next-line no-console
  console.log('\n4) grounding guard: a fabricated section id cannot resolve');
  const fabricated = offenceKbService.getById('bns-999-made-up');
  check('fabricated id returns null (cannot enter a draft)', fabricated === null);
  const candidateIds = new Set(offenceKbService.candidatesFor(['cheating']).map((e) => e.id));
  check('real cheating id is in candidate set', candidateIds.has('bns-318-cheating'));
  check('fabricated id is NOT in candidate set', !candidateIds.has('bns-999-made-up'));

  // eslint-disable-next-line no-console
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('orchestrator-smoke crashed:', err);
  process.exit(1);
});
