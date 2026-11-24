import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearEdits, draftKey, getEdits, setEdit, updateRequest } from '../detail-edits';

// Owner 2026-11-24: typing in "Missing details" must not re-draft the document;
// it re-drafts once, when the advocate approves with "Update document".
const K = draftKey('m1', 'Vakalatnama');

describe('missing details: fill first, update once', () => {
  beforeEach(() => clearEdits(K));

  it('AC1 typing only stores the details; nothing to send per keystroke', () => {
    setEdit(K, 'opposite_party', 'R');
    setEdit(K, 'opposite_party', 'Ra');
    setEdit(K, 'opposite_party', 'Ramesh');
    setEdit(K, 'enrolment_no', 'TN/123/2020');
    expect(getEdits(K)).toEqual({ opposite_party: 'Ramesh', enrolment_no: 'TN/123/2020' });
  });

  it('AC2 "Update document" sends ONE request with every typed detail, drafted with the final wording', () => {
    setEdit(K, 'opposite_party', 'Ramesh');
    setEdit(K, 'enrolment_no', 'TN/123/2020');
    const req = updateRequest('m1', 'Vakalatnama', getEdits(K), 'ta');
    expect(req).toEqual({ matterId: 'm1', docLabel: 'Vakalatnama', edits: { opposite_party: 'Ramesh', enrolment_no: 'TN/123/2020' }, draftNow: true, language: 'ta' });
    expect(req).not.toHaveProperty('compose'); // full re-draft, not the engine-only preview
  });

  it('AC3 nothing typed: no request (the button stays disabled)', () => {
    expect(updateRequest('m1', 'Vakalatnama', getEdits(K))).toBeNull();
  });

  it('AC4 closing and reopening the popup keeps what was typed (same draft)', () => {
    setEdit(K, 'advocate_mobile', '9876543210');
    expect(getEdits(draftKey('m1', 'Vakalatnama'))).toEqual({ advocate_mobile: '9876543210' });
  });

  it('AC5 another draft starts empty; a successful update clears the typed details', () => {
    setEdit(K, 'advocate_mobile', '9876543210');
    expect(getEdits(draftKey('m1', 'Bail application'))).toEqual({});
    clearEdits(K);
    expect(getEdits(K)).toEqual({});
  });

  it('AC6 the panel has no timer and calls the server only from "Update document"', () => {
    const src = readFileSync(fileURLToPath(new URL('../LiveDetailsPanel.tsx', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/setTimeout|DEBOUNCE/);
    expect(src.match(/mutateAsync\(/g)).toHaveLength(1);
    const change = src.slice(src.indexOf('const change ='), src.indexOf('const apply ='));
    expect(change).not.toMatch(/mutate|apply\(/);
  });
});
