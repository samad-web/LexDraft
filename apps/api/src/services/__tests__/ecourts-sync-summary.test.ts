import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture what notificationsStore.create inserts: the tagged-template values
// are (firmId, userId, tone, icon, title, body, view, dedupeKey).
const inserted: unknown[][] = [];
function fakeSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  if (strings.join('?').includes('insert into notifications')) inserted.push(values);
  return Promise.resolve([{ id: 'n1' }]);
}
vi.mock('../../db/client', () => ({ db: () => fakeSql }));
vi.mock('../jobs.service', () => ({ jobs: { enqueue: vi.fn() } }));

import { notify } from '../notifications.service';

const base = { total: 0, synced: 0, changed: 0, notFound: 0, errored: 0, unreachable: 0, changedTitles: [] as string[] };

async function summary(tally: Partial<typeof base>, retrying = false) {
  inserted.length = 0;
  await notify.ecourtsSyncSummary('firm-1', 'user-1', {
    slot: 'morning', runDate: '2026-10-20', tally: { ...base, ...tally }, retrying, finalAttempt: !retrying,
  });
  const v = inserted[0]!;
  return { tone: v[2], title: String(v[4]), body: String(v[5]), dedupe: v[7] };
}

describe('notify.ecourtsSyncSummary', () => {
  beforeEach(() => { inserted.length = 0; });

  it('does not claim "all 0 cases up to date" when every CNR was not found (seen live)', async () => {
    const s = await summary({ total: 2, notFound: 2 });
    expect(s.title).toBe('Morning (9 AM) eCourts update: 2 cases need attention');
    expect(s.title).not.toMatch(/up to date/);
    expect(s.body).toContain('2 not found on eCourts');
    expect(s.tone).toBe('amber');
  });

  it('reports changes with the changed matters named', async () => {
    const s = await summary({ total: 3, synced: 3, changed: 1, changedTitles: ['A v. B'] });
    expect(s.title).toBe('Morning (9 AM) eCourts update: 1 case changed');
    expect(s.body).toContain('1 updated (A v. B)');
    expect(s.tone).toBe('cobalt');
  });

  it('says "up to date" only when everything synced cleanly', async () => {
    const s = await summary({ total: 4, synced: 4 });
    expect(s.title).toBe('Morning (9 AM) eCourts update: all 4 cases up to date');
    expect(s.tone).toBe('sage');
  });

  it('reports eCourts being down, with the retry, when nothing got through', async () => {
    const s = await summary({ total: 5, unreachable: 5 }, true);
    expect(s.title).toMatch(/delayed: eCourts is not responding/);
    expect(s.body).toMatch(/Retrying automatically every 30 minutes/);
  });

  it('uses one dedupe key per slot and day so retries update the same notification', async () => {
    const s = await summary({ total: 1, synced: 1 });
    expect(s.dedupe).toBe('ecourts-run:morning:2026-10-20');
  });

  it('sends nothing for an advocate with no eCourts-linked matters', async () => {
    await notify.ecourtsSyncSummary('firm-1', 'user-1', {
      slot: 'evening', runDate: '2026-10-20', tally: base, retrying: false, finalAttempt: true,
    });
    expect(inserted).toHaveLength(0);
  });
});
