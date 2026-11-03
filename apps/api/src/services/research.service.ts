import type { ResearchAnswer } from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { HttpError } from '../lib/errors';
import { claudeComplete } from '../lib/anthropic-client';
import { withRetry } from '../lib/retry';
import { citationKey, judgmentCitationsIn } from '../lib/draft-guards';
import { aiQuotaService } from './ai-quota.service';
import { aiUsageService } from './ai-usage.service';
import { judgmentsService, type JudgmentHit } from './judgments.service';

// =============================================================================
// Research Q&A.
//
// Real path (whenever the judgment corpus has rows — 0098_judgments_corpus):
//   1. retrieve  — judgmentsService.search(): real paragraphs of real judgments
//   2. synthesise — Claude (env.ANTHROPIC_MODEL) writes a short answer from
//                   ONLY those paragraphs, citing them as [S1], [S2] ...
//   3. post-check — postCheckAnswer() does not take the model's word for it:
//                   any marker, citation or "X v. Y" case name that is not one
//                   of the retrieved judgments is stripped (with its sentence)
//                   and reported in `removedCitations`.
// Every citation returned carries its judgment id, source PDF url and the
// paragraph number relied on.
//
// Without a corpus, the old behaviour stands: honest 501 ('none' /
// 'indiacode'), or the labelled demo answer ('demo').
// =============================================================================

/**
 * Demo-only canned answer. The opening line marks it explicitly as a
 * demonstration so any frontend that renders the response shows that
 * banner verbatim - we don't pretend the citations are real findings.
 */
const DEMO_ANSWER: ResearchAnswer = {
  query: '',
  answer:
    'DEMONSTRATION CONTENT - Not real legal research. ' +
    'Under the Indian legal framework, the relevant statute and bench rulings establish a tiered analysis. ' +
    'The leading authority remains binding precedent of the constitutional courts. Subordinate fora are bound ' +
    'to apply the doctrine of stare decisis as understood through Article 141 of the Constitution.',
  citations: [
    {
      title: 'Mehta v. State of Karnataka',
      court: 'Supreme Court of India',
      citation: '(2021) 4 SCC 412',
      excerpt: 'The principle of natural justice operates wherever a civil consequence ensues...',
    },
    {
      title: 'Patel Industries v. Union of India',
      court: 'Delhi High Court',
      citation: '2023 SCC OnLine Del 1187',
      excerpt: 'Statutory limitation cannot be extended by acquiescence...',
    },
  ],
  source: 'demo',
};

const RETRIEVE_K = 8;

const SYSTEM = `You answer an Indian advocate's legal research question using ONLY the judgment extracts you are given, numbered [S1], [S2], ...

Rules:
- Every legal proposition must carry the marker of the extract that supports it, e.g. "... cannot rest on motive alone [S2]." Cite only markers you were given.
- Never name, cite or allude to any judgment, case name, citation or law report that is not one of the extracts — not even a famous one, not even one an extract itself mentions. The marker is the citation; do not write case citations yourself.
- Do not state anything the extracts do not support. If they do not answer the question, say so plainly in one sentence and stop.
- Plain prose, at most 250 words, no headings, no bullet lists. Do not give advice on the advocate's own facts.`;

export interface ResearchSource {
  caseTitle: string;
  neutralCitation: string | null;
  reportedCitations: string[];
}

// Words that say nothing about WHICH case a "X v. Y" mention is.
const GENERIC_PARTY = new Set([
  'in', 'see', 'per', 'the', 'state', 'union', 'india', 'of', 'and', 'anr', 'ors', 'others', 'another', 'through',
  'by', 'its', 'govt', 'government', 'secretary', 'v', 'vs', 'versus', 'm/s', 'ms', 'mr', 'ltd', 'pvt', 'also',
]);
const CASE_NAME = /\b[A-Z][A-Za-z.&'@]*(?:\s+(?:of\s+)?[A-Z@][A-Za-z.&']*){0,5}\s+(?:v\.?|vs\.?|versus)\s+(?:the\s+)?[A-Z][A-Za-z.&']*(?:\s+(?:of\s+)?[A-Z][A-Za-z.&']*){0,5}/g;
const MARKER = /\[\s*S\d+(?:\s*[,;&]\s*S?\d+)*\s*\]/gi;

// Sentence end: . ! ? before a capital / bracket, but not after "v.", "No.",
// "Rs.", an initial ("M.S.") or similar. Unlike draft-guards' splitter, a
// sentence MAY end in a number — answers end sentences on citations
// ("... (2021) 4 SCC 412. Next ...").
const SENTENCE_END = /(?<!\b(?:v|vs|No|Nos|s|ss|Sec|Art|Mr|Mrs|Ms|Dr|Rs|Ltd|Pvt|Co|Kr|viz|i\.e|e\.g|[A-Z]))[.!?](?=\s+[A-Z(["“])/g;

function sentencesOf(paragraph: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of paragraph.matchAll(SENTENCE_END)) {
    out.push(paragraph.slice(from, m.index! + 1).trim());
    from = m.index! + 1;
  }
  out.push(paragraph.slice(from).trim());
  return out.filter(Boolean);
}

const squash = (s: string) => s.toLowerCase().replace(/[\s.,;:'"“”‘’()/-]+/g, '');

const words = (s: string) =>
  (s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !GENERIC_PARTY.has(w));

/** A "X v. Y" mention matches a source when a distinctive word from EACH side
 *  appears in that source's title. Sides with no distinctive word ("State v.
 *  Union of India") can't identify anything and are treated as matching. */
function caseNameMatches(mention: string, sources: ResearchSource[]): boolean {
  const [left = '', right = ''] = mention.split(/\s+(?:v\.?|vs\.?|versus)\s+/i);
  const l = words(left);
  const r = words(right);
  if (l.length === 0 && r.length === 0) return true;
  return sources.some((s) => {
    const title = ` ${s.caseTitle.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
    const has = (ws: string[]) => ws.length === 0 || ws.some((w) => title.includes(` ${w} `));
    return has(l) && has(r);
  });
}

/**
 * The post-check. `sources[i]` is marker S(i+1). Removes every sentence that
 *   - carries only markers that don't exist ("[S9]" with 8 sources),
 *   - writes a case citation that is not a retrieved judgment's citation,
 *   - names a case ("X v. Y") that is not a retrieved judgment,
 * and trims mixed markers ("[S1, S9]" -> "[S1]"). Returns the cleaned answer,
 * the 0-based source indices still cited, and what was removed.
 */
export function postCheckAnswer(
  answer: string,
  sources: ResearchSource[],
): { answer: string; used: number[]; removed: string[] } {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= sources.length;
  const allowedCites = new Set(
    sources.flatMap((s) => [s.neutralCitation, ...s.reportedCitations]).filter((c): c is string => !!c).map(citationKey),
  );

  const removed: string[] = [];
  const needles: string[] = [];
  const flag = (raw: string) => {
    if (!removed.includes(raw)) removed.push(raw);
    needles.push(raw);
  };

  for (const m of answer.matchAll(MARKER)) {
    const nums = (m[0].match(/\d+/g) ?? []).map(Number);
    if (!nums.some(valid)) flag(m[0]);
  }
  for (const c of judgmentCitationsIn(answer)) {
    if (!allowedCites.has(citationKey(c))) flag(c);
  }
  for (const m of answer.matchAll(CASE_NAME)) {
    if (!caseNameMatches(m[0], sources)) flag(m[0].trim().replace(/[.,;:]+$/, ''));
  }

  let paragraphs = answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (needles.length) {
    const sq = needles.map(squash);
    paragraphs = paragraphs
      .map((p) => sentencesOf(p).filter((s) => !sq.some((n) => squash(s).includes(n))).join(' ').trim())
      .filter(Boolean);
  }

  const used: number[] = [];
  const cleaned = paragraphs
    .map((p) =>
      p.replace(MARKER, (mk) => {
        const keep = [...new Set((mk.match(/\d+/g) ?? []).map(Number).filter(valid))];
        keep.forEach((n) => { if (!used.includes(n - 1)) used.push(n - 1); });
        return keep.length ? `[${keep.map((n) => `S${n}`).join(', ')}]` : '';
      }).replace(/\s{2,}/g, ' ').trim(),
    )
    .filter(Boolean)
    .join('\n\n');

  return { answer: cleaned, used, removed };
}

function citationOf(h: JudgmentHit): string {
  const cites = [h.neutralCitation, ...h.reportedCitations].filter(Boolean);
  return cites.length ? [...new Set(cites)].join('; ') : h.cite;
}

function toCitation(h: JudgmentHit, i: number): ResearchAnswer['citations'][number] {
  return {
    title: h.caseTitle,
    court: h.court,
    citation: citationOf(h),
    excerpt: h.excerpt,
    id: h.id,
    url: h.url,
    paraNo: h.paraNo,
    decisionDate: h.decisionDate,
    marker: `S${i + 1}`,
  };
}

function sourcesBlock(hits: JudgmentHit[]): string {
  return hits
    .map((h, i) =>
      `[S${i + 1}] ${h.cite} — ${h.court}${h.decisionDate ? `, decided ${h.decisionDate}` : ''}, para ${h.paraNo}:\n"${h.excerpt}"`)
    .join('\n\n');
}

export interface ResearchContext {
  firmId: string | null;
  userId: string;
}

async function fromJudgments(query: string, ctx: ResearchContext | null): Promise<ResearchAnswer> {
  const hits = await judgmentsService.search(query, { k: RETRIEVE_K });
  if (hits.length === 0) {
    return {
      query,
      answer: 'No judgment in the DifAi corpus matched this question. The corpus currently holds Supreme Court and Madras High Court judgments; try other words for the legal issue.',
      citations: [],
      source: 'judgments',
    };
  }

  if (!env.ANTHROPIC_API_KEY) {
    // Retrieval works without the model — return the real matches unsynthesised
    // rather than nothing.
    return {
      query,
      answer: 'AI synthesis is not configured. These judgments matched your question; read the cited paragraphs at source.',
      citations: hits.map(toCitation),
      source: 'judgments',
    };
  }

  // May throw AiQuotaExceededError -> route maps to 429.
  if (ctx) await aiQuotaService.assertCanGenerate(ctx.firmId, ctx.userId);

  const user = `QUESTION: ${query.trim()}\n\nEXTRACTS:\n\n${sourcesBlock(hits)}`;
  const result = await withRetry(
    () => claudeComplete({ system: SYSTEM, user, maxTokens: 900 }),
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'research Claude retry') },
  );
  // No 'research' usage feature exists (the admin dashboard's label map is
  // exhaustive over AiUsageFeature) — research Q&A is the same product area as
  // the statute search, so it is recorded under 'laws_search'.
  aiUsageService.recordAsync({
    firmId: ctx?.firmId ?? null, userId: ctx?.userId ?? null, feature: 'laws_search',
    provider: 'anthropic', model: env.ANTHROPIC_MODEL,
    tokensIn: result.tokensIn, tokensOut: result.tokensOut,
    cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
  });

  const checked = postCheckAnswer(result.text.trim(), hits);
  if (checked.removed.length) {
    logger.warn({ removed: checked.removed }, 'research: stripped citations not in the retrieved set');
  }
  // Cited sources in order of first use; if the model cited none, every
  // retrieved judgment is still a real, relevant match worth showing.
  const order = checked.used.length ? checked.used : hits.map((_, i) => i);

  return {
    query,
    answer: checked.answer || 'The retrieved judgments do not directly answer this question. The closest matches are listed below.',
    citations: order.map((i) => toCitation(hits[i]!, i)),
    source: 'judgments',
    ...(checked.removed.length ? { removedCitations: checked.removed } : {}),
  };
}

export const researchService = {
  /** True when ask() returns an answer rather than the 501 below. */
  async canAsk(): Promise<boolean> {
    return (await judgmentsService.configured()) || env.RESEARCH_PROVIDER === 'demo';
  },

  async ask(query: string, ctx: ResearchContext | null = null): Promise<ResearchAnswer> {
    if (await judgmentsService.configured()) return fromJudgments(query, ctx);

    if (env.RESEARCH_PROVIDER === 'none') {
      // Honest 501: no real research backend is wired yet (the judgment
      // corpus is empty or its migration isn't applied). The UI should
      // render "Research coming soon - switch on RESEARCH_PROVIDER=demo
      // for the sales-demo answer."
      throw new HttpError(501, 'Research backend not configured', {
        code: 'RESEARCH_NOT_IMPLEMENTED',
      });
    }
    if (env.RESEARCH_PROVIDER === 'indiacode') {
      // This provider name implies a real Q&A/synthesis backend over the
      // indiacode-rag corpus, but no such synthesis service exists in this
      // repo (laws-search.service.ts does retrieval/search, not answer
      // generation - see the "Search statutes" tab instead). Serving the
      // DEMO_ANSWER's fabricated case citations under a real-sounding
      // provider name would be worse than the 'none' 501: it would look
      // configured and correct. 501 honestly until a real synthesis path
      // is built.
      throw new HttpError(501, 'Research Q&A synthesis is not built yet - try Search statutes instead', {
        code: 'RESEARCH_NOT_IMPLEMENTED',
      });
    }
    return { ...DEMO_ANSWER, query };
  },
};
