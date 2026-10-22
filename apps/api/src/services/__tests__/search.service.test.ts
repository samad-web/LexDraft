import { describe, expect, it } from 'vitest';
import { searchService, __testing } from '../search.service';

describe('searchService', () => {
  it('returns nothing without a user or with a too-short query', async () => {
    const none = { cases: [], clients: [], leads: [], drafts: [], documents: [] };
    expect(await searchService.search(undefined, 'thoorigai')).toMatchObject(none);
    expect(await searchService.search('00000000-0000-0000-0000-000000000000', 'a')).toMatchObject(none);
  });

  it('escapes LIKE wildcards so they match literally', () => {
    expect(__testing.likePattern('50%')).toBe('%50\\%%');
    expect(__testing.likePattern('a_b')).toBe('%a\\_b%');
    expect(__testing.likePattern('c\\d')).toBe('%c\\\\d%');
  });
});
