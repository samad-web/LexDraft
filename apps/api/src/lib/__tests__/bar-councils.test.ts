import { describe, expect, it } from 'vitest';
import { BAR_COUNCILS, namesMatch, parseEnrolment, sameEnrolment } from '../bar-councils';
import { decide, findAdvocateRecords } from '../../services/bar-verification.service';

describe('enrolment numbers', () => {
  it('parses the usual spellings', () => {
    expect(parseEnrolment('MS/1234/2019')).toEqual({ prefix: 'MS', num: 1234, year: 2019 });
    expect(parseEnrolment('ms 1234/2019')).toEqual({ prefix: 'MS', num: 1234, year: 2019 });
    expect(parseEnrolment('MS-01234-2019')).toEqual({ prefix: 'MS', num: 1234, year: 2019 });
    expect(parseEnrolment('1234/2019')).toEqual({ prefix: '', num: 1234, year: 2019 });
    expect(parseEnrolment('U.K. 359/2026')).toEqual({ prefix: 'UK', num: 359, year: 2026 });
    expect(parseEnrolment('not a number')).toBeNull();
  });
  it('same number and year match; a different state prefix does not', () => {
    expect(sameEnrolment('MS/1234/2019', 'ms 01234 / 2019')).toBe(true);
    expect(sameEnrolment('1234/2019', 'MS/1234/2019')).toBe(true);
    expect(sameEnrolment('MS/1234/2019', 'MS/1234/2018')).toBe(false);
    expect(sameEnrolment('MS/1234/2019', 'MS/1235/2019')).toBe(false);
    expect(sameEnrolment('MS/1234/2019', 'KAR/1234/2019')).toBe(false);
  });
});

describe('name matching', () => {
  it('accepts initials in any position, titles and run-together names', () => {
    expect(namesMatch('R. Senthil Kumar', 'Senthil Kumar R')).toBe(true);
    expect(namesMatch('SENTHILKUMAR R', 'Senthil Kumar')).toBe(true);
    expect(namesMatch('Adv. Priya Nair', 'PRIYA NAIR')).toBe(true);
    expect(namesMatch('Priya', 'Priya Lakshmi Nair')).toBe(true);
  });
  it('rejects a different person', () => {
    expect(namesMatch('Priya Nair', 'Senthil Kumar')).toBe(false);
    expect(namesMatch('R. S.', 'Senthil Kumar')).toBe(false);
    expect(namesMatch('', 'Senthil Kumar')).toBe(false);
  });
});

describe('Tamil Nadu council response', () => {
  const rec = { bcteno: 'MS/1234/2019', fullName: 'SENTHIL KUMAR R', bcteDate: '12-08-2019', status: 1, fatherName: 'RAJAN' };
  it('finds records in a list or a { record } detail payload', () => {
    expect(findAdvocateRecords([rec])).toHaveLength(1);
    expect(findAdvocateRecords({ record: rec })[0]).toMatchObject({ name: 'SENTHIL KUMAR R', enrolmentNo: 'MS/1234/2019', enrolmentDate: '12-08-2019', status: '1' });
    expect(findAdvocateRecords({ list: [], total: 0 })).toEqual([]);
  });
  it('verifies only when number and name both match', () => {
    const records = findAdvocateRecords([rec]);
    expect(decide(records, 'MS/1234/2019', 'Senthil Kumar').status).toBe('verified');
    expect(decide(records, 'MS/1234/2019', 'Priya Nair').status).toBe('name_mismatch');
    expect(decide(records, 'MS/9999/2019', 'Senthil Kumar').status).toBe('not_found');
    expect(decide([], 'MS/1234/2019', 'Senthil Kumar').status).toBe('not_found');
  });
  it('a row without a name proves nothing', () => {
    expect(decide(findAdvocateRecords([{ bcteno: 'MS/1234/2019' }]), 'MS/1234/2019', 'Senthil Kumar').status).toBe('not_found');
  });
});

describe('council list', () => {
  it('Tamil Nadu is the OTP council; Telangana is skipped; ids are unique', () => {
    expect(BAR_COUNCILS.find((c) => c.id === 'tn')?.mode).toBe('otp');
    expect(BAR_COUNCILS.find((c) => c.id === 'telangana')?.mode).toBe('none');
    expect(new Set(BAR_COUNCILS.map((c) => c.id)).size).toBe(BAR_COUNCILS.length);
  });
});
