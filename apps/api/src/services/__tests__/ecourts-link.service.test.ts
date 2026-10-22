import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', () => ({ db: () => null }));

import { classifySyncError, extractCnrCandidates, normaliseCnr } from '../ecourts-link.service';
import { EcourtsRecordNotFoundError } from '../case-sync.service';
import { EcourtsHttpError, EcourtsSessionError } from '../../lib/ecourts';
import { BadRequestError, NotFoundError } from '../../lib/errors';

describe('normaliseCnr', () => {
  it('upper-cases and trims a valid CNR', () => {
    expect(normaliseCnr('  klER010001682023 ')).toBe('KLER010001682023');
  });

  it('accepts an alphanumeric establishment code', () => {
    expect(normaliseCnr('TNCG0B0011172024')).toBe('TNCG0B0011172024');
  });

  it('rejects TEMP placeholders and blanks', () => {
    expect(normaliseCnr('TEMP-20261019-1234')).toBeNull();
    expect(normaliseCnr('')).toBeNull();
    expect(normaliseCnr(null)).toBeNull();
  });
});

describe('classifySyncError', () => {
  it('treats eCourts transport failures as upstream (retryable)', () => {
    expect(classifySyncError(new EcourtsHttpError(504, 'timeout'))).toBe('upstream');
    expect(classifySyncError(new EcourtsHttpError(502, 'maintenance page'))).toBe('upstream');
    expect(classifySyncError(new EcourtsSessionError('no token'))).toBe('upstream');
    expect(classifySyncError(new SyntaxError('Unexpected token'))).toBe('upstream');
  });

  it('treats a missing record as not_found, not upstream', () => {
    expect(classifySyncError(new EcourtsRecordNotFoundError('KLER010001682023'))).toBe('not_found');
  });

  it('treats our own HTTP errors as case problems (not retryable)', () => {
    expect(classifySyncError(new BadRequestError('no CNR'))).toBe('case');
    expect(classifySyncError(new NotFoundError('Case not found'))).toBe('case');
  });
});

describe('parsePackedRefList', () => {
  it('splits the packed code~name#code~name string eCourts returns', async () => {
    const { parsePackedRefList } = await import('../ecourts.service');
    const payload = { case_types: [{ case_type: '59~AS - CIVIL APPEAL#71~AS(Election) - CIVIL APPEAL (ELECTION)#' }] };
    expect(parsePackedRefList(payload, 'case_types')).toEqual([
      { code: '59', name: 'AS - CIVIL APPEAL' },
      { code: '71', name: 'AS(Election) - CIVIL APPEAL (ELECTION)' },
    ]);
  });

  it('skips malformed entries and dedupes codes', async () => {
    const { parsePackedRefList } = await import('../ecourts.service');
    const payload = { actsList: [{ acts: '2~Abkari act#junk#~noCode#2~Abkari act' }] };
    expect(parsePackedRefList(payload, 'actsList')).toEqual([{ code: '2', name: 'Abkari act' }]);
  });

  it('throws on an error envelope instead of returning an empty list', async () => {
    const { parsePackedRefList } = await import('../ecourts.service');
    expect(() => parsePackedRefList({ status: 'N', msg: 'error_ERROR_courtcode4' }, 'case_types')).toThrow();
  });
});

describe('extractCnrCandidates', () => {
  it('reads cases out of the establishment-keyed search response', () => {
    const payload = {
      0: {
        establishment_name: 'Principal District Court',
        caseNos: [
          { cino: 'kler010001682023', pet_name: 'Ajayakumar', res_name: 'State', case_no: 'OS/12/2023' },
        ],
      },
      no_of_establishments: 1,
      token: 'jwt',
    };
    expect(extractCnrCandidates(payload)).toEqual([
      { cino: 'KLER010001682023', title: 'Ajayakumar v. State', establishment: 'Principal District Court', caseNo: 'OS/12/2023' },
    ]);
  });

  it('dedupes a case listed under two establishments and skips invalid rows', () => {
    const payload = {
      0: { establishment_name: 'A', caseNos: [{ cino: 'KLER010001682023' }, { cino: 'bad' }] },
      1: { establishment_name: 'B', caseNos: [{ cino: 'KLER010001682023' }] },
    };
    const out = extractCnrCandidates(payload);
    expect(out).toHaveLength(1);
    expect(out[0]!.cino).toBe('KLER010001682023');
  });

  it('returns nothing for the zero-establishments quirk or junk', () => {
    expect(extractCnrCandidates({ no_of_establishments: 0 })).toEqual([]);
    expect(extractCnrCandidates(null)).toEqual([]);
    expect(extractCnrCandidates([1, 2])).toEqual([]);
  });
});
