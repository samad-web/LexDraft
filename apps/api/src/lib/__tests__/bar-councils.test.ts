import { describe, expect, it } from 'vitest';
import { BAR_COUNCILS, isInactiveStatus, namesMatch, parseEnrolment, sameEnrolment } from '../bar-councils';
import { LIVE_LOOKUPS, parseAndhra, parseGujarat, parseKarnataka, parseRajasthanBatch, parseRajasthanDates, parseUttarakhand } from '../bar-council-lookups';
import { parseJkCisPage, parsePunjabHaryanaPage, ROLL_SOURCES } from '../bar-roll-import';
import { decide, findAdvocateRecords } from '../../services/bar-verification.service';

describe('enrolment numbers', () => {
  it('parses the usual spellings', () => {
    expect(parseEnrolment('MS/1234/2019')).toEqual({ prefix: 'MS', num: 1234, year: '2019' });
    expect(parseEnrolment('ms 1234/2019')).toEqual({ prefix: 'MS', num: 1234, year: '2019' });
    expect(parseEnrolment('MS-01234-2019')).toEqual({ prefix: 'MS', num: 1234, year: '2019' });
    expect(parseEnrolment('MS1234/2019')).toEqual({ prefix: 'MS', num: 1234, year: '2019' });
    expect(parseEnrolment('1234/2019')).toEqual({ prefix: '', num: 1234, year: '2019' });
    expect(parseEnrolment('U.K. 359/2026')).toEqual({ prefix: 'UK', num: 359, year: '2026' });
    expect(parseEnrolment('KAR/123/85')).toEqual({ prefix: 'KAR', num: 123, year: '85' });
    expect(parseEnrolment('K5/001234/2015')).toEqual({ prefix: 'K5', num: 1234, year: '2015' });
    expect(parseEnrolment('not a number')).toBeNull();
  });
  it('same number and year match; a different state prefix does not', () => {
    expect(sameEnrolment('MS/1234/2019', 'ms 01234 / 2019')).toBe(true);
    expect(sameEnrolment('1234/2019', 'MS/1234/2019')).toBe(true);
    expect(sameEnrolment('MS/1234/2019', 'MS/1234/2018')).toBe(false);
    expect(sameEnrolment('MS/1234/2019', 'MS/1235/2019')).toBe(false);
    expect(sameEnrolment('MS/1234/2019', 'KAR/1234/2019')).toBe(false);
  });
  it('two-digit years match the full year; unparseable numbers must match exactly', () => {
    expect(sameEnrolment('KAR/123/85', 'KAR/123/1985')).toBe(true);
    expect(sameEnrolment('KAR/123/85', 'KAR/123/1986')).toBe(false);
    expect(sameEnrolment('K5/001234/2015 ', 'K5/1234/2015')).toBe(true);
    expect(sameEnrolment('MYS/45-B/78', 'mys / 45-B / 78')).toBe(true);
    expect(sameEnrolment('MYS/45-B/78', 'MYS/45-C/78')).toBe(false);
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

describe('roll status', () => {
  it('marks not-practising statuses inactive, leaves active and unknown codes alone', () => {
    for (const s of ['Death', 'Died', 'Retired', 'Voluntary Suspended', 'Transfered', 'Non practice']) expect(isInactiveStatus(s)).toBe(true);
    for (const s of ['Present Member', 'Completed', '1', 'COPNP', undefined]) expect(isInactiveStatus(s)).toBe(false);
  });
  it('a retired advocate is inactive, not verified', () => {
    expect(decide([{ name: 'SENTHIL KUMAR R', enrolmentNo: 'KAR/123/85', status: 'Retired' }], 'KAR/123/1985', 'Senthil Kumar').status).toBe('inactive');
  });
});

// Fixtures copy each council's real response shape (checked 2026-11-11) with made-up people.
describe('live council parsers', () => {
  it('Karnataka JSON list; the "Please Check" string means none', () => {
    const rows = parseKarnataka(JSON.stringify([{ ID: 1, NAME: 'R. SENTHIL KUMAR', RollNo: 'KAR/123/85', DateOfEnroll: '01-02-1985', EnrollmentStatus: 'Present Member', MobileNo1: '9000000000' }]));
    expect(rows).toEqual([{ name: 'R. SENTHIL KUMAR', enrolmentNo: 'KAR/123/85', enrolmentDate: '01-02-1985', status: 'Present Member' }]);
    expect(parseKarnataka('Please Check EnrollNo OR Name OR Place Of Practice')).toEqual([]);
  });
  it('Gujarat { Data } and the empty IsSuccess:false reply', () => {
    expect(parseGujarat(JSON.stringify({ Data: [{ EnroNumber: 'G/1000/2010', FullName: 'PRIYA NAIR', PracticeVerificationStatus: 'Completed' }], IsSuccess: true })))
      .toEqual([{ name: 'PRIYA NAIR', enrolmentNo: 'G/1000/2010', status: 'Completed' }]);
    expect(parseGujarat(JSON.stringify({ Data: null, IsSuccess: false }))).toEqual([]);
  });
  it('Andhra Pradesh HTML table, address ignored; empty table is none', () => {
    const html = '<h2>Advocate Details</h2><table><tr><th>Enrollment no.</th><th>Name</th><th>Date</th><th>Address</th><th>Bar</th><th>Status</th></tr>'
      + '<tr><td>AP/12/2001</td><td>K. RAMA RAO</td><td>05-06-2001</td><td>Somewhere, Guntur</td><td>Guntur Bar</td><td>Non practice</td></tr></table>';
    expect(parseAndhra(html)).toEqual([{ name: 'K. RAMA RAO', enrolmentNo: 'AP/12/2001', enrolmentDate: '05-06-2001', status: 'Non practice' }]);
    expect(parseAndhra('<table><tr><th>Enrollment no.</th></tr><tr><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>')).toEqual([]);
  });
  it('Uttarakhand table, incl. a transferred advocate with two numbers', () => {
    const html = '<table><tr><th>S. No.</th><th>Enroll. No.</th><th>Name</th></tr>'
      + '<tr><td>1</td><td>U.K. 101/2026</td><td>Meena Rawat</td><td>X</td><td>Dehradun</td></tr>'
      + '<tr><td>2</td><td>R 1234/2015 Dt. 12.10.2015 U.K. 102/2026</td><td>Arun Negi</td><td>Y</td><td>Haldwani</td></tr></table>';
    const rows = parseUttarakhand(html);
    expect(rows.map((r) => r.enrolmentNo)).toEqual(['UK/101/2026', 'R/1234/2015', 'UK/102/2026']);
    expect(decide(rows, 'U.K. 102/2026', 'Arun Negi').status).toBe('verified');
    expect(decide(rows, 'U.K.101/2026', 'Arun Negi').status).toBe('name_mismatch');
  });
  it("Rajasthan date list and batch rows (name carries the father's name)", () => {
    const dates = JSON.stringify({ d: ['Done', "<option data-id='01-11-2026 00:00:00'>01 Nov 2026</option><option data-id='24-10-2026 00:00:00'>24 Oct 2026</option>"] });
    expect(parseRajasthanDates(dates)).toEqual(['01-11-2026 00:00:00', '24-10-2026 00:00:00']);
    const rows = parseRajasthanBatch(JSON.stringify({ d: [{ __type: 'x', SNo: '1', EnrNo: 'R/5012/2026', EnrDt: '01 Nov 2026', Adv: 'SH. VIKRAM SINGH S/O SH. RAM SINGH' }] }));
    expect(decide(rows, 'R/5012/2026', 'Vikram Singh').status).toBe('verified');
    expect(parseRajasthanDates('not json')).toEqual([]);
  });
  it('every live council has a lookup, every roll council a source, and nothing else claims one', () => {
    expect(BAR_COUNCILS.filter((c) => c.mode === 'live').map((c) => c.id).sort()).toEqual(Object.keys(LIVE_LOOKUPS).sort());
    expect(BAR_COUNCILS.filter((c) => c.mode === 'roll').map((c) => c.id).sort()).toEqual(ROLL_SOURCES.map((r) => r.council).sort());
  });
});

// PDF pages as text items at the real column positions, made-up people.
describe('PDF roll parsers', () => {
  it('Punjab & Haryana: serial+number cell, name column, wrapped name, address dropped', () => {
    const items = [
      { x: 29, y: 947, str: 'Sr.No. StateRollNo' }, { x: 137, y: 947, str: 'AdvocateName' },
      { x: 48, y: 935, str: '1 PH/1234/2010' }, { x: 137, y: 935, str: 'GURPREET SINGH' }, { x: 256, y: 935, str: 'H NO 12 SECTOR 9' }, { x: 432, y: 935, str: 'DIST COURT LUDHIANA' },
      { x: 48, y: 922, str: '2 P/567/1998' }, { x: 137, y: 922, str: 'HARPREET KAUR' }, { x: 256, y: 922, str: '# 45 MODEL TOWN' },
      { x: 137, y: 910, str: 'SANDHU' }, { x: 256, y: 910, str: 'PATIALA' },
      { x: 43, y: 898, str: '10 PH/23456/2015' }, { x: 137, y: 898, str: 'RAJINDER' },
    ];
    expect(parsePunjabHaryanaPage(items)).toEqual([
      { enrolmentNo: 'PH/1234/2010', num: 1234, name: 'GURPREET SINGH' },
      { enrolmentNo: 'P/567/1998', num: 567, name: 'HARPREET KAUR SANDHU' },
      { enrolmentNo: 'PH/23456/2015', num: 23456, name: 'RAJINDER' },
    ]);
  });
  it('J&K High Court CIS list: JK + number + year items, name on a nearby baseline', () => {
    const items = [
      { x: 232, y: 521, str: 'YEAR :: 2015' },
      { x: 37, y: 510, str: '1' }, { x: 55, y: 510, str: 'V.L.NO 123 & 1.1.1985' }, { x: 330, y: 510, str: 'Mr. Bashir Ahmad Dar' }, { x: 469, y: 510, str: 'Father Name' }, { x: 620, y: 510, str: 'Srinagar' },
      { x: 232, y: 508, str: 'JK' }, { x: 275, y: 508, str: '7' }, { x: 283, y: 508, str: '2015' },
      { x: 330, y: 488, str: 'Ms. Sana Mir' }, { x: 232, y: 487, str: 'JK' }, { x: 249, y: 487, str: '345' }, { x: 283, y: 487, str: '2016' },
    ];
    expect(parseJkCisPage(items)).toEqual([
      { enrolmentNo: 'JK/7/2015', num: 7, name: 'Mr. Bashir Ahmad Dar' },
      { enrolmentNo: 'JK/345/2016', num: 345, name: 'Ms. Sana Mir' },
    ]);
  });
});

describe('council list', () => {
  it('Tamil Nadu is the OTP council; Telangana is skipped; ids are unique', () => {
    expect(BAR_COUNCILS.find((c) => c.id === 'tn')?.mode).toBe('otp');
    expect(BAR_COUNCILS.find((c) => c.id === 'telangana')?.mode).toBe('none');
    expect(new Set(BAR_COUNCILS.map((c) => c.id)).size).toBe(BAR_COUNCILS.length);
  });
});
