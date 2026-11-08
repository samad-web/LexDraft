import { describe, expect, it } from 'vitest';
import { blankSentence } from '../intake-doc-config';

describe('blankSentence — an attached format\'s blank seen in its sentence', () => {
  const blocks = [{ text: 'To, {{ addressee }}' }, { text: 'I call upon you to {{demand}} within 15 days.' }, {}];
  it('finds the sentence, with or without spaces in the braces', () => {
    expect(blankSentence(blocks, 'demand')).toBe('I call upon you to {{demand}} within 15 days.');
    expect(blankSentence(blocks, 'addressee')).toBe('To, {{ addressee }}');
  });
  it('is undefined for a field no block uses', () => {
    expect(blankSentence(blocks, 'other')).toBeUndefined();
  });
  it('does not match a longer key', () => {
    expect(blankSentence([{ text: '{{ demand_two }}' }], 'demand')).toBeUndefined();
  });
  it('keeps a long paragraph to the text around the blank', () => {
    const long = `${'x'.repeat(500)} {{ k }} ${'y'.repeat(500)}`;
    expect(blankSentence([{ text: long }], 'k')!.length).toBeLessThan(200);
  });
});
