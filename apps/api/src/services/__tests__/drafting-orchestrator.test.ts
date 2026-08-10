import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the LLM layer so we can drive all four stages deterministically without
// a provider key. We queue a reply per stage call, in order:
//   1) EXTRACT  2) CLASSIFY  3) DRAFT  4) VERIFY
const replies: string[] = [];
vi.mock('../../lib/llm-drafting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llm-drafting')>();
  return {
    ...actual,
    // Force a real provider so the orchestrator does not take the "off" path.
    resolveProvider: () => 'anthropic' as const,
    providerTag: () => 'anthropic:test-model',
    providerModel: () => 'test-model',
    complete: vi.fn(async () => {
      const text = replies.shift() ?? '{}';
      return { text, tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 };
    }),
  };
});

// Quota + usage are side effects we don't want in a unit test.
vi.mock('../ai-quota.service', () => ({
  aiQuotaService: { assertCanGenerate: vi.fn(async () => ({})) },
  AiQuotaExceededError: class extends Error {},
}));
vi.mock('../ai-usage.service', () => ({
  aiUsageService: { recordAsync: vi.fn() },
}));

import { draftingOrchestratorService } from '../drafting-orchestrator.service';

const CTX = { firmId: 'firm_1', userId: 'user_1' };
const BASE = {
  docType: 'regular_bail',
  forum: 'Court of Session',
  brief: 'Client Ramesh cheated of Rs 4,00,000, FIR 112/2025, seeks regular bail.',
  requiredFields: ['applicant_name', 'fir_no'],
  blocks: [{ block: 'grounds', instruction: 'grounds for bail' }],
};

function queue(...r: string[]): void {
  replies.length = 0;
  replies.push(...r);
}

describe('draftingOrchestratorService.run — four-stage pipeline', () => {
  beforeEach(() => {
    replies.length = 0;
  });

  it('runs all four stages and resolves a real KB section as SUGGESTED', async () => {
    queue(
      // EXTRACT
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'Ramesh took Rs 4,00,000 by false promise.', needs_clarification: [] }),
      // CLASSIFY — picks the real cheating id
      JSON.stringify({ selected: [{ id: 'bns-318-cheating', confidence: 'high', ingredients_met: ['deception'], ingredients_missing: [], why: 'money taken by deception' }], consider_instead: [], unresolved: [] }),
      // DRAFT
      JSON.stringify({ grounds: 'It is respectfully submitted that the applicant may attract BNS 318(4), subject to confirmation.' }),
      // VERIFY — clean
      JSON.stringify({ pass: true, unauthorised_citations: [], unsupported_facts: [], placeholders_remaining: [], old_law_references: [], notes: '' }),
    );

    const res = await draftingOrchestratorService.run(BASE, CTX);

    expect(res.stagesRun).toEqual({ extract: true, classify: true, draft: true, verify: true });
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0]!.id).toBe('bns-318-cheating');
    expect(res.sections[0]!.citation).toBe('BNS 318(4)');
    // KB entry is needs-review -> the gate must mark it SUGGESTED, not verified.
    expect(res.sections[0]!.verified).toBe(false);
    expect(res.draft.grounds).toContain('318(4)');
    expect(res.blocked).toBe(false);
  });

  it('DROPS a fabricated section id the model tries to sneak in (grounding guard)', async () => {
    queue(
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'x', needs_clarification: [] }),
      // CLASSIFY returns one real id AND one invented id not in candidates
      JSON.stringify({ selected: [
        { id: 'bns-318-cheating', confidence: 'high' },
        { id: 'bns-999-fabricated', confidence: 'high' },
      ], consider_instead: [], unresolved: [] }),
      JSON.stringify({ grounds: 'text' }),
      JSON.stringify({ pass: true, unauthorised_citations: [], unsupported_facts: [], placeholders_remaining: [], old_law_references: [], notes: '' }),
    );

    const res = await draftingOrchestratorService.run(BASE, CTX);

    const ids = res.sections.map((s) => s.id);
    expect(ids).toContain('bns-318-cheating');
    expect(ids).not.toContain('bns-999-fabricated'); // guard dropped it
    expect(res.advisories.some((a) => /rejected as not KB-backed/i.test(a))).toBe(true);
  });

  it('BLOCKS export when VERIFY finds an unauthorised citation', async () => {
    queue(
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'x', needs_clarification: [] }),
      JSON.stringify({ selected: [{ id: 'bns-318-cheating', confidence: 'high' }], consider_instead: [], unresolved: [] }),
      JSON.stringify({ grounds: 'draft citing BNS 999 which was never allowed' }),
      // VERIFY catches an unauthorised citation
      JSON.stringify({ pass: false, unauthorised_citations: ['BNS 999'], unsupported_facts: [], placeholders_remaining: [], old_law_references: [], notes: 'stray citation' }),
    );

    const res = await draftingOrchestratorService.run(BASE, CTX);

    expect(res.blocked).toBe(true);
    expect(res.verify?.unauthorised_citations).toContain('BNS 999');
    expect(res.advisories.some((a) => /AUDIT BLOCK/i.test(a))).toBe(true);
  });

  it('BLOCKS export when VERIFY finds a repealed (CrPC) reference', async () => {
    queue(
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'x', needs_clarification: [] }),
      JSON.stringify({ selected: [{ id: 'bns-318-cheating', confidence: 'high' }], consider_instead: [], unresolved: [] }),
      JSON.stringify({ grounds: 'application under Section 437 CrPC' }),
      JSON.stringify({ pass: false, unauthorised_citations: [], unsupported_facts: [], placeholders_remaining: [], old_law_references: ['Section 437 CrPC'], notes: 'repealed code' }),
    );

    const res = await draftingOrchestratorService.run(BASE, CTX);
    expect(res.blocked).toBe(true);
    expect(res.verify?.old_law_references).toContain('Section 437 CrPC');
  });

  it('surfaces consider_instead (cheating vs criminal breach of trust)', async () => {
    queue(
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'money was entrusted then misused', needs_clarification: [] }),
      JSON.stringify({ selected: [{ id: 'bns-318-cheating', confidence: 'low', ingredients_missing: ['dishonest intention at inception'] }], consider_instead: [{ id: 'bns-316-criminal-breach-of-trust', reason: 'entrustment then dishonesty' }], unresolved: [] }),
      JSON.stringify({ grounds: 'text' }),
      JSON.stringify({ pass: true, unauthorised_citations: [], unsupported_facts: [], placeholders_remaining: [], old_law_references: [], notes: '' }),
    );

    const res = await draftingOrchestratorService.run(BASE, CTX);
    expect(res.considerInstead.map((c) => c.id)).toContain('bns-316-criminal-breach-of-trust');
    expect(res.considerInstead[0]!.citation).toBe('BNS 316(2)');
  });

  it('degrades gracefully when the DRAFT stage returns unparseable JSON', async () => {
    queue(
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'x', needs_clarification: [] }),
      JSON.stringify({ selected: [{ id: 'bns-318-cheating', confidence: 'high' }], consider_instead: [], unresolved: [] }),
      'the model rambled and produced no JSON at all', // DRAFT garbage
      // VERIFY won't run because there is no draft text
    );

    const res = await draftingOrchestratorService.run(BASE, CTX);
    expect(res.draft).toEqual({});
    expect(res.stagesRun.draft).toBe(true);
    expect(res.stagesRun.verify).toBe(false); // nothing to audit
    expect(res.advisories.some((a) => /Draft generation failed/i.test(a))).toBe(true);
  });

  it('passes needs_clarification through as an advisory', async () => {
    queue(
      JSON.stringify({ alleged_offences: ['cheating'], facts_narrative: 'x', needs_clarification: ['What is the applicant\'s full name?'] }),
      JSON.stringify({ selected: [], consider_instead: [], unresolved: [] }),
    );
    const res = await draftingOrchestratorService.run(
      { ...BASE, blocks: [] }, // no blocks -> draft/verify skipped
      CTX,
    );
    expect(res.advisories.some((a) => /full name/i.test(a))).toBe(true);
  });
});
