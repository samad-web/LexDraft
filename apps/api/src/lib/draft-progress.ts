// =============================================================================
// draft-progress — what a user's in-flight draft is doing right now, so the Draft
// screen can say "Planning the grounds…" instead of a silent minute-long wait.
//
// In-process and per user (one draft at a time per advocate is the norm; a second
// tab simply shows the latest stage). Entries expire, so a crashed request never
// leaves a stale "Writing…" behind.
// =============================================================================

export type DraftStage =
  | 'reading' | 'engine' | 'planning' | 'judgments' | 'writing' | 'checking' | 'repairing' | 'word';

const LABELS: Record<DraftStage, string> = {
  reading: 'Reading your facts',
  engine: 'Checking the law, limitation and format',
  planning: 'Planning the grounds',
  judgments: 'Finding supporting judgments',
  writing: 'Writing the draft',
  checking: 'Fact-checking every line',
  repairing: 'Fixing what the checks found',
  word: 'Preparing the Word file',
};

const TTL_MS = 3 * 60 * 1000;
const current = new Map<string, { stage: DraftStage; at: number }>();

export const draftProgress = {
  set(userId: string | null | undefined, stage: DraftStage): void {
    if (userId) current.set(userId, { stage, at: Date.now() });
  },
  clear(userId: string | null | undefined): void {
    if (userId) current.delete(userId);
  },
  get(userId: string): { stage: DraftStage; label: string } | null {
    const e = current.get(userId);
    if (!e || Date.now() - e.at > TTL_MS) return null;
    return { stage: e.stage, label: LABELS[e.stage] };
  },
};
