// docTypeConventions is not exported; assert its effect through buildDraftStage's
// system prompt, which embeds the doc-type-specific guidance. STEP 5a: an affidavit
// label gets first-person voice guidance and NOT the §138-notice line, even when the
// label also mentions s.138 (if/else pairing).
import { describe, expect, it } from 'vitest';
import { buildDraftStage, type DraftStageInput } from '../drafting-prompts';

const base: Omit<DraftStageInput, 'docType'> = {
  forum: 'Court of Judicial Magistrate',
  factsJson: '{}',
  sections: [],
  blocks: [{ block: 'facts', instruction: 'Narrate the facts.' }],
};

const systemFor = (docType: string): string =>
  buildDraftStage({ ...base, docType }).system;

const AFFIDAVIT_MARKER = 'write in the FIRST PERSON';
const NOTICE_MARKER = 'Section 138 notice: the statutory limbs';

describe('docTypeConventions — affidavit voice (STEP 5a)', () => {
  it('an affidavit docType gets the affidavit line and NOT the notice line', () => {
    const s = systemFor('Affidavit');
    expect(s).toContain(AFFIDAVIT_MARKER);
    expect(s).not.toContain(NOTICE_MARKER);
  });

  it('a §138 notice docType still gets the notice line unchanged', () => {
    const s = systemFor('Notice u/s 138 NI Act');
    expect(s).toContain(NOTICE_MARKER);
    expect(s).not.toContain(AFFIDAVIT_MARKER);
  });

  it('a label mentioning BOTH ("Affidavit under s.138") gets only the affidavit line', () => {
    const s = systemFor('Affidavit under s.138');
    expect(s).toContain(AFFIDAVIT_MARKER);
    expect(s).not.toContain(NOTICE_MARKER);
  });
});
