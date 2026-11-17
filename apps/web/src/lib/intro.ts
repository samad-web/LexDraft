// Answers from the landing page's first-visit questions ("How do you run your
// practice?", "What's your name?"). Kept in this browser only; used to
// personalise the landing page, pre-fill sign-up and pre-pick a plan.

export type PracticeSize = 'solo' | 'team' | 'firm';

export interface IntroAnswers {
  size?: PracticeSize;
  name?: string;
  /** Picked on the sign-in page's left tabs; pre-selects onboarding. */
  kind?: 'advocate' | 'student';
  /** Closed without answering: don't ask again. */
  dismissed?: boolean;
}

const KEY = 'difai-intro';

export function readIntro(): IntroAnswers {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as IntroAnswers;
  } catch {
    return {};
  }
}

export function saveIntro(answers: IntroAnswers): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readIntro(), ...answers }));
  } catch {
    // Private mode / storage blocked: the questions just show again next time.
  }
}

// A plan picked by "Start with …" on the pricing page (owner 2026-11-17: the
// plan is chosen once). Short-lived so an old pick (earlier test, someone else
// on a shared computer) never pre-selects a new account's plan.
export type PlanPick = 'advocate' | 'chambers' | 'law_firm';
const PICK_KEY = 'difai-plan-pick';
export const PLAN_PICK_TTL_MS = 2 * 60 * 60 * 1000;

export function savePlanPick(plan: PlanPick, now = Date.now()): void {
  try { localStorage.setItem(PICK_KEY, JSON.stringify({ plan, at: now })); } catch { /* storage blocked: no pre-pick */ }
}

/** The fresh pick, or null (none, expired, or unreadable). */
export function readPlanPick(now = Date.now()): PlanPick | null {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null') as { plan?: string; at?: number } | null;
    if (!v || typeof v.at !== 'number' || now - v.at > PLAN_PICK_TTL_MS || now < v.at) return null;
    return v.plan === 'advocate' || v.plan === 'chambers' || v.plan === 'law_firm' ? v.plan : null;
  } catch {
    return null;
  }
}

export function clearPlanPick(): void {
  try { localStorage.removeItem(PICK_KEY); } catch { /* nothing to clear */ }
}
