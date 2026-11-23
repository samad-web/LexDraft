import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_NOTE_CHARS, saveNotes } from '../SaveAsNoteModal';

// save-as-case-note AC1, AC3, AC4.
describe('Save as case note', () => {
  it('AC1: one separate note per chosen case', async () => {
    const post = vi.fn().mockResolvedValue({});
    const failed = await saveNotes(post, [{ id: 'c1', title: 'A v. State' }, { id: 'c2', title: 'B v. State' }]);
    expect(failed).toEqual([]);
    expect(post.mock.calls.map((c) => c[0])).toEqual(['c1', 'c2']);
  });

  it('AC4: one failure names that case; the others are still saved', async () => {
    const post = vi.fn((id: string) => (id === 'c2' ? Promise.reject(new Error('404')) : Promise.resolve({})));
    const failed = await saveNotes(post, [{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }, { id: 'c3', title: 'C' }]);
    expect(failed).toEqual(['B']);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('AC3: the limit matches the API note body limit', () => {
    const routes = readFileSync(resolve(__dirname, '../../../../api/src/routes/case-notes.routes.ts'), 'utf8');
    expect(MAX_NOTE_CHARS).toBe(50_000);
    expect(routes).toMatch(/body:\s+z\.string\(\)\.trim\(\)\.min\(1\)\.max\(50_000\)/);
  });
});
