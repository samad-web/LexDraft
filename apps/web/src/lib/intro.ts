// Answers from the landing page's first-visit questions ("How do you run your
// practice?", "What's your name?"). Kept in this browser only; used to
// personalise the landing page, pre-fill sign-up and pre-pick a plan.

export type PracticeSize = 'solo' | 'team' | 'firm';

export interface IntroAnswers {
  size?: PracticeSize;
  name?: string;
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
