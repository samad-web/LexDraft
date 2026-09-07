import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUARANTEE: the s.138 engine path makes NO model call. We prove it statically by
// walking the import graph from the engine entry points and asserting nothing on
// that graph imports the model drafting hooks/services (useDrafting, the
// orchestrator, or the LLM provider libs). If a future edit wires the model in,
// this test fails.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', '..', '..'); // apps/web/src

// Modules that would indicate a model/LLM call on this path.
const FORBIDDEN = [
  '@/hooks/useDrafting',
  'drafting-orchestrator',
  'draft-agent',
  'draft-auto',
  'llm-drafting',
  'anthropic',
  'api.anthropic.com',
  'api.x.ai',
];

const ENTRY_POINTS = [
  resolve(SRC, 'components/engine/EngineDraftPanel.tsx'),
  resolve(SRC, 'components/engine/DraftBotModal.tsx'),
  resolve(SRC, 'components/engine/IntakePanel.tsx'),
  resolve(SRC, 'hooks/useEngineDraft.ts'),
  resolve(SRC, 'hooks/useIntake.ts'),
];

function resolveImport(fromFile: string, spec: string): string | null {
  // Only follow local imports (@/... or relative). Bare packages are checked by
  // name in FORBIDDEN, not followed.
  let base: string;
  if (spec.startsWith('@/')) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base.endsWith('.ts') || base.endsWith('.tsx') ? base : base + ext;
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

function walk(entry: string): { files: Set<string>; specs: Set<string> } {
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
  return { files, specs };
}

describe('engine path — no model call', () => {
  it('the engine entry points do not transitively import any model/LLM module', () => {
    const allSpecs = new Set<string>();
    for (const entry of ENTRY_POINTS) {
      const { specs } = walk(entry);
      for (const s of specs) allSpecs.add(s);
    }
    const offenders = [...allSpecs].filter((s) =>
      FORBIDDEN.some((f) => s.includes(f)),
    );
    expect(offenders, `forbidden model imports reachable from the engine path: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('EngineDraftPanel imports the engine hooks, not useDrafting', () => {
    const src = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    expect(src).toContain('@/hooks/useEngineDraft');
    expect(src).not.toContain('@/hooks/useDrafting');
  });

  it('a refusal and a 422 render through DIFFERENT components', () => {
    const panel = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    // The refusal outcome -> RefusalMessage; the 422 (formIssues) -> the OTHER
    // component. They must not share a component.
    expect(panel).toContain('RefusalMessage');
    expect(panel).toContain('FormIncompleteMessage');
    // The refusal path is gated on outcome==='refused'; the 422 path on formIssues.
    expect(panel).toMatch(/result\?\.outcome === 'refused'[\s\S]*RefusalMessage/);
    expect(panel).toMatch(/formIssues &&[\s\S]*FormIncompleteMessage/);
    // And the two components are distinct files with distinct root classes.
    const refusal = readFileSync(resolve(SRC, 'components/engine/RefusalMessage.tsx'), 'utf8');
    const incomplete = readFileSync(resolve(SRC, 'components/engine/FormIncompleteMessage.tsx'), 'utf8');
    expect(refusal).toContain('engine-refusal');
    expect(incomplete).toContain('engine-incomplete');
    expect(refusal).not.toContain('engine-incomplete');
  });

  it('the review banner is present in-app and clears on sign-off', () => {
    const banner = readFileSync(resolve(SRC, 'components/engine/ReviewBanner.tsx'), 'utf8');
    // Draft state shows the banner text + a sign-off control; the empty-banner
    // (signed-off) state renders the "final" affordance instead — i.e. it clears.
    expect(banner).toContain('engine-banner--draft');
    expect(banner).toContain('engine-banner--final');
    expect(banner).toMatch(/if \(!bannerText\)/); // empty banner -> final state
    const panel = readFileSync(ENTRY_POINTS[0]!, 'utf8');
    expect(panel).toContain('setBannerText(\'\')'); // sign-off clears it on screen
  });
});
