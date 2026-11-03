/* eslint-disable no-console */
// =============================================================================
// Judgment corpus ingest (0098_judgments_corpus.sql)
//
// Source: AWS Open Data, anonymous HTTPS, licence CC-BY-4.0 (Dattam Labs,
// scraped from scr.sci.gov.in / judgments.ecourts.gov.in):
//   s3://indian-supreme-court-judgments  metadata/json/year=YYYY/<path>.json
//                                        data/pdf/year=YYYY/english/<path>_EN.pdf
//   s3://indian-high-court-judgments     metadata/json/year=YYYY/court=33_10/bench=<b>/<file>.json
//                                        data/pdf/year=YYYY/court=33_10/bench=<b>/<file>.pdf
//
// Per judgment: metadata JSON -> parse (lib/judgment-parse) -> PDF -> text
// (lib/text-extraction, OCR fallback for scans) -> the court's own numbered
// paragraphs -> bge-m3 embeddings (embeddingsService; if the embed service is
// unreachable the rest of the run stores null embeddings = FTS-only) -> upsert.
//
//   pnpm --filter @lexdraft/api ingest:judgments --court SC  --from 2024 --to 2024 --limit 50
//   pnpm --filter @lexdraft/api ingest:judgments --court MHC --from 2023 --limit 200
//   pnpm --filter @lexdraft/api ingest:judgments --court SC --limit 5 --dry-run --out ./judgments-dryrun
//
// --dry-run writes one JSONL line per judgment to --out and NEVER opens a DB
// connection (it also skips embedding unless --embed is given).
//
// Idempotent: judgments upsert on source_key; a judgment's paragraphs are
// replaced as a set in one transaction. Already-ingested judgments are skipped
// before their PDF is downloaded unless --force.
// =============================================================================

import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../env';
import type { db as DbFn } from '../db/client';
import { extractText } from '../lib/text-extraction';
import {
  HIGH_COURTS,
  cleanJudgmentText,
  neutralCitationFromText,
  parseHcMetadata,
  parseScMetadata,
  splitParagraphs,
  type JudgmentMeta,
  type JudgmentParagraph,
} from '../lib/judgment-parse';

const SC_BUCKET = 'indian-supreme-court-judgments';
const HC_BUCKET = 'indian-high-court-judgments';
const DATASET = 'AWS Open Data (Dattam Labs), CC-BY-4.0';
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MIN_TEXT_CHARS = 400;
const EMBED_BATCH = 32;
const UA = { 'user-agent': 'DifAi-judgments-ingest/1.0 (+https://difai.sirahdigital.in)' };

interface Args {
  court: string;
  from: number;
  to: number;
  limit: number;
  /** Skip judgments with fewer paragraphs (short interim orders carry no ratio). */
  minParas: number;
  dryRun: boolean;
  out: string;
  embed: boolean;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const val = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const year = new Date().getFullYear();
  const from = Number(val('--from') ?? year - 1);
  const dryRun = argv.includes('--dry-run');
  return {
    court: (val('--court') ?? 'SC').toUpperCase(),
    from,
    to: Number(val('--to') ?? from),
    limit: Number(val('--limit') ?? 25),
    minParas: Number(val('--min-paras') ?? 4),
    dryRun,
    out: resolve(val('--out') ?? 'judgments-dryrun'),
    // Real runs embed by default; dry runs only when asked.
    embed: dryRun ? argv.includes('--embed') : !argv.includes('--no-embed'),
    force: argv.includes('--force'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp(): void {
  process.stdout.write(
    'Judgment corpus ingest (SC + Madras HC, AWS Open Data, CC-BY-4.0)\n\n'
    + '  pnpm --filter @lexdraft/api ingest:judgments [options]\n\n'
    + '  --court SC|MHC   Court (default SC). MHC = Madras High Court (court=33_10, both benches)\n'
    + '  --from YYYY      First year (default: last year)\n'
    + '  --to YYYY        Last year (default: --from)\n'
    + '  --limit N        Max judgments ingested this run (default 25)\n'
    + '  --min-paras N    Skip judgments with fewer paragraphs (default 4: short orders)\n'
    + '  --dry-run        Write JSONL to --out, never touch a database\n'
    + '  --out DIR        Dry-run output folder (default ./judgments-dryrun)\n'
    + '  --embed          Dry run: also call the embed service\n'
    + '  --no-embed       Real run: store null embeddings (FTS-only)\n'
    + '  --force          Re-ingest judgments already in the table\n'
    + '  -h, --help       This message\n\n'
    + 'Real runs need DATABASE_URL and migration 0098 applied; embeddings need EMBED_SERVICE_URL.\n',
  );
}

// ---- S3 (anonymous HTTPS) ----------------------------------------------------

const objectUrl = (bucket: string, key: string) => `https://${bucket}.s3.amazonaws.com/${encodeURI(key)}`;

/** All keys under `prefix` (ListObjectsV2, paged). Lazily, so --limit stops early. */
async function* listKeys(bucket: string, prefix: string): AsyncGenerator<string> {
  let token: string | null = null;
  do {
    const qs = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
    if (token) qs.set('continuation-token', token);
    const res = await fetch(`https://${bucket}.s3.amazonaws.com/?${qs}`, { headers: UA });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${res.statusText}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) yield m[1]!.replace(/&amp;/g, '&');
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]?.replace(/&amp;/g, '&') ?? null
      : null;
  } while (token);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchPdf(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: UA });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_PDF_BYTES) throw new Error(`PDF too large (${len} bytes)`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- one source record -> candidate ----------------------------------------

interface Candidate {
  meta: JudgmentMeta;
  bucket: string;
  metadataKey: string;
  pdfKey: string;
}

async function* candidates(court: string, from: number, to: number): AsyncGenerator<Candidate> {
  for (let year = from; year <= to; year += 1) {
    if (court === 'SC') {
      for await (const key of listKeys(SC_BUCKET, `metadata/json/year=${year}/`)) {
        if (!key.endsWith('.json')) continue;
        try {
          const meta = parseScMetadata((await fetchJson(objectUrl(SC_BUCKET, key))) as Parameters<typeof parseScMetadata>[0]);
          if (!meta) { console.log(`  skip ${key}: no usable title`); continue; }
          const path = meta.sourceKey.slice('sc:'.length);
          yield { meta, bucket: SC_BUCKET, metadataKey: key, pdfKey: `data/pdf/year=${year}/english/${path}_EN.pdf` };
        } catch (err) {
          console.log(`  skip ${key}: ${(err as Error).message}`);
        }
      }
    } else {
      const courtPath = court === 'MHC' ? '33_10' : court;
      if (!HIGH_COURTS[courtPath]) throw new Error(`Unknown court "${court}". Supported: SC, MHC.`);
      for await (const key of listKeys(HC_BUCKET, `metadata/json/year=${year}/court=${courtPath}/`)) {
        if (!key.endsWith('.json')) continue;
        const fileKey = key.slice(key.lastIndexOf('/') + 1, -'.json'.length);
        try {
          const meta = parseHcMetadata((await fetchJson(objectUrl(HC_BUCKET, key))) as Parameters<typeof parseHcMetadata>[0], fileKey);
          if (!meta) { console.log(`  skip ${key}: no usable title`); continue; }
          const pdfKey = key.replace(/^metadata\/json\//, 'data/pdf/').replace(/\.json$/, '.pdf');
          yield { meta, bucket: HC_BUCKET, metadataKey: key, pdfKey };
        } catch (err) {
          console.log(`  skip ${key}: ${(err as Error).message}`);
        }
      }
    }
  }
}

// ---- embeddings (fail open to FTS-only) -------------------------------------

let embedDisabled = false;

async function embedParagraphs(paras: JudgmentParagraph[]): Promise<Array<number[] | null>> {
  if (embedDisabled || !env.EMBED_SERVICE_URL) return paras.map(() => null);
  const { embeddingsService } = await import('../services/embeddings.service');
  const out: Array<number[] | null> = [];
  try {
    for (let i = 0; i < paras.length; i += EMBED_BATCH) {
      const batch = paras.slice(i, i + EMBED_BATCH).map((p) => p.text);
      const res = await embeddingsService.embed(batch, { signal: AbortSignal.timeout(60_000) });
      out.push(...res.embeddings);
    }
    return out;
  } catch (err) {
    embedDisabled = true;
    console.log(`  ! embed service unavailable (${(err as Error).message}) — continuing FTS-only (null embeddings)`);
    return paras.map(() => null);
  }
}

// ---- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (!Number.isInteger(args.from) || !Number.isInteger(args.to) || args.to < args.from || args.limit < 1) {
    console.error('Bad --from/--to/--limit. See --help.');
    process.exitCode = 1;
    return;
  }
  if (!args.embed) embedDisabled = true;

  // The DB client is only imported for real runs, so a dry run cannot open a
  // connection even by accident.
  let sql: NonNullable<ReturnType<typeof DbFn>> | null = null;
  let outFile: string | null = null;
  if (args.dryRun) {
    mkdirSync(args.out, { recursive: true });
    outFile = resolve(args.out, `judgments-${args.court}-${args.from}-${args.to}.jsonl`);
    writeFileSync(outFile, '');
    console.log(`Dry run → ${outFile} (no database)`);
  } else {
    const { db } = await import('../db/client');
    sql = db();
    if (!sql) {
      console.error('DATABASE_URL is not configured. Add it to apps/api/.env and re-run (or use --dry-run).');
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Ingesting ${args.court} ${args.from}–${args.to}, limit ${args.limit}, embeddings ${args.embed ? 'on' : 'off'}`);
  let done = 0;
  let skipped = 0;

  for await (const c of candidates(args.court, args.from, args.to)) {
    if (done >= args.limit) break;
    const label = `${c.meta.sourceKey} — ${c.meta.caseTitle.slice(0, 70)}`;

    if (sql && !args.force) {
      const exists = await sql`select 1 from judgments where source_key = ${c.meta.sourceKey}`;
      if (exists.length) { skipped += 1; continue; }
    }

    const pdfUrl = objectUrl(c.bucket, c.pdfKey);
    let pdf: Buffer | null;
    try {
      pdf = await fetchPdf(pdfUrl);
    } catch (err) {
      console.log(`  skip ${label}: ${(err as Error).message}`);
      skipped += 1;
      continue;
    }
    if (!pdf) { console.log(`  skip ${label}: no PDF at ${c.pdfKey}`); skipped += 1; continue; }

    const extracted = await extractText({ body: pdf, mime: 'application/pdf', fileName: c.pdfKey, maxChars: 2_000_000 });
    if (!extracted.ok || extracted.text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
      console.log(`  skip ${label}: ${extracted.ok ? 'too little text' : extracted.error}`);
      skipped += 1;
      continue;
    }

    const cleaned = cleanJudgmentText(extracted.text);
    const { paragraphs, numbered } = splitParagraphs(cleaned);
    if (paragraphs.length === 0) { console.log(`  skip ${label}: no paragraphs`); skipped += 1; continue; }
    if (paragraphs.length < args.minParas) { console.log(`  skip ${label}: ${paragraphs.length} para(s), a short order`); skipped += 1; continue; }

    const meta: JudgmentMeta = {
      ...c.meta,
      neutralCitation: c.meta.neutralCitation ?? neutralCitationFromText(cleaned.slice(0, 4000) + cleaned.slice(-4000)),
    };
    const embeddings = await embedParagraphs(paragraphs);
    const provenance = {
      dataset: DATASET,
      bucket: c.bucket,
      metadataKey: c.metadataKey,
      pdfKey: c.pdfKey,
      numberedParagraphs: numbered,
      caseNumber: meta.caseNumber,
    };

    if (outFile) {
      appendFileSync(outFile, `${JSON.stringify({
        judgment: { ...meta, pdfUrl, paraCount: paragraphs.length, metadata: provenance },
        paragraphs: paragraphs.map((p, i) => ({ ...p, embedded: embeddings[i] !== null })),
      })}\n`);
    } else {
      await sql!.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into judgments (
            source, source_key, court, court_code, bench, bench_size, case_title, case_number, cnr,
            neutral_citation, reported_citations, decision_date, disposal, language, source_url, pdf_url,
            para_count, metadata, updated_at)
          values (
            'aws-open-data', ${meta.sourceKey}, ${meta.court}, ${meta.courtCode}, ${meta.bench}, ${meta.benchSize},
            ${meta.caseTitle}, ${meta.caseNumber}, ${meta.cnr}, ${meta.neutralCitation},
            ${tx.array(meta.reportedCitations)}::text[], ${meta.decisionDate}::date, ${meta.disposal},
            ${meta.language}, ${meta.sourceUrl}, ${pdfUrl}, ${paragraphs.length}, ${tx.json(provenance)}, now())
          on conflict (source_key) do update set
            court = excluded.court, court_code = excluded.court_code, bench = excluded.bench,
            bench_size = excluded.bench_size, case_title = excluded.case_title, case_number = excluded.case_number,
            cnr = excluded.cnr, neutral_citation = excluded.neutral_citation,
            reported_citations = excluded.reported_citations, decision_date = excluded.decision_date,
            disposal = excluded.disposal, language = excluded.language, source_url = excluded.source_url,
            pdf_url = excluded.pdf_url, para_count = excluded.para_count, metadata = excluded.metadata,
            updated_at = now()
          returning id
        `;
        await tx`delete from judgment_paragraphs where judgment_id = ${row!.id}`;
        for (let i = 0; i < paragraphs.length; i += 1) {
          const p = paragraphs[i]!;
          const vec = embeddings[i] ? `[${embeddings[i]!.join(',')}]` : null;
          await tx`
            insert into judgment_paragraphs (judgment_id, seq, para_no, text, embedding)
            values (${row!.id}, ${p.seq}, ${p.paraNo}, ${p.text}, ${vec}::vector)
          `;
        }
      });
    }

    done += 1;
    console.log(`  ✓ [${done}/${args.limit}] ${label} · ${paragraphs.length} paras${numbered ? '' : ' (unnumbered)'}${meta.neutralCitation ? ` · ${meta.neutralCitation}` : ''}`);
  }

  console.log(`\nDone: ${done} ingested, ${skipped} skipped${args.dryRun ? ` → ${outFile}` : ''}.`);
  if (sql) await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
