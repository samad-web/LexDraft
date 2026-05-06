import type { ResearchAnswer } from '@lexdraft/types';

const CANNED: Record<string, ResearchAnswer> = {
  default: {
    query: '',
    answer:
      'Under the Indian legal framework, the relevant statute and bench rulings establish a tiered analysis. The leading authority remains binding precedent of the constitutional courts. Subordinate fora are bound to apply the doctrine of stare decisis as understood through Article 141 of the Constitution.',
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
  },
};

export const researchService = {
  ask(query: string): ResearchAnswer {
    const base = CANNED.default!;
    return { ...base, query };
  },
};
