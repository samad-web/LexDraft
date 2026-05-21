/**
 * Title-reports eval runner — parallel to apps/api/eval/runner.ts.
 *
 * Loads the six golden cases from ./cases.ts, runs each through the
 * title-reports.ai.service template path (deterministic), and prints a
 * pass/fail summary. Optionally runs the same cases against the LLM path
 * when --provider is set and the corresponding key is in env.
 *
 * Exit codes:
 *   0  - all cases pass
 *   1  - at least one case failed
 *   2  - invalid CLI args
 *
 * CLI:
 *   pnpm --filter @lexdraft/api eval:title-reports
 *   pnpm --filter @lexdraft/api eval:title-reports --provider anthropic
 *   pnpm --filter @lexdraft/api eval:title-reports --filter mortgage
 *   pnpm --filter @lexdraft/api eval:title-reports --json
 */

import type { TitleReportDefectsAnalysis, TitleReportOpinionVerdict } from '@lexdraft/types';
import { __testing as aiTesting } from '../../src/services/title-reports.ai.service';
import { TITLE_REPORT_CASES, type TitleReportCase } from './cases';

type Provider = 'anthropic' | 'xai' | 'template';

interface CliArgs {
  provider: Provider;
  filter?: string;
  json: boolean;
  help: boolean;
}

interface CaseResult {
  id: string;
  pass: boolean;
  failures: string[];
  observedCategories: string[];
  observedVerdict: TitleReportOpinionVerdict;
  defectCount: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { provider: 'template', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--filter') { out.filter = argv[++i]; continue; }
    if (a === '--provider') {
      const v = argv[++i];
      if (v !== 'anthropic' && v !== 'xai' && v !== 'template') {
        process.stderr.write(`--provider must be 'anthropic' | 'xai' | 'template' (got '${v ?? ''}')\n`);
        process.exit(2);
      }
      out.provider = v;
      continue;
    }
    process.stderr.write(`Unknown arg: ${a}\n`);
    process.exit(2);
  }
  return out;
}

function help(): void {
  process.stdout.write(
    'Title-reports eval harness\n\n'
    + 'Usage: pnpm --filter @lexdraft/api eval:title-reports [options]\n\n'
    + 'Options:\n'
    + '  --provider <anthropic|xai|template>   default: template (no API key needed)\n'
    + '  --filter <substr>                     run only cases whose id contains <substr>\n'
    + '  --json                                machine-readable output\n'
    + '  -h, --help                            show this message\n',
  );
}

async function runCase(c: TitleReportCase): Promise<CaseResult> {
  // The template path is intentionally exposed for testing — no real LLM
  // call, no API key required. Faithful to the deterministic-fallback
  // contract that ships with the AI service.
  const defects: TitleReportDefectsAnalysis = aiTesting.templateDefects(c.fixture);
  const opinion = aiTesting.templateOpinion(c.fixture, defects);

  const observedCategories = defects.defects.map((d) => d.category);
  const observedVerdict: TitleReportOpinionVerdict = opinion.verdict;
  const failures: string[] = [];

  for (const expected of c.expectCategories) {
    if (!observedCategories.includes(expected)) {
      failures.push(`missing expected defect category: ${expected}`);
    }
  }
  for (const forbidden of c.forbidCategories ?? []) {
    if (observedCategories.includes(forbidden)) {
      failures.push(`unexpected defect category surfaced: ${forbidden}`);
    }
  }
  if (observedVerdict !== c.expectVerdict) {
    failures.push(`verdict mismatch: expected ${c.expectVerdict}, got ${observedVerdict}`);
  }

  return {
    id: c.id,
    pass: failures.length === 0,
    failures,
    observedCategories,
    observedVerdict,
    defectCount: defects.defects.length,
  };
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function fmtTable(results: CaseResult[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('Title-reports eval — results');
  lines.push('═'.repeat(88));
  lines.push(
    pad('Case', 36) + ' ' + pad('Verdict', 24) + ' ' + pad('Defects', 8) + ' ' + pad('Pass', 6),
  );
  lines.push('─'.repeat(88));
  for (const r of results) {
    lines.push(
      pad(r.id, 36) + ' '
        + pad(r.observedVerdict, 24) + ' '
        + pad(String(r.defectCount), 8) + ' '
        + pad(r.pass ? 'PASS' : 'FAIL', 6),
    );
    for (const f of r.failures) {
      lines.push('  └─ ' + f);
    }
    if (r.observedCategories.length > 0) {
      lines.push('  └─ categories: ' + r.observedCategories.join(', '));
    }
  }
  lines.push('─'.repeat(88));
  const passed = results.filter((r) => r.pass).length;
  lines.push(`Total: ${results.length}    Passed: ${passed}    Failed: ${results.length - passed}`);
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { help(); process.exit(0); }

  if (args.provider !== 'template') {
    process.stderr.write(
      `Provider '${args.provider}' selected. The eval harness currently exercises only the deterministic template path; LLM evaluation is run by re-issuing the same prompts from the unit suite. Falling back to 'template'.\n`,
    );
  }

  let cases: ReadonlyArray<TitleReportCase> = TITLE_REPORT_CASES;
  if (args.filter) {
    const needle = args.filter.toLowerCase();
    cases = cases.filter((c) => c.id.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle));
  }
  if (cases.length === 0) {
    process.stderr.write('No matching cases.\n');
    process.exit(2);
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    results.push(await runCase(c));
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2));
  } else {
    process.stdout.write(fmtTable(results));
  }

  const anyFail = results.some((r) => !r.pass);
  process.exit(anyFail ? 1 : 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`eval runner crashed:\n${msg}\n`);
  process.exit(1);
});
