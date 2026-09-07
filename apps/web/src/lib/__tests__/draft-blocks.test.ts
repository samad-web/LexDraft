import { describe, it, expect } from 'vitest';
import {
  headingForBlock,
  renderDraftBlocks,
  scanPlaceholders,
  collectOpenItems,
  hasOpenItems,
  emphasizeLegalTerms,
} from '../draft-blocks';

describe('headingForBlock', () => {
  it('renders opening/title blocks label-less', () => {
    expect(headingForBlock('causeTitle')).toBeNull();
    expect(headingForBlock('deponent')).toBeNull();
    expect(headingForBlock('header')).toBeNull();
  });

  it('maps substantive blocks to forum-convention headings', () => {
    expect(headingForBlock('facts')).toBe('FACTS');
    expect(headingForBlock('grounds')).toBe('GROUNDS');
    expect(headingForBlock('paraWiseReply')).toBe('REPLY ON MERITS');
    expect(headingForBlock('jurat')).toBe('VERIFICATION');
  });

  it('de-camelCases an unknown key instead of leaking it raw', () => {
    expect(headingForBlock('someNewKey')).toBe('SOME NEW KEY');
    expect(headingForBlock('foo_bar')).toBe('FOO BAR');
  });
});

describe('renderDraftBlocks', () => {
  it('never emits the internal key as a heading', () => {
    const body = renderDraftBlocks({
      causeTitle: 'IN THE COURT OF SESSION',
      facts: 'The applicant was arrested.',
    });
    expect(body).not.toContain('CAUSETITLE');
    expect(body).not.toContain('causeTitle');
    expect(body.startsWith('IN THE COURT OF SESSION')).toBe(true);
    expect(body).toContain('FACTS\n\nThe applicant was arrested.');
  });

  it('preserves order and skips empty blocks', () => {
    const body = renderDraftBlocks({ facts: 'F', grounds: '', prayer: 'P' });
    expect(body).toBe('FACTS\n\nF\n\nPRAYER\n\nP');
  });
});

describe('scanPlaceholders', () => {
  it('finds bracketed placeholders, deduped and trimmed', () => {
    const text = "Son of [father's name to be supplied]. Verified at [place] on [date]. Again [Place].";
    expect(scanPlaceholders(text)).toEqual([
      "father's name to be supplied",
      'place',
      'date',
    ]);
  });

  it('ignores neutral/numeric citation brackets', () => {
    expect(scanPlaceholders('[2019] 4 SCC 1 and (2019) 4 SCC 1 and footnote [4]')).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(scanPlaceholders('')).toEqual([]);
  });
});

describe('collectOpenItems', () => {
  it('merges scan + verify placeholders + advisories, deduped', () => {
    const o = collectOpenItems({
      bodyText: 'held at [place] on [date]',
      verifyPlaceholders: ['[place]'.replace(/[[\]]/g, ''), 'date'],
      advisories: ['Confirm the FIR number'],
      needsClarification: ['Confirm the FIR number', "Applicant's father's name?"],
      toVerify: ['BNS 316(2) — counsel to confirm'],
    });
    expect(o.placeholders).toEqual(['place', 'date']);
    expect(o.advisories).toEqual(['Confirm the FIR number', "Applicant's father's name?"]);
    expect(o.toVerify).toEqual(['BNS 316(2) — counsel to confirm']);
  });

  it('hasOpenItems reflects emptiness', () => {
    expect(hasOpenItems(collectOpenItems({}))).toBe(false);
    expect(hasOpenItems(collectOpenItems({ bodyText: 'x [name] y' }))).toBe(true);
    expect(hasOpenItems(null)).toBe(false);
  });
});

describe('emphasizeLegalTerms', () => {
  it('bolds statute/section citations', () => {
    expect(emphasizeLegalTerms('<p>under Section 138 of the Act</p>'))
      .toContain('<strong>Section 138</strong>');
    expect(emphasizeLegalTerms('<p>an offence u/s 420 IPC</p>'))
      .toMatch(/<strong>u\/s 420<\/strong>.*<strong>IPC<\/strong>/);
  });

  it('bolds money amounts (Rs./₹/INR and worded lakh/crore)', () => {
    expect(emphasizeLegalTerms('<p>pay Rs. 3,99,088 within</p>'))
      .toContain('<strong>Rs. 3,99,088</strong>');
    expect(emphasizeLegalTerms('<p>₹1,20,000 deposit</p>'))
      .toContain('<strong>₹1,20,000</strong>');
    expect(emphasizeLegalTerms('<p>sold for 25 lakh only</p>'))
      .toContain('<strong>25 lakh</strong>');
  });

  it('bolds notice cue phrases', () => {
    const out = emphasizeLegalTerms('<p>You are hereby called upon to pay within 15 days, failing which…</p>');
    expect(out).toContain('<strong>hereby</strong>');
    expect(out).toContain('<strong>called upon</strong>');
    expect(out).toContain('<strong>within 15 days</strong>');
    expect(out).toContain('<strong>failing which</strong>');
  });

  it('never rewrites tags or attributes', () => {
    const out = emphasizeLegalTerms('<p class="x" data-n="Section 1">body</p>');
    // The attribute value must be untouched — only text between tags is eligible.
    expect(out).toContain('data-n="Section 1"');
  });

  it('does not double-wrap already-bold text', () => {
    const out = emphasizeLegalTerms('<p>pay <strong>Rs. 500</strong> now</p>');
    expect(out).toBe('<p>pay <strong>Rs. 500</strong> now</p>');
  });

  it('is a no-op on empty input', () => {
    expect(emphasizeLegalTerms('')).toBe('');
  });
});
