// Smoke-test for the indiacode-rag integration. Bypasses the HTTP layer
// so the actual error from embed / pgvector / RPC is visible on stderr
// instead of being wrapped in an opaque 500.
//
// Run from the repo root:
//   pnpm --filter @lexdraft/api exec tsx scripts/smoke-laws.ts
//
// Safe to delete after the integration is verified.

import { env } from '../src/env';
import { embeddingsService } from '../src/services/embeddings.service';
import { lawsSearchService } from '../src/services/laws-search.service';
import { closeLawsDb } from '../src/lib/laws-db';

async function main(): Promise<void> {
  console.log('--- ENV ---');
  console.log({
    hasLawsCorpus: env.hasLawsCorpus,
    LAWS_DATABASE_URL: env.LAWS_DATABASE_URL ? 'set' : 'EMPTY',
    LAWS_DATABASE_SSL: env.lawsDatabaseSsl,
    SUPABASE_URL: env.SUPABASE_URL ? 'set' : 'EMPTY',
    SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY ? 'set' : 'EMPTY',
    SUPABASE_STORAGE_BUCKET: env.SUPABASE_STORAGE_BUCKET,
    EMBED_SERVICE_URL: env.EMBED_SERVICE_URL ? 'set' : 'EMPTY',
    EMBED_API_KEY: env.EMBED_API_KEY ? 'set' : 'EMPTY',
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
    EMBEDDING_DIMS: env.EMBEDDING_DIMS,
  });

  console.log('\n--- EMBED ---');
  try {
    const r = await embeddingsService.embed(['section 420 ipc cheating dishonest inducement']);
    console.log('OK', {
      model: r.model,
      dims: r.dims,
      first5: r.embeddings[0]?.slice(0, 5),
    });
  } catch (err) {
    console.error('EMBED FAILED:', err);
    process.exitCode = 1;
    return;
  }

  console.log('\n--- SEARCH ---');
  try {
    const hits = await lawsSearchService.search('cheating dishonest inducement', { k: 3 });
    console.log(`Got ${hits.length} hits`);
    for (const h of hits) {
      console.log({
        citation:       h.citation,
        actTitle:       h.actTitle,
        sectionNumber:  h.sectionNumber,
        sectionHeading: h.sectionHeading,
        score:          h.score,
        snippet:        h.content.slice(0, 80) + '…',
      });
    }
  } catch (err) {
    console.error('SEARCH FAILED:', err);
    process.exitCode = 1;
  } finally {
    await closeLawsDb();
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
