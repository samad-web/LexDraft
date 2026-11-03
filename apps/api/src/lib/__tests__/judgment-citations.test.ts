import { describe, expect, it } from 'vitest';
import { citationKey, judgmentCitationsIn, particularsOf } from '../draft-guards';

describe('judgmentCitationsIn', () => {
  it('finds the existing SCC / SCC OnLine / AIR forms', () => {
    expect(judgmentCitationsIn('See (2021) 4 SCC 412, 2023 SCC OnLine Mad 1187 and AIR 1978 SC 597.'))
      .toEqual(['(2021) 4 SCC 412', '2023 SCC OnLine Mad 1187', 'AIR 1978 SC 597']);
  });

  it('finds SC and HC neutral citations', () => {
    expect(judgmentCitationsIn('Relied on 2024 INSC 123 and 2023:MHC:1234; also 2024:AHC-LKO:5678.'))
      .toEqual(['2024 INSC 123', '2023:MHC:1234', '2024:AHC-LKO:5678']);
  });

  it('finds bracketed-year reporters, SCR and year-first forms', () => {
    expect(judgmentCitationsIn('As held in (2019) 5 MLJ 100 and (2019) 2 MLJ (Crl) 100, [2024] 10 S.C.R. 108, 2011 [5] SCC 244 and 2004 (3) CTC 100.'))
      .toEqual(['(2019) 5 MLJ 100', '(2019) 2 MLJ (Crl) 100', '[2024] 10 S.C.R. 108', '2011 [5] SCC 244', '2004 (3) CTC 100']);
  });

  it('dedupes by key and ignores dates, sections and amounts', () => {
    expect(judgmentCitationsIn('(2019) 5 MLJ 100 ... (2019)5 M.L.J. 100')).toEqual(['(2019) 5 MLJ 100']);
    expect(judgmentCitationsIn('On 12.03.2026 under Section 138 (2) for Rs. 5,00,000 within 15 days in 2024.')).toEqual([]);
  });

  it('citationKey ignores spacing and dots', () => {
    expect(citationKey('(2019) 5 M.L.J. 100')).toBe(citationKey('(2019)5 MLJ 100'));
  });

  it('leaves particularsOf unchanged', () => {
    // judgmentCitationsIn is additive: the existing citation particular still
    // only covers the SCC / AIR forms.
    expect(particularsOf('2024 INSC 123 and (2021) 4 SCC 412').filter((p) => p.kind === 'citation').map((p) => p.raw))
      .toEqual(['(2021) 4 SCC 412']);
  });
});
