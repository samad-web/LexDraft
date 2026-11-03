// =============================================================================
// embed-judgments — backfill bge-m3 embeddings for judgment paragraphs that were
// ingested FTS-only (embed service down / --no-embed). Re-uses the stored text;
// no PDF is downloaded again. Idempotent: only rows with a null embedding.
//
//   pnpm --filter @lexdraft/api exec tsx src/scripts/embed-judgments.ts [--batch 32] [--limit N]
// =============================================================================

import { env } from '../env';
import { db } from '../db/client';
import { embeddingsService } from '../services/embeddings.service';

const MIN_CHARS = 250;
const REASONING_RX = String.raw`\m(held|holds|settled|principle|principles|it is clear|we are of the (view|opinion)|the law|ratio|is not maintainable|abuse of (the )?process)\M`;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function main(): Promise<void> {
  if (!env.EMBED_SERVICE_URL) throw new Error('EMBED_SERVICE_URL is not set — start the embed service first.');
  const sql = db();
  if (!sql) throw new Error('no database configured');
  const batch = Math.min(64, Math.max(1, arg('batch', 16)));
  const limit = arg('limit', Number.MAX_SAFE_INTEGER);

  // Only citable paragraphs (search skips < MIN_CHARS anyway), law-stating ones
  // first: on a CPU embedder the whole corpus takes hours, so the paragraphs a
  // draft would actually cite get their vectors soonest.
  const n = (await sql<Array<{ n: number }>>`
    select count(*)::int as n from judgment_paragraphs where embedding is null and length(text) >= ${MIN_CHARS}`)[0]?.n ?? 0;
  console.log(`[embed-judgments] ${n} paragraph(s) without an embedding; batch ${batch}`);
  let done = 0;
  const t0 = Date.now();
  while (done < limit) {
    const rows = await sql<Array<{ id: string; text: string }>>`
      select id, text from judgment_paragraphs
      where embedding is null and length(text) >= ${MIN_CHARS}
      order by (text ~* ${REASONING_RX}) desc, id
      limit ${batch}
    `;
    if (!rows.length) break;
    const { embeddings } = await embeddingsService.embed(rows.map((r) => r.text), { signal: AbortSignal.timeout(900_000) });
    await sql.begin(async (tx) => {
      for (let i = 0; i < rows.length; i += 1) {
        await tx`update judgment_paragraphs set embedding = ${`[${embeddings[i]!.join(',')}]`}::vector where id = ${rows[i]!.id}`;
      }
    });
    done += rows.length;
    const rate = done / ((Date.now() - t0) / 1000);
    console.log(`  ✓ ${done}/${n} (${rate.toFixed(1)}/s, ~${Math.round((n - done) / Math.max(rate, 0.01) / 60)} min left)`);
  }
  console.log(`[embed-judgments] done: ${done} embedded`);
  await sql.end();
}

main().catch((err) => {
  console.error('[embed-judgments] failed:', err);
  process.exit(1);
});
