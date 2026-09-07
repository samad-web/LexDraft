// draft-clarify — turns the agent's free-text `needs_clarification` questions
// into advocate-legible, fast-to-answer inputs.
//
// The pipeline (drafting-prompts.ts) returns each missing fact as a short
// question aimed at the advocate ("Which court is the bail application before?").
// A senior advocate wants to answer these in seconds: tap a known option, or
// type the one or two facts only they hold (client name, FIR number). This
// module classifies each question so the UI can render the fastest control —
// option chips where the answer space is known, a plain text field otherwise —
// and pre-selects a sensible default so an untouched question still resolves.
//
// It is deliberately heuristic and offline (no LLM round-trip) so the card
// appears instantly. Unknown questions gracefully fall back to a text field.

export type ClarifyKind = 'choice' | 'text' | 'longtext';

export interface ClarifyField {
  /** The original question, shown as the label. */
  question: string;
  kind: ClarifyKind;
  /** For 'choice': the option chips, first one used as the smart default. */
  options?: string[];
  /** Stable key for React + answer collection. */
  key: string;
  /** Short hint shown under a text field (what to type). */
  hint?: string;
}

// ---- Known answer spaces ---------------------------------------------------
//
// Each matcher looks at the lowercased question text. Order matters: more
// specific matchers first. The first option in `options` is the smart default,
// chosen to be the most common real-world answer so an advocate who trusts the
// default can just hit Draft.

interface Matcher {
  test: (q: string) => boolean;
  build: (q: string, i: number) => ClarifyField;
}

const MATCHERS: Matcher[] = [
  // Court / forum
  {
    test: (q) => /\b(court|forum|before which|which bench|jurisdiction)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['Court of Session', 'Magistrate', 'High Court', 'District Court', 'Tribunal'],
    }),
  },
  // Bail: first or successive
  {
    test: (q) => /\b(first|successive|earlier bail|previous bail|second bail)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['First bail application', 'Successive (with change in circumstances)'],
    }),
  },
  // Custody / arrest status
  {
    test: (q) => /\b(in custody|arrested|judicial custody|police custody|custody status|already arrested)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['In judicial custody', 'In police custody', 'Not yet arrested', 'On interim bail'],
    }),
  },
  // Investigation / charge-sheet stage
  {
    test: (q) => /\b(charge.?sheet|chargesheet|investigation stage|investigation status|final report)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['Investigation pending', 'Charge-sheet filed', 'Cognizance taken'],
    }),
  },
  // Prior record / antecedents
  {
    test: (q) => /\b(prior record|antecedent|previous conviction|criminal history|past cases)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['No prior record', 'Has antecedents'],
    }),
  },
  // Represented by advocate (BNSS 355 precondition, etc.)
  {
    test: (q) => /\b(represented by|through counsel|advocate on record|pleader)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['Yes, represented by an advocate', 'Appearing in person'],
    }),
  },
  // FIR / crime number → short text with a format hint
  {
    test: (q) => /\b(fir|crime number|crime no|f\.i\.r|case number|case no|cnr)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'text', key: `q${i}`,
      hint: 'e.g. FIR No. 214/2026, PS Aundh',
    }),
  },
  // Dates
  {
    test: (q) => /\b(date|when|on which day|hearing date)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'text', key: `q${i}`, hint: 'e.g. 28-04-2026',
    }),
  },
  // Amounts / value
  {
    test: (q) => /\b(amount|value|sum|how much|consideration|₹|rs\.?|rupees)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'text', key: `q${i}`, hint: 'e.g. ₹4,00,000',
    }),
  },
  // Names / parties → text
  {
    test: (q) => /\b(name|who is|client|accused|petitioner|respondent|complainant|parties|applicant)\b/.test(q),
    build: (q, i) => ({
      question: q, kind: 'text', key: `q${i}`, hint: 'Full name as it should appear',
    }),
  },
  // Generic yes/no — LAST, and only for genuine polar questions. A wh-question
  // ("what/which/who/how much…") asks for a VALUE, not yes/no, so we exclude it;
  // otherwise "What is the name?" wrongly becomes a Yes/No card.
  {
    test: (q) =>
      /\b(whether|is the|does the|has the|are there|did the|was the|will the)\b/.test(q)
      && !/\b(what|which|who|whom|how much|how many|name|number|amount|date)\b/.test(q)
      && q.length < 90,
    build: (q, i) => ({
      question: q, kind: 'choice', key: `q${i}`,
      options: ['Yes', 'No', 'Not sure — leave blank'],
    }),
  },
];

/** Classify one question into the fastest control to answer it. */
export function classifyQuestion(question: string, index: number): ClarifyField {
  const q = question.toLowerCase();
  for (const m of MATCHERS) {
    if (m.test(q)) return m.build(question, index);
  }
  // Facts/narrative questions tend to be long — give room to type.
  const kind: ClarifyKind = /\b(facts|what happened|describe|circumstances|background|briefly)\b/.test(q)
    ? 'longtext'
    : 'text';
  return { question, kind, key: `q${index}` };
}

export function classifyQuestions(questions: string[]): ClarifyField[] {
  return questions.map((question, i) => classifyQuestion(question, i));
}

/**
 * Fold the advocate's answers back into the brief the agent re-reads. We append
 * a compact "Confirmed details" block rather than mutating the original text, so
 * the agent sees the answers as authoritative facts. Blank answers are omitted
 * (they stay as ____ placeholders in the draft — never invented).
 */
export function answersToBriefAppendix(
  fields: ClarifyField[],
  answers: Record<string, string>,
): string {
  const lines = fields
    .map((f) => {
      const a = (answers[f.key] ?? '').trim();
      if (!a || /^not sure/i.test(a)) return null;
      // Strip a trailing "?" from the question for a clean "Q: A" line.
      const label = f.question.replace(/\s*\?\s*$/, '');
      return `- ${label}: ${a}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\n\nConfirmed details (advocate-supplied — treat as authoritative facts):\n${lines.join('\n')}`;
}
