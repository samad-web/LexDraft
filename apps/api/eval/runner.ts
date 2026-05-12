// LexDraft drafting eval harness — standalone runner.
//
// NOT a vitest test. LLM calls are slow, non-deterministic, and cost money;
// we run this on-demand against the live provider when changing prompts,
// models, or provider plumbing, and gate it behind explicit CLI flags.
//
// CLI:
//   pnpm --filter @lexdraft/api eval
//   pnpm --filter @lexdraft/api eval --provider anthropic
//   pnpm --filter @lexdraft/api eval --provider xai
//   pnpm --filter @lexdraft/api eval --filter plaint
//   pnpm --filter @lexdraft/api eval --baseline baseline.json
//   pnpm --filter @lexdraft/api eval --save out.json
//   pnpm --filter @lexdraft/api eval --json
//
// Exit codes:
//   0  — all briefs pass, or (with --baseline) no regressions vs baseline
//   1  — at least one regression (failing brief that previously passed,
//        or score drop greater than REGRESSION_SCORE_DELTA) — also used
//        for unhandled errors
//   2  — invalid CLI args

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftingService } from '../src/services/drafting.service';
import { GOLDEN_BRIEFS, type GoldenBrief } from './golden-briefs';
import { evaluateBrief, type BriefResult } from './evaluator';

// A drop of >= this many points on a previously-passing brief is treated as
// a regression even if the brief still scores above the pass threshold. The
// pass-bit alone misses gradual erosion (88 → 72 is technically still "pass"
// but the prompt has clearly drifted).
const REGRESSION_SCORE_DELTA = 10;

type Provider = 'anthropic' | 'xai';

interface CliArgs {
  provider?: Provider;
  filter?: string;
  baseline?: string;
  save?: string;
  json: boolean;
  help: boolean;
}

interface RunSummary {
  startedAt: string;
  finishedAt: string;
  provider: Provider | 'env-default';
  totalBriefs: number;
  passed: number;
  failed: number;
  avgScore: number;
  avgLatencyMs: number;
  totalTokenEstimate: number;
  results: BriefResult[];
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (a === '--provider') {
      const v = argv[++i];
      if (v !== 'anthropic' && v !== 'xai') {
        process.stderr.write(`--provider must be 'anthropic' or 'xai' (got '${v ?? ''}')\n`);
        process.exit(2);
      }
      out.provider = v;
      continue;
    }
    if (a === '--filter') {
      out.filter = argv[++i];
      continue;
    }
    if (a === '--baseline') {
      out.baseline = argv[++i];
      continue;
    }
    if (a === '--save') {
      out.save = argv[++i];
      continue;
    }
    process.stderr.write(`Unknown arg: ${a}\n`);
    process.exit(2);
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `LexDraft drafting eval harness\n\n`
      + `Usage:\n`
      + `  pnpm --filter @lexdraft/api eval [options]\n\n`
      + `Options:\n`
      + `  --provider <anthropic|xai>   Force a provider (default: env LLM_PROVIDER)\n`
      + `  --filter <substr>            Run only briefs whose id contains <substr>\n`
      + `  --baseline <path>            Compare against a saved baseline JSON\n`
      + `  --save <path>                Save this run's results to <path>\n`
      + `  --json                       Emit machine-readable JSON instead of a table\n`
      + `  -h, --help                   Show this message\n\n`
      + `Note: this command hits paid APIs. See apps/api/eval/README.md for cost notes.\n`,
  );
}

function selectBriefs(filter: string | undefined): GoldenBrief[] {
  if (!filter) return GOLDEN_BRIEFS;
  const needle = filter.toLowerCase();
  return GOLDEN_BRIEFS.filter(
    (b) => b.id.toLowerCase().includes(needle) || b.description.toLowerCase().includes(needle),
  );
}

async function runOne(
  brief: GoldenBrief,
  provider: Provider | undefined,
): Promise<BriefResult> {
  const start = Date.now();
  try {
    const resp = await draftingService.generate(brief.request, provider);
    const latency = Date.now() - start;
    return evaluateBrief(brief, resp.text, latency);
  } catch (err) {
    // The drafting service swallows provider errors and falls back to the
    // template, so we shouldn't normally land here — but if we do (bad env,
    // import failure), surface it as a hard 0 with the error in `failures`
    // rather than crashing the whole run.
    const latency = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      briefId: brief.id,
      pass: false,
      score: 0,
      failures: [`drafting service threw: ${message}`],
      output: '',
      latencyMs: latency,
      tokenEstimate: 0,
    };
  }
}

function summarise(results: BriefResult[], provider: Provider | 'env-default', startedAt: string): RunSummary {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const avgScore = results.length
    ? results.reduce((s, r) => s + r.score, 0) / results.length
    : 0;
  const avgLatency = results.length
    ? results.reduce((s, r) => s + r.latencyMs, 0) / results.length
    : 0;
  const totalTokens = results.reduce((s, r) => s + r.tokenEstimate, 0);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    provider,
    totalBriefs: results.length,
    passed,
    failed,
    avgScore: Number(avgScore.toFixed(2)),
    avgLatencyMs: Math.round(avgLatency),
    totalTokenEstimate: totalTokens,
    results,
  };
}

function fmt(n: number, width: number): string {
  return String(n).padStart(width, ' ');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function printTable(summary: RunSummary): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('LexDraft drafting eval — results');
  lines.push('═'.repeat(86));
  lines.push(
    pad('ID', 38) + ' '
      + pad('Score', 7) + ' '
      + pad('Pass', 6) + ' '
      + pad('Latency', 10) + ' '
      + pad('Tokens', 8) + ' ',
  );
  lines.push('─'.repeat(86));
  for (const r of summary.results) {
    lines.push(
      pad(r.briefId, 38) + ' '
        + fmt(r.score, 7) + ' '
        + pad(r.pass ? 'PASS' : 'FAIL', 6) + ' '
        + fmt(r.latencyMs, 8) + 'ms '
        + fmt(r.tokenEstimate, 8) + ' ',
    );
    for (const f of r.failures) {
      lines.push('  ' + '└─ ' + f);
    }
  }
  lines.push('─'.repeat(86));
  lines.push(
    `Total: ${summary.totalBriefs}    `
      + `Passed: ${summary.passed}    `
      + `Failed: ${summary.failed}    `
      + `Avg score: ${summary.avgScore}    `
      + `Avg latency: ${summary.avgLatencyMs}ms    `
      + `Tokens: ~${summary.totalTokenEstimate}`,
  );
  lines.push(`Provider: ${summary.provider}`);
  lines.push('');
  process.stdout.write(lines.join('\n'));
}

interface DiffRow {
  briefId: string;
  baselineScore: number | null;
  currentScore: number;
  baselinePass: boolean | null;
  currentPass: boolean;
  status: 'regression' | 'win' | 'unchanged' | 'new' | 'score-drop';
  delta: number;
}

function diffAgainstBaseline(current: RunSummary, baseline: RunSummary): {
  rows: DiffRow[];
  regressions: DiffRow[];
  wins: DiffRow[];
} {
  const baselineById = new Map(baseline.results.map((r) => [r.briefId, r]));
  const rows: DiffRow[] = [];
  for (const cur of current.results) {
    const base = baselineById.get(cur.briefId);
    if (!base) {
      rows.push({
        briefId: cur.briefId,
        baselineScore: null,
        currentScore: cur.score,
        baselinePass: null,
        currentPass: cur.pass,
        status: 'new',
        delta: cur.score,
      });
      continue;
    }
    const delta = cur.score - base.score;
    let status: DiffRow['status'] = 'unchanged';
    if (base.pass && !cur.pass) status = 'regression';
    else if (!base.pass && cur.pass) status = 'win';
    else if (base.pass && cur.pass && delta <= -REGRESSION_SCORE_DELTA) status = 'score-drop';
    rows.push({
      briefId: cur.briefId,
      baselineScore: base.score,
      currentScore: cur.score,
      baselinePass: base.pass,
      currentPass: cur.pass,
      status,
      delta,
    });
  }
  const regressions = rows.filter((r) => r.status === 'regression' || r.status === 'score-drop');
  const wins = rows.filter((r) => r.status === 'win');
  return { rows, regressions, wins };
}

function printDiffTable(diff: ReturnType<typeof diffAgainstBaseline>): void {
  const { rows, regressions, wins } = diff;
  const lines: string[] = [];
  lines.push('');
  lines.push('Baseline diff');
  lines.push('═'.repeat(86));
  lines.push(
    pad('ID', 38) + ' '
      + pad('Base', 7) + ' '
      + pad('Curr', 7) + ' '
      + pad('Δ', 7) + ' '
      + pad('Status', 12),
  );
  lines.push('─'.repeat(86));
  for (const r of rows) {
    const base = r.baselineScore === null ? '—' : String(r.baselineScore);
    const deltaStr = r.delta > 0 ? `+${r.delta}` : String(r.delta);
    lines.push(
      pad(r.briefId, 38) + ' '
        + pad(base, 7) + ' '
        + pad(String(r.currentScore), 7) + ' '
        + pad(deltaStr, 7) + ' '
        + pad(r.status, 12),
    );
  }
  lines.push('─'.repeat(86));
  lines.push(`Regressions: ${regressions.length}    Wins: ${wins.length}`);
  lines.push('');
  process.stdout.write(lines.join('\n'));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const briefs = selectBriefs(args.filter);
  if (briefs.length === 0) {
    process.stderr.write(`No briefs matched filter "${args.filter ?? ''}"\n`);
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const results: BriefResult[] = [];

  for (const brief of briefs) {
    if (!args.json) {
      process.stdout.write(`▶ ${brief.id} ... `);
    }
    const r = await runOne(brief, args.provider);
    results.push(r);
    if (!args.json) {
      process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'} (${r.score}, ${r.latencyMs}ms)\n`);
    }
  }

  const summary = summarise(results, args.provider ?? 'env-default', startedAt);

  let diff: ReturnType<typeof diffAgainstBaseline> | null = null;
  if (args.baseline) {
    const baselinePath = resolve(process.cwd(), args.baseline);
    if (!existsSync(baselinePath)) {
      process.stderr.write(`Baseline file not found: ${baselinePath}\n`);
      process.exit(2);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as RunSummary;
    diff = diffAgainstBaseline(summary, baseline);
  }

  if (args.save) {
    const savePath = resolve(process.cwd(), args.save);
    writeFileSync(savePath, JSON.stringify(summary, null, 2), 'utf8');
    if (!args.json) {
      process.stdout.write(`\nSaved run to ${savePath}\n`);
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ summary, diff }, null, 2));
  } else {
    printTable(summary);
    if (diff) printDiffTable(diff);
  }

  // Exit policy:
  // - With a baseline: any regression (failing brief that used to pass, or
  //   a score drop ≥ REGRESSION_SCORE_DELTA on a still-passing brief) is a
  //   non-zero exit so CI can fail the build.
  // - Without a baseline: a non-zero exit only if the overall failed count
  //   is non-zero. Use this mode for "is the current state acceptable".
  if (diff) {
    process.exit(diff.regressions.length > 0 ? 1 : 0);
  }
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`eval runner crashed:\n${msg}\n`);
  process.exit(1);
});
