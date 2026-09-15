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

  it('the case Matter type tag decides, over content inference (the reported bug)', () => {
    const preamble =
      '[Authoritative case record]\nCase: Matter for Ambeth (Thoorigai Prints)\n' +
      'Court: City Civil Court\nMatter type: Civil\n\ndraft a vakalat';
    expect(deriveVakalatCourtKind(preamble)).toBe('civil');
  });

  it('derives CRIMINAL from a case tagged Matter type: Criminal', () => {
    const preamble =
      'Case: complaint under Section 138 NI Act\nCourt: Judicial Magistrate First Class\n' +
      'Matter type: Criminal\n\ndraft a vakalat';
    expect(deriveVakalatCourtKind(preamble)).toBe('criminal');
  });

  it('a Civil-tagged CHEQUE case renders civil (a cheque matter can be a money suit)', () => {
    // The exact conflict from the bug: a s.138 / Magistrate CONTENT but the
    // advocate classified the case as Civil (pursuing the civil money-suit route).
    // The tag must win over the s.138/Magistrate content.
    const t =
      'Case: cheque bounce, Section 138 NI Act\nCourt: Magistrate First Class Court, Chennai\n' +
      'Matter type: Civil\n\ndraft a vakalat';
    expect(deriveVakalatCourtKind(t)).toBe('civil');
  });

  it('an explicit "civil vakalat" wins even over a Criminal tag', () => {
    const t = 'Matter type: Criminal\nSection 138 NI Act matter\n\ndraft a civil vakalat';
    expect(deriveVakalatCourtKind(t)).toBe('civil');
  });

  it('does NOT infer criminal from s.138 / Magistrate content alone (forum-ambiguous)', () => {
    // No Matter type tag, no explicit word: a bare s.138/Magistrate mention must
    // NOT force criminal — it could be filed civilly. Leave it to the engine
    // GENERIC default rather than guessing the forum.
    const t = 'Section 138 NI Act, cheque dishonoured\nCourt: Judicial Magistrate\n\ndraft a vakalat';
    expect(deriveVakalatCourtKind(t)).toBeUndefined();
  });

  it('infers SMALL_CAUSES from a Court of Small Causes matter (no tag)', () => {
    expect(deriveVakalatCourtKind('Court: Court of Small Causes at Madras\ndraft a vakalat')).toBe(
      'small_causes',
    );
  });

  it('infers CIVIL from a civil court named in the text (no tag)', () => {
    expect(deriveVakalatCourtKind('Court: City Civil Court, Chennai\ndraft a vakalat')).toBe('civil');
  });

  it('returns undefined when nothing classifies it (engine keeps GENERIC)', () => {
    expect(deriveVakalatCourtKind('draft a vakalat')).toBeUndefined();
    expect(deriveVakalatCourtKind('')).toBeUndefined();
  });
});
