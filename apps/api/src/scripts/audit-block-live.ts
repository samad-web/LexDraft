// Proves the Stage-4 audit BLOCKS a draft containing a repealed (CrPC) citation
// and an unauthorised section — using the real LLM auditor.
//   run: npx tsx apps/api/src/scripts/audit-block-live.ts
import 'dotenv/config';
import { resolveProvider, complete, parseJsonLoose } from '../lib/llm-drafting';
import { buildVerifyStage } from '../lib/drafting-prompts';

async function main(): Promise<void> {
  const provider = resolveProvider();
  if (provider === 'none') { console.log('no LLM key'); return; } // eslint-disable-line no-console

  // A draft that (a) cites CrPC 437 (repealed) and (b) cites BNS 999 (not allowed).
  const badDraft =
    'It is submitted that the applicant seeks bail under Section 437 CrPC. ' +
    'The alleged offence under BNS 999 is bailable and the applicant is innocent.';
  const s4 = buildVerifyStage({
    draftText: badDraft,
    allowedCitations: ['BNS 318(4)'], // only 318(4) was authorised
    factsJson: JSON.stringify({ facts_narrative: 'applicant seeks bail' }),
  });
  const r = await complete(provider, s4.system, s4.user, 1200);
  const audit = parseJsonLoose<Record<string, unknown>>(r.text) ?? {};
  // eslint-disable-next-line no-console
  console.log('DRAFT UNDER AUDIT:\n', badDraft, '\n');
  // eslint-disable-next-line no-console
  console.log('AUDIT:\n', JSON.stringify(audit, null, 2));
  const unauth = (audit.unauthorised_citations as string[]) ?? [];
  const oldLaw = (audit.old_law_references as string[]) ?? [];
  const blocked = unauth.length > 0 || oldLaw.length > 0;
  // eslint-disable-next-line no-console
  console.log(`\n${blocked ? '⛔ BLOCKED — export disabled (correct)' : '❌ NOT blocked — SAFETY FAILURE'}`);
  if (!blocked) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); }); // eslint-disable-line no-console
