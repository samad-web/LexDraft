// =============================================================================
// diary-assistant-smoke — exercises the deterministic command parser without a
// DB or LLM. Run with the AI provider forced off so parseCommand takes the
// heuristic path:
//
//   LLM_PROVIDER=none JWT_SECRET=dev-secret-0123456789 npx tsx \
//     apps/api/src/scripts/diary-assistant-smoke.ts
//
// It prints the proposed action for a spread of natural-language commands so a
// human can eyeball intent / date / time / matter extraction. Not a unit test —
// a quick manual smoke for the fallback parser.
// =============================================================================

import { diaryAssistantService } from '../services/diary-assistant.service';

const CASES: string[] = [
  'log Mehta v. Skyline hearing tomorrow 11am at HC Karnataka, arguments',
  'remind me to file the appeal by next Friday',
  'remind me about the Mehta hearing tomorrow 11am',
  "what's on this week?",
  'my day',
  'note judgment for State of Karnataka tomorrow morning',
  'add hearing for Acme Corp next monday 2.30pm at City Civil Court',
  'schedule filing deadline 31/12/2026 for Patel matter',
  'gibberish with no actionable content',
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`provider=none smoke — today is ${new Date().toISOString().slice(0, 10)} (UTC)\n`);
  for (const text of CASES) {
    const p = await diaryAssistantService.parseCommand(text, { firmId: null, userId: '' });
    // eslint-disable-next-line no-console
    console.log('INPUT  :', text);
    // eslint-disable-next-line no-console
    console.log('  intent     :', p.intent, '| model:', p.modelUsed);
    if (p.briefingRange) {
      // eslint-disable-next-line no-console
      console.log('  briefRange :', p.briefingRange);
    }
    if (p.diaryEntry) {
      // eslint-disable-next-line no-console
      console.log('  entry      :', JSON.stringify(p.diaryEntry));
    }
    if (p.message) {
      // eslint-disable-next-line no-console
      console.log('  message    :', p.message);
    }
    // eslint-disable-next-line no-console
    console.log('  confirm    :', p.confirmation, '\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
