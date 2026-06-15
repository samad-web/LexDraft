// =============================================================================
// draft-extract-smoke — exercises the field extractor. With the provider forced
// off it returns an empty extraction (no crash); with a real key it extracts.
//
//   # demo (no LLM) — should print {} and not throw
//   LLM_PROVIDER=none JWT_SECRET=dev-secret-0123456789 npx tsx \
//     apps/api/src/scripts/draft-extract-smoke.ts
//
//   # real — set the provider + key, pass a non-null firm/user is NOT needed
//   # here (the script uses placeholders); run against a configured env instead.
// =============================================================================

import type { DraftFieldSpec } from '@lexdraft/types';
import { draftExtractService } from '../services/draft-extract.service';

const FIELDS: DraftFieldSpec[] = [
  { key: 'court', label: 'Court', type: 'text', required: true },
  { key: 'plaintiff_name', label: 'Plaintiff name', type: 'text', required: true },
  { key: 'defendant_name', label: 'Defendant name', type: 'text', required: true },
  { key: 'suit_value', label: 'Suit value', type: 'currency', required: true },
  { key: 'cause_date', label: 'Cause of action date', type: 'date', required: true },
  { key: 'facts', label: 'Facts', type: 'textarea', required: true },
  { key: 'reliefs', label: 'Reliefs', type: 'textarea', required: true },
];

const BRIEF =
  'File a plaint before the City Civil Court, Bangalore. Plaintiff is Acme Traders Pvt Ltd, ' +
  'defendant is Sundar Rao. Suit value about Rs 8,50,000. Cause of action arose on 12 March 2026 ' +
  'when the defendant failed to pay for goods supplied. We seek recovery of the amount with interest and costs.';

async function main(): Promise<void> {
  const result = await draftExtractService.extractFields(
    { docType: 'Plaint', brief: BRIEF, fields: FIELDS },
    { firmId: null, userId: '' },
  );
  // eslint-disable-next-line no-console
  console.log('modelUsed:', result.modelUsed);
  // eslint-disable-next-line no-console
  console.log('values   :', JSON.stringify(result.values, null, 2));
  // eslint-disable-next-line no-console
  console.log(`extracted ${Object.keys(result.values).length}/${FIELDS.length} fields`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
