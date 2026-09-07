import { describe, expect, it } from 'vitest';
import { lookupOldProvision, findOldProvisions } from '../old-to-new-law';

describe('old-to-new-law', () => {
  describe('lookupOldProvision', () => {
    it('maps the core bail/procedure provisions CrPC -> BNSS', () => {
      expect(lookupOldProvision('Section 439 CrPC')?.new).toBe('Section 483 BNSS');
      expect(lookupOldProvision('Section 438 CrPC')?.new).toBe('Section 482 BNSS');
      expect(lookupOldProvision('Section 437 CrPC')?.new).toBe('Section 480 BNSS');
      expect(lookupOldProvision('Section 482 CrPC')?.new).toBe('Section 528 BNSS');
    });

    it('maps the high-frequency penal provisions IPC -> BNS', () => {
      expect(lookupOldProvision('Section 302 IPC')?.new).toBe('Section 103 BNS');
      expect(lookupOldProvision('Section 420 IPC')?.new).toBe('Section 318 BNS');
      expect(lookupOldProvision('Section 406 IPC')?.new).toBe('Section 316 BNS');
      expect(lookupOldProvision('Section 498A IPC')?.new).toBe('Section 85 BNS');
    });

    it('maps evidence provisions Evidence Act -> BSA', () => {
      expect(lookupOldProvision('Section 65B Evidence Act')?.new).toBe('Section 63 BSA');
    });

    // The whole point of the normaliser: the same legacy provision written the
    // many ways an advocate might type it must all resolve to one mapping.
    it.each([
      'Section 439 CrPC',
      'section 439 crpc',
      'u/s 439 CrPC',
      '439 CrPC',
      'Section 439 Cr.P.C.',
      'Section 439 Cr. P. C.',
      '§ 439 CrPC',
      'Section 439 Code of Criminal Procedure',
    ])('resolves the variant "%s" to Section 483 BNSS', (variant) => {
      expect(lookupOldProvision(variant)?.new).toBe('Section 483 BNSS');
    });

    it.each([
      '420 IPC',
      'u/s 420 IPC',
      'Section 420 Indian Penal Code',
      '§420 ipc',
    ])('resolves the cheating variant "%s" to Section 318 BNS', (variant) => {
      expect(lookupOldProvision(variant)?.new).toBe('Section 318 BNS');
    });

    it('returns null when there is no clean mapping (no guessing)', () => {
      expect(lookupOldProvision('Section 999 CrPC')).toBeNull();
      expect(lookupOldProvision('Section 138 NI Act')).toBeNull(); // NI Act unchanged
      expect(lookupOldProvision('Section 483 BNSS')).toBeNull(); // already new
      expect(lookupOldProvision('not a provision at all')).toBeNull();
    });

    it('tags the code family on each mapping', () => {
      expect(lookupOldProvision('Section 439 CrPC')?.code).toBe('BNSS');
      expect(lookupOldProvision('Section 302 IPC')?.code).toBe('BNS');
      expect(lookupOldProvision('Section 65B Evidence Act')?.code).toBe('BSA');
    });
  });

  describe('findOldProvisions', () => {
    it('scans free-text briefs and returns the mappings found', () => {
      const brief =
        'Client arrested under Section 420 IPC and 406 IPC; seeking bail u/s 439 CrPC.';
      const found = findOldProvisions(brief);
      const news = found.map((m) => m.new);
      expect(news).toContain('Section 318 BNS');
      expect(news).toContain('Section 316 BNS');
      expect(news).toContain('Section 483 BNSS');
    });

    it('deduplicates repeated references, preserving first-seen order', () => {
      const brief = 'Charge u/s 302 IPC. The 302 IPC charge is disputed. Also 302 IPC again.';
      const found = findOldProvisions(brief);
      expect(found).toHaveLength(1);
      expect(found[0]?.new).toBe('Section 103 BNS');
    });

    it('returns an empty array when the brief cites only current codes', () => {
      const brief = 'Bail sought under Section 483 BNSS for an offence u/s 318 BNS.';
      expect(findOldProvisions(brief)).toEqual([]);
    });

    it('returns an empty array for a brief with no provisions at all', () => {
      expect(findOldProvisions('The client wants to draft a rent agreement.')).toEqual([]);
    });
  });
});
