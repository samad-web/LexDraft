import { Router } from 'express';
import { z } from 'zod';
import { lawsSearchService } from '../services/laws-search.service';
import { requireFeature } from '../services/permissions.service';

// Indian-law corpus retrieval, backed by indiacode-rag. See
// LEXDRAFT_INTEGRATION.md for the upstream contract.
//
// Mounted at /api/laws by routes/index.ts. Gated on `research.basic` —
// the same feature flag the legacy /research uses, so plan eligibility
// is unchanged.

const SearchBody = z.object({
  query:  z.string().min(2).max(1000),
  actId:  z.string().uuid().optional(),
  k:      z.number().int().min(1).max(50).optional(),
  rerank: z.boolean().optional(),
  /** Jurisdictional scope: 'central' (parliamentary acts only),
   *  'state' (any state legislature), or 'state:<canonical name>'
   *  for one specific state. */
  scope:  z.string().max(80).optional(),
});

const LookupBody = z.object({
  act:     z.string().min(1).max(80),
  section: z.string().min(1).max(40),
  k:       z.number().int().min(1).max(20).optional(),
});

const PdfBody = z.object({
  storagePath: z.string().min(1).max(500),
  ttlSeconds:  z.number().int().min(60).max(86_400).optional(),
});

function ensureConfigured(): void {
  if (!lawsSearchService.configured()) {
    const err = new Error(
      'Indian-law corpus is not configured on this deployment. Set LAWS_DATABASE_URL + EMBED_SERVICE_URL.',
    );
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
}

export const lawsRouter: Router = Router();

/**
 * Hybrid search (RRF over pgvector + FTS). Use for the Research view and
 * for context-aware recommendations from drafting/contract-review side
 * panels — the caller decides whether to rerank.
 */
lawsRouter.post('/search', requireFeature('research.basic'), async (req, res, next) => {
  try {
    ensureConfigured();
    const body = SearchBody.parse(req.body);
    // Parse scope string into the structured form the service expects.
    // 'central' → central only. 'state' → any state. 'state:<name>' → one.
    let scope: { type: 'central' | 'state'; state?: string } | undefined;
    if (body.scope) {
      if (body.scope === 'central') scope = { type: 'central' };
      else if (body.scope === 'state') scope = { type: 'state' };
      else if (body.scope.startsWith('state:')) {
        scope = { type: 'state', state: body.scope.slice('state:'.length) };
      }
    }
    const results = await lawsSearchService.search(body.query, {
      actId: body.actId ?? null,
      k:      body.k,
      rerank: body.rerank,
      scope,
    });
    res.json({ query: body.query, results });
  } catch (err) {
    next(err);
  }
});

/**
 * Direct citation lookup — skips embedding for "BNS 103"-style queries.
 * Cheaper and exact when the user knows the section number.
 */
lawsRouter.post('/lookup', requireFeature('research.basic'), async (req, res, next) => {
  try {
    ensureConfigured();
    const body = LookupBody.parse(req.body);
    const results = await lawsSearchService.lookup(body.act, body.section, body.k);
    res.json({ act: body.act, section: body.section, results });
  } catch (err) {
    next(err);
  }
});

/**
 * Mint a short-lived signed URL for a PDF in the corpus storage bucket.
 * The web client never sees the service-role key; it asks here.
 */
lawsRouter.post('/pdf-url', requireFeature('research.basic'), async (req, res, next) => {
  try {
    ensureConfigured();
    const body = PdfBody.parse(req.body);
    const url = await lawsSearchService.signedPdfUrl(body.storagePath, body.ttlSeconds ?? 3600);
    if (!url) {
      res.status(503).json({ error: 'Storage signing is not configured.' });
      return;
    }
    res.json({ url });
  } catch (err) {
    next(err);
  }
});
