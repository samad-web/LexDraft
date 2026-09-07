import { describe, expect, it } from 'vitest';
import {
  categoryForDocType,
  renderFormatBlock,
  resolveFormat,
} from '../draft-format-catalog';

describe('draft-format-catalog', () => {
  describe('categoryForDocType', () => {
    it.each([
      ['Notice u/s 138 NI Act', 'notice'],
      ['Legal Notice', 'notice'],
      ['Plaint', 'pleading'],
      ['Written Statement', 'pleading'],
      ['Appeal', 'pleading'],
      ['Bail Application', 'application'],
      ['Execution Petition', 'pleading'],
      ['RTI Application', 'application'],
      ['Caveat', 'application'],
      ['Affidavit', 'affidavit'],
      ['Evidence Affidavit', 'affidavit'],
      ['Gift Deed', 'deed'],
      ['Will', 'deed'],
      ['Power of Attorney (General)', 'deed'],
      ['Indemnity Bond', 'deed'],
      ['Loan Agreement', 'agreement'],
      ['Non-Disclosure Agreement (NDA)', 'agreement'],
      ['Memorandum of Understanding (MoU)', 'agreement'],
      ['Term Sheet', 'agreement'],
      ['Engagement Letter', 'correspondence'],
      ['Correspondence', 'correspondence'],
    ] as const)('classifies %s as %s', (docType, expected) => {
      expect(categoryForDocType(docType)).toBe(expected);
    });

    it('falls back to generic for an unrecognised doc type', () => {
      expect(categoryForDocType('Some Bespoke Instrument')).toBe('generic');
    });
  });

  describe('resolveFormat', () => {
    it('prefers a specific override over the category format', () => {
      const fmt = resolveFormat('Notice u/s 138 NI Act');
      expect(fmt.label).toMatch(/Section 138/);
      // The §138 override carries the six statutory limbs, not the generic
      // three-item notice list.
      expect(fmt.statutoryIngredients.length).toBeGreaterThanOrEqual(5);
      expect(fmt.statutoryIngredients.join(' ')).toMatch(/15-day|15 day/i);
    });

    it('uses the category format when no override exists', () => {
      // Consultancy Agreement has no specific override -> falls to the category.
      const fmt = resolveFormat('Consultancy Agreement');
      expect(fmt.label).toBe('Commercial agreement');
      expect(fmt.requiredSections.join(' ')).toMatch(/governing law|dispute resolution/i);
    });

    it('gives the high-value long-tail types their own specific ingredients', () => {
      // Each of these was promoted from category-level to a bespoke format so the
      // review stage can audit the type-specific operative clauses.
      const loan = resolveFormat('Loan Agreement');
      expect(loan.label).toBe('Loan agreement');
      expect(loan.statutoryIngredients.join(' ')).toMatch(/default/i);

      const nda = resolveFormat('Non-Disclosure Agreement (NDA)');
      expect(nda.label).toBe('Non-disclosure agreement');
      expect(nda.statutoryIngredients.join(' ')).toMatch(/confidential information/i);

      const lease = resolveFormat('Lease / Rent / Tenancy Agreement');
      expect(lease.statutoryIngredients.join(' ')).toMatch(/rent/i);

      const employment = resolveFormat('Employment Contract');
      expect(employment.conventions.join(' ')).toMatch(/non-compete|restraint/i);

      const sale = resolveFormat('Sale Agreement / Sale Deed');
      expect(sale.statutoryIngredients.join(' ')).toMatch(/conveyance|title/i);

      const mortgage = resolveFormat('Mortgage Deed');
      expect(mortgage.statutoryIngredients.join(' ')).toMatch(/redemption/i);

      const gift = resolveFormat('Gift Deed');
      expect(gift.statutoryIngredients.join(' ')).toMatch(/without consideration/i);
    });

    it('always returns a non-empty required structure', () => {
      for (const docType of ['Will', 'Plaint', 'Affidavit', 'Nonsense Doc', 'Trust Deed']) {
        const fmt = resolveFormat(docType);
        expect(fmt.requiredSections.length).toBeGreaterThan(0);
        expect(fmt.conventions.length).toBeGreaterThan(0);
      }
    });

    it('gives the bail application its BNSS-aware ingredients', () => {
      const fmt = resolveFormat('Bail Application');
      expect(fmt.statutoryIngredients.join(' ')).toMatch(/BNSS/);
    });
  });

  describe('renderFormatBlock', () => {
    it('renders sections, ingredients, and conventions as a prompt block', () => {
      const block = renderFormatBlock('Plaint');
      expect(block).toMatch(/Required structure/);
      expect(block).toMatch(/Statutory ingredients/);
      expect(block).toMatch(/Drafting conventions/);
      // Numbered sections.
      expect(block).toMatch(/^ {2}1\. /m);
    });

    it('states "(none ...)" for documents with no cause of action', () => {
      const block = renderFormatBlock('Engagement Letter');
      expect(block).toMatch(/\(none/);
    });
  });
});
