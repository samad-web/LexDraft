// Smoke test: the OpenAI-compatible slot (OPENAI_API_KEY) through the app's own
// code paths. Run from apps/api:  npx tsx src/scripts/openai-smoke.ts
import { env } from '../env';
import { grokComplete } from '../lib/grok-client';
import { intakeLlm } from '../services/intake-llm.service';

async function main() {
  console.log('vendor:', env.openaiCompat.vendor, '| drafting model:', env.XAI_MODEL, '| intake model:', env.intakeModel);
  console.log('providers:', env.llmProvider, '/', env.intakeProvider);

  const hello = await grokComplete({ system: 'Reply in one short sentence.', user: 'Confirm you are reachable.', maxTokens: 200 });
  console.log('\n[1] drafting model says:', JSON.stringify(hello.text), '| tokens', hello.tokensIn, '->', hello.tokensOut);

  const patch = await intakeLlm.extract({
    docLabel: 'Notice u/s 138 NI Act',
    fields: [
      { key: 'drawer_name', label: 'Drawer (accused) name', kind: 'string', required: true },
      { key: 'cheque_amount', label: 'Cheque amount', kind: 'money', required: true },
      { key: 'cheque_number', label: 'Cheque number', kind: 'string', required: true },
      { key: 'dishonour_date', label: 'Date of dishonour', kind: 'date', required: true },
      { key: 'return_reason', label: 'Reason for return', kind: 'string', required: true },
    ] as never,
    transcript: '',
    latest: 'My client Lakshmi Traders got cheque no. 004512 for Rs. 2,50,000 from Ramesh Kumar. It bounced on 12 March 2026 for "funds insufficient".',
    answering: [],
    today: new Date().toISOString().slice(0, 10),
    onUsage: (u) => console.log('    usage:', u.provider, u.model, u.tokensIn, '->', u.tokensOut),
  });
  console.log('\n[2] extracted fields:');
  for (const f of patch.fields) console.log(`    ${f.key} = ${f.value}  (${f.confidence})`);
  console.log('    model used:', patch.modelUsed);
}

main().catch((err) => { console.error('FAILED:', err?.message ?? err); process.exit(1); });
