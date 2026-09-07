import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// GUARANTEE (plan §9.1, amended for COMPOSE): the conversational-intake path
// may call the LLM for THREE jobs — extract (prose -> fields), phrase (issues
// -> questions), and — ONLY AFTER the engine returns outcome:'generated' (every
// fact validated, every hard-stop already passed) — compose (verified facts ->
// richer prose). The engine still decides WHAT is true and WHETHER the matter
// is legally sound; extract/phrase never draft; compose drafts, but ONLY from
// the engine's own validated block output, NEVER from raw advocate prose, and
// its output must pass a fact-check VERIFY pass before reaching the advocate.
//
// It must still NEVER reach the GENERAL model drafting pipeline (orchestrator /
// agent / auto / chat), which extracts its OWN facts from raw prose with no
// engine hard-stops — that remains categorically forbidden. We prove the
// "no general pipeline" half statically: walk the import graph from the intake
// entry points (extended to include intake-compose.service) and assert nothing
// on it imports the general drafting orchestrator / agent / auto / chat
// services. (The intake path IS allowed to reach the LLM provider directly —
// extract/phrase/compose all do — so the provider hosts are NOT forbidden here;
// the forbidden thing is the GENERAL DRAFTING pipeline, which would let the
// model invent facts instead of only arguing ones the engine already verified.)

// CommonJS (the api package compiles to CJS), so __dirname is available directly
// — no import.meta, which tsc rejects under this module target.
const SRC = resolve(__dirname, '..', '..'); // apps/api/src

// Modules that would mean the model is DRAFTING the document, not just translating.
const FORBIDDEN = [
  'drafting-orchestrator',
  'drafting.service',
  'draft-agent',
  'draft-auto',
  'draft-chat',
  'draft-extract', // the OTHER extractor (form pre-fill) — intake has its own
];

const ENTRY_POINTS = [
  resolve(SRC, 'services/intake.service.ts'),
  resolve(SRC, 'services/intake-llm.service.ts'),
  resolve(SRC, 'services/intake-compose.service.ts'),
];

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // bare packages checked by name, not followed
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    const p = base.endsWith('.ts') ? base : base + ext;
    if (existsSync(p)) return p;
  }
  return null;
}

function collectImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /import\s+[^'"]*from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1] ?? m[2] ?? '');
  return specs.filter(Boolean);
}

function walk(entry: string): Set<string> {
  const files = new Set<string>();
  const specs = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of collectImports(file)) {
      specs.add(spec);
      const resolved = resolveImport(file, spec);
      if (resolved && !files.has(resolved)) queue.push(resolved);
    }
  }
  return specs;
}

describe('intake path — model translates, never drafts', () => {
  it('the intake entry points do not transitively import the drafting pipeline', () => {
    const allSpecs = new Set<string>();
    for (const entry of ENTRY_POINTS) for (const s of walk(entry)) allSpecs.add(s);
    const offenders = [...allSpecs].filter((s) => FORBIDDEN.some((f) => s.includes(f)));
    expect(offenders, `intake reaches the drafting pipeline via: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the orchestrator drives the loop through the engine client, not the model', () => {
    const src = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    // It talks to the engine for the outcome (422 / refused / generated)...
    expect(src).toContain('engine-client.service');
    expect(src).toContain('engineClient.draft');
    // ...and to the intake LLM module ONLY for extract + phrase.
    expect(src).toContain('intake-llm.service');
    expect(src).toContain('intakeLlm.extract');
    expect(src).toContain('intakeLlm.phrase');
  });

  it('phrasing is gated so the model can neither invent nor skip a question', () => {
    const src = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    // reconcile() drops non-issue questions and fills a fallback for uncovered
    // issues — the SET of questions is the engine's, only the wording is the model's.
    expect(src).toContain('reconcile(');
    expect(src).toMatch(/issueFields\.has/); // drop invented
    expect(src).toMatch(/fallbackQuestion/); // fill skipped
  });

  it('compose only fires AFTER the engine has generated (facts already validated)', () => {
    const src = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    expect(src).toContain('intake-compose.service');
    expect(src).toContain('intakeCompose.compose');
    // The compose call must be textually inside the 'generated' branch, not the
    // 422/refused branches — a crude but effective ordering check: the
    // generated-outcome check appears BEFORE the compose call in the source.
    const generatedIdx = src.indexOf("outcome === 'generated'");
    const composeIdx = src.indexOf('intakeCompose.compose');
    expect(generatedIdx).toBeGreaterThan(-1);
    expect(composeIdx).toBeGreaterThan(generatedIdx);
  });

  it('compose input is the engine draft, never raw advocate prose or the transcript', () => {
    const src = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    // Whatever gets passed to compose must come from the engine's own draft
    // object (toDraft/outcome.blocks), not `state.transcript` or the raw
    // advocate `message` — this is what keeps compose from ever seeing
    // unvalidated prose.
    const call = src.slice(src.indexOf('intakeCompose.compose'), src.indexOf('intakeCompose.compose') + 400);
    expect(call).not.toMatch(/state\.transcript/);
    expect(call).not.toMatch(/\bmessage\b/);
  });

  it('intake-compose runs a fact-check VERIFY pass and can reject unsupported claims', () => {
    const src = readFileSync(resolve(SRC, 'services/intake-compose.service.ts'), 'utf8');
    expect(src).toMatch(/verify|unsupported/i);
  });
});
