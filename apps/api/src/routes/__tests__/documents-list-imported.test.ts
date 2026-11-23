import { describe, expect, it } from 'vitest';
import type { DocumentRecord, SavedDraft } from '@lexdraft/types';
import { listWithDrafts } from '../documents.routes';

// import-edit-document ac4: an imported document shows as exactly its original +
// its edited Word file (a real, shareable row); no extra file-less draft row.
const draft = (over: Partial<SavedDraft>): SavedDraft => ({
  id: 'd1', title: 'Ravi petition', docType: 'Petition', language: 'EN', tone: 'Professional', fields: {},
  editedHtml: '', bodyText: '', draftDate: null, matter: 'Ravi v. State', createdAt: '', updatedAt: new Date().toISOString(),
  ...over,
});
const doc = (id: string, name: string): DocumentRecord => ({ id, name, type: 'Petition', case: 'Ravi v. State', updated: '', kind: 'document', hasFile: true });

describe('Documents list with imported drafts', () => {
  it('lists the original and the edited file once each; Edit on the edited file opens the draft', () => {
    const items = listWithDrafts(
      [doc('orig', 'Ravi petition (original)'), doc('edited', 'Ravi petition')],
      [draft({ sourceDocumentId: 'orig', editedDocumentId: 'edited' })],
    );
    expect(items.map((i) => i.name)).toEqual(['Ravi petition (original)', 'Ravi petition']);
    expect(items.find((i) => i.id === 'edited')).toMatchObject({ kind: 'document', hasFile: true, draftId: 'd1' });
    expect(items.find((i) => i.id === 'orig')!.draftId).toBeUndefined();
  });

  it('keeps the draft row when its edited file is gone (or not saved yet), and for ordinary drafts', () => {
    const items = listWithDrafts([doc('orig', 'Ravi petition (original)')], [
      draft({ sourceDocumentId: 'orig', editedDocumentId: 'deleted' }),
      draft({ id: 'd2', title: 'Bail application', matter: '' }),
    ]);
    expect(items.filter((i) => i.kind === 'draft').map((i) => [i.id, i.case])).toEqual([['d1', 'Ravi v. State'], ['d2', '-']]);
  });

  it("a teammate (whose own drafts don't include it) still sees the edited file, without draftId", () => {
    const items = listWithDrafts([doc('edited', 'Ravi petition')], []);
    expect(items).toHaveLength(1);
    expect(items[0]!.draftId).toBeUndefined();
  });
});
