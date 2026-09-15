import { describe, expect, it } from 'vitest';
import { deriveVakalatCourtKind } from '../intake.service';

// The vakalatnama court FORMAT (criminal / civil / small_causes) must be decided
// from the drafting text so "draft a vakalat" renders the RIGHT court's form for
// the case — without this the engine falls back to GENERIC, which reads as the
// criminal layout, so a Civil case's vakalat came out criminal.
describe('deriveVakalatCourtKind', () => {
  it('honours an explicit "civil vakalat" over everything else', () => {
    expect(deriveVakalatCourtKind('please draft a civil vakalat')).toBe('civil');
    expect(deriveVakalatCourtKind('vakalat for the civil suit')).toBe('civil');
  });

  it('honours an explicit "criminal vakalat"', () => {
    expect(deriveVakalatCourtKind('draft a criminal vakalat')).toBe('criminal');
  });

  it('honours an explicit "small causes vakalat"', () => {
    expect(deriveVakalatCourtKind('a small causes vakalat please')).toBe('small_causes');
    expect(deriveVakalatCourtKind('vakalat for the Small Causes court')).toBe('small_causes');
  });

  it('derives CIVIL from the case preamble matter type (the reported bug)', () => {
    const preamble =
      '[Authoritative case record]\nCase: Matter for Ambeth (Thoorigai Prints)\n' +
      'Court: City Civil Court\nMatter type: Civil\n\ndraft a vakalat';
    expect(deriveVakalatCourtKind(preamble)).toBe('civil');
  });

  it('derives CRIMINAL from a s.138 / Magistrate case', () => {
    const preamble =
      'Case: complaint under Section 138 NI Act\nCourt: Judicial Magistrate First Class\n' +
      'Matter type: Criminal\n\ndraft a vakalat';
    expect(deriveVakalatCourtKind(preamble)).toBe('criminal');
  });

  it('an explicit "civil vakalat" still wins even in a s.138 case context', () => {
    const t = 'Court: Judicial Magistrate\nSection 138 NI Act matter\n\ndraft a civil vakalat';
    expect(deriveVakalatCourtKind(t)).toBe('civil');
  });

  it('derives SMALL_CAUSES from a Court of Small Causes matter', () => {
    expect(deriveVakalatCourtKind('Court: Court of Small Causes at Madras\ndraft a vakalat')).toBe(
      'small_causes',
    );
  });

  it('returns undefined when nothing indicates a format (engine keeps GENERIC)', () => {
    expect(deriveVakalatCourtKind('draft a vakalat')).toBeUndefined();
    expect(deriveVakalatCourtKind('')).toBeUndefined();
  });
});
