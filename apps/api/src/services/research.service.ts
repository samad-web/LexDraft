import type { ResearchAnswer } from '@lexdraft/types';
import { env } from '../env';
import { HttpError } from '../lib/errors';

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
};

export const researchService = {
  ask(query: string): ResearchAnswer {
    if (env.RESEARCH_PROVIDER === 'none') {
      // Honest 501: no real research backend is wired yet. The UI should
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
