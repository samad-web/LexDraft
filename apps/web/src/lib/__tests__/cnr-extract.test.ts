import { describe, it, expect } from 'vitest';
import { cnrFromQrText, extractCnrs } from '../cnr-extract';

describe('cnrFromQrText', () => {
  it('reads a bare CNR, any case', () => {
    expect(cnrFromQrText('kler010001682023')).toBe('KLER010001682023');
  });
  it('finds the CNR inside a URL or sentence', () => {
    expect(cnrFromQrText('https://services.ecourts.gov.in/?cino=TNCG0B0011172024&x=1')).toBe('TNCG0B0011172024');
    expect(cnrFromQrText('CNR: KLER010001682023 Next date 12-11-2026')).toBe('KLER010001682023');
  });
  it('returns null when there is no CNR', () => {
    expect(cnrFromQrText('hello world')).toBeNull();
    expect(cnrFromQrText('1234567890123456')).toBeNull();
  });
});

describe('extractCnrs', () => {
  it('pulls every distinct CNR from an app backup / CSV', () => {
    const text = '[{"cino":"KLER010001682023","pet":"A"},{"cino":"tncg0b0011172024"}]\nKLER010001682023,again';
    expect(extractCnrs(text)).toEqual(['KLER010001682023', 'TNCG0B0011172024']);
  });
  it('ignores 16-char runs inside longer tokens', () => {
    expect(extractCnrs('XKLER010001682023 KLER0100016820239')).toEqual([]);
  });
  it('handles a plain list', () => {
    expect(extractCnrs('KLER010001682023\r\nMHPU010012342021\n')).toEqual(['KLER010001682023', 'MHPU010012342021']);
  });
});
