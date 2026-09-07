// Assembly-level check: feed a FULL bail block map (exactly the shape the web
// onAccept receives from the pipeline — causeTitle + facts + grounds +
// undertaking + prayer + verification) through the real render + open-items
// helpers, and assert the PDF-style defects are gone:
//   - no internal key leaks as a heading (no "CAUSETITLE", "VERIFICATION" mislabel of the title)
//   - causeTitle renders label-less as the document opening
//   - open items are extracted, not left buried
import { describe, it, expect } from 'vitest';
import { renderDraftBlocks, collectOpenItems } from '../draft-blocks';

const FULL_BAIL_BLOCKS: Record<string, string> = {
  causeTitle:
    'IN THE COURT OF SESSION AT DELHI\n\nBail Application No. ______ of 2026\n\nRamesh Kumar, aged 34 years, son of [father’s name to be supplied], shopkeeper, resident of 14 Ashok Nagar ... Applicant\n\nVersus\n\nState ... Respondent',
  facts:
    'The Applicant was arrested on 5 August 2026 in FIR No. 112/2025 at Ashok Nagar Police Station for an offence punishable under BNS 318(4).',
  grounds:
    '1. That the charge-sheet has been filed, completing custodial interrogation.\n2. That the Applicant is a permanent resident and poses no flight risk.',
  undertaking:
    'The Applicant undertakes to cooperate with the investigation and not to tamper with evidence.',
  prayer:
    'It is prayed that this Hon’ble Court grant regular bail to the Applicant in FIR No. 112/2025.',
  verification:
    'Verified at [place] on [date] that the contents of paragraphs 1 to [fact paras] are true to my personal knowledge and the grounds are based on legal advice believed to be true.',
};

describe('full bail assembly (reproduces the reported PDF and proves the fix)', () => {
  const body = renderDraftBlocks(FULL_BAIL_BLOCKS);

  it('never leaks an internal block key as a heading', () => {
    expect(body).not.toMatch(/CAUSETITLE/);
    expect(body).not.toMatch(/causeTitle/);
    // The document must OPEN with the cause title, label-less.
    expect(body.startsWith('IN THE COURT OF SESSION')).toBe(true);
  });

  it('labels the substantive blocks with forum-convention headings', () => {
    expect(body).toContain('FACTS\n\n');
    expect(body).toContain('GROUNDS\n\n');
    expect(body).toContain('UNDERTAKING\n\n');
    expect(body).toContain('PRAYER\n\n');
    expect(body).toContain('VERIFICATION\n\n');
  });

  it('does NOT stamp the title as a notice (the reported bug)', () => {
    expect(body).not.toMatch(/NOTICE U\/S 138/i);
  });

  it('extracts open items as a separate list, not buried in the body', () => {
    const items = collectOpenItems({ bodyText: body, verifyPlaceholders: ['[fact paras]'.replace(/[[\]]/g, '')] });
    expect(items.placeholders).toContain('father’s name to be supplied');
    expect(items.placeholders).toContain('place');
    expect(items.placeholders).toContain('date');
    // The open-items object is derived; the body still shows the placeholders
    // inline (they ARE part of the draft) but the list surfaces them for review.
    expect(items.placeholders.length).toBeGreaterThanOrEqual(3);
  });
});
