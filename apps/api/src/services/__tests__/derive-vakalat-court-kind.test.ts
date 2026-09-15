import { describe, expect, it } from 'vitest';
import { deriveVakalatCourtKind, stripInjectedContext } from '../intake.service';

// The vakalatnama court FORMAT (criminal / civil / small_causes) is decided ONLY
// by what the advocate types in the draft chat — the CASE never decides it (the
// same case can need a civil or a criminal vakalat). The advocate names the
// format each time; if they name none, we return undefined (the caller asks).
describe('deriveVakalatCourtKind (chat words only)', () => {
  it('civil when the chat says civil', () => {
    expect(deriveVakalatCourtKind('draft a civil vakalat')).toBe('civil');
    expect(deriveVakalatCourtKind('civil vakalatnama please')).toBe('civil');
  });

  it('criminal when the chat says criminal', () => {
    expect(deriveVakalatCourtKind('draft a criminal vakalat')).toBe('criminal');
  });

  it('small_causes when the chat says small causes', () => {
    expect(deriveVakalatCourtKind('a small causes vakalat')).toBe('small_causes');
    expect(deriveVakalatCourtKind('small cause vakalat')).toBe('small_causes');
  });

  it('undefined when the chat names no format (caller will ask)', () => {
    expect(deriveVakalatCourtKind('draft a vakalat')).toBeUndefined();
    expect(deriveVakalatCourtKind('')).toBeUndefined();
  });

  it('small_causes wins over civil/criminal when both words appear', () => {
    expect(deriveVakalatCourtKind('small causes civil vakalat')).toBe('small_causes');
  });
});

// The case preamble/notes must be stripped BEFORE derivation so the case never
// leaks into the format decision.
describe('stripInjectedContext', () => {
  const preamble =
    '[Authoritative case record — use these particulars verbatim, do not invent]\n' +
    'Case: Matter for Ambeth (Thoorigai Prints)\n' +
    'Court: Magistrate First Class Court, Chennai\n' +
    'Matter type: Civil';

  it('removes the case preamble, keeping only the typed words', () => {
    const msg = `${preamble}\n\ndraft a criminal vakalat`;
    expect(stripInjectedContext(msg)).toBe('draft a criminal vakalat');
  });

  it('removes a matter-notes dump too', () => {
    const msg =
      'draft a civil vakalat\n\n[Matter notes on record]\nDocument "Affidavit": s.138 NI Act ...';
    expect(stripInjectedContext(msg)).toBe('draft a civil vakalat');
  });

  it('leaves a plain typed message untouched', () => {
    expect(stripInjectedContext('draft a vakalat')).toBe('draft a vakalat');
  });

  it('END TO END: a Civil-tagged case + "criminal vakalat" typed -> criminal', () => {
    // The case says Civil, but the advocate TYPED criminal — the typed word wins,
    // the case is ignored. (This is the behaviour the user asked for.)
    const msg = `${preamble}\n\ndraft a criminal vakalat`;
    expect(deriveVakalatCourtKind(stripInjectedContext(msg))).toBe('criminal');
  });

  it('END TO END: a Civil-tagged case + "civil vakalat" typed -> civil', () => {
    const msg = `${preamble}\n\ndraft a civil vakalat`;
    expect(deriveVakalatCourtKind(stripInjectedContext(msg))).toBe('civil');
  });

  it('END TO END: a Civil-tagged case + no format word -> undefined (case ignored)', () => {
    // The case is Civil, but with no typed format word we do NOT fall back to the
    // case — we return undefined so the caller asks the advocate.
    const msg = `${preamble}\n\ndraft a vakalat`;
    expect(deriveVakalatCourtKind(stripInjectedContext(msg))).toBeUndefined();
  });
});
