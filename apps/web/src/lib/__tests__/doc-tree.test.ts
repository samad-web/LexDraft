import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@lexdraft/types';
import { makerLine, nestDocuments } from '../doc-tree';

// team-docs AC1-AC2: copies sit right under their original with the maker's name.
const D = (id: string, over: Partial<DocumentRecord> = {}): DocumentRecord =>
  ({ id, name: id, type: 'Petition', case: 'Ravi v. State', updated: '', kind: 'document', ...over });

describe('nestDocuments', () => {
  it('puts copies under their original, oldest first, and keeps others in order', () => {
    const rows = nestDocuments([
      D('notice'),
      D('copy2', { parentDocumentId: 'petition', createdAt: '2026-11-25T10:00:00Z' }),
      D('petition'),
      D('copy1', { parentDocumentId: 'petition', createdAt: '2026-11-25T09:00:00Z' }),
      D('copy-of-copy', { parentDocumentId: 'copy1', createdAt: '2026-11-25T11:00:00Z' }),
    ]);
    expect(rows.map((r) => `${r.doc.id}:${r.depth}`)).toEqual(['notice:0', 'petition:0', 'copy1:1', 'copy-of-copy:2', 'copy2:1']);
  });
  it('a marked copy of a draft sits under the draft', () => {
    const rows = nestDocuments([D('d1', { kind: 'draft' }), D('m1', { parentDraftId: 'd1' })]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1]);
  });
  it('a copy whose original is not in the list stays at the top; a parent loop never hangs', () => {
    expect(nestDocuments([D('c', { parentDocumentId: 'elsewhere' })])[0]!.depth).toBe(0);
    const loop = nestDocuments([D('a', { parentDocumentId: 'b' }), D('b', { parentDocumentId: 'a' })]);
    expect(loop).toHaveLength(2);
  });
});

describe('makerLine', () => {
  it('names who made it', () => {
    expect(makerLine(D('x', { name: 'Petition (marked copy, 25 Nov 2026, 1:05 pm)', createdByName: 'Priya' }), true)).toBe('Marked copy · by Priya');
    expect(makerLine(D('x', { createdByName: 'Anand' }), false)).toBe('by Anand');
    expect(makerLine(D('x', { name: 'Petition (edited)' }), true)).toBe('Copy');
    expect(makerLine(D('x'), false)).toBe('');
  });
});
