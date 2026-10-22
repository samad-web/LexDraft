import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- fake postgres.js tag: route each query by its text --------------------
interface FakeState {
  busy: Array<{ id: string }>;
  cases: Array<{ id: string; firm_id: string; cnr: string; title: string; created_by_user_id: string | null }>;
  unreachable: number;
  groups: unknown[];
  queries: string[];
}
const state: FakeState = { busy: [], cases: [], unreachable: 0, groups: [], queries: [] };

function fakeSql(strings: TemplateStringsArray): Promise<unknown[]> {
  const q = strings.join('?').replace(/\s+/g, ' ');
  state.queries.push(q);
  if (q.includes('select id from ecourts_sync_runs where status')) return Promise.resolve(state.busy);
  if (q.includes('insert into ecourts_sync_runs')) return Promise.resolve([{ id: 'run-1', started_at: new Date() }]);
  if (q.includes('from cases') && q.includes('order by coalesce(ecourts_synced_at')) return Promise.resolve(state.cases);
  if (q.includes('count(*)::int as n from cases')) return Promise.resolve([{ n: state.unreachable }]);
  if (q.includes('group by firm_id, created_by_user_id')) return Promise.resolve(state.groups);
  return Promise.resolve([]);
}

vi.mock('../../db/client', () => ({ db: () => fakeSql }));

const syncMock = vi.fn();
vi.mock('../case-sync.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../case-sync.service')>()),
  syncCaseFromEcourts: (...args: unknown[]) => syncMock(...args),
}));

const enqueueMock = vi.fn().mockResolvedValue('job-1');
vi.mock('../jobs.service', () => ({ jobs: { enqueue: (...args: unknown[]) => enqueueMock(...args) } }));

const summaryMock = vi.fn();
const caseUpdatedMock = vi.fn();
vi.mock('../notifications.service', () => ({
  notify: {
    ecourtsSyncSummary: (...args: unknown[]) => summaryMock(...args),
    caseUpdatedFromEcourts: (...args: unknown[]) => caseUpdatedMock(...args),
  },
  resolveCaseRecipients: () => Promise.resolve([{ id: 'user-1', email: 'a@b.c' }]),
}));

import { runScheduledSync, RETRY_DELAY_SEC } from '../ecourts-sync-runs.service';
import { EcourtsHttpError } from '../../lib/ecourts';

function caseRows(n: number): FakeState['cases'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `case-${i}`, firm_id: 'firm-1', cnr: `KLER0100016820${String(i).padStart(2, '0')}`,
    title: `Matter ${i}`, created_by_user_id: 'user-1',
  }));
}

describe('runScheduledSync', () => {
  beforeEach(() => {
    state.busy = [];
    state.cases = [];
    state.unreachable = 0;
    state.groups = [];
    state.queries = [];
    syncMock.mockReset();
    enqueueMock.mockClear();
    summaryMock.mockReset();
    caseUpdatedMock.mockReset();
    // Throttle/backoff sleeps fire instantly.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trips the circuit breaker after 5 consecutive upstream failures and schedules a retry', async () => {
    state.cases = caseRows(8);
    state.unreachable = 8;
    syncMock.mockRejectedValue(new EcourtsHttpError(504, 'eCourts did not respond'));

    const r = await runScheduledSync({ slot: 'morning', runDate: '2026-10-19' });

    expect(syncMock).toHaveBeenCalledTimes(5);
    expect(r.status).toBe('upstream_down');
    expect(r.failed).toBe(5);
    expect(r.deferred).toBe(3);
    expect(r.retryScheduled).toBe(true);
    expect(enqueueMock).toHaveBeenCalledWith(
      'ecourts.sync.retry',
      { slot: 'morning', runDate: '2026-10-19', attempt: 2 },
      expect.objectContaining({ delaySec: RETRY_DELAY_SEC }),
    );
  });

  it('completes, notifies changes, and does not retry when everything synced', async () => {
    state.cases = caseRows(2);
    state.unreachable = 0;
    state.groups = [{
      firm_id: 'firm-1', created_by_user_id: 'user-1',
      total: 2, synced: 2, changed: 1, not_found: 0, errored: 0, changed_titles: ['Matter 0'],
    }];
    syncMock
      .mockResolvedValueOnce({ caseRow: { title: 'Matter 0' }, changes: { next_hearing: { from: '2026-10-20', to: '2026-11-03' } } })
      .mockResolvedValueOnce({ caseRow: { title: 'Matter 1' }, changes: {} });

    const r = await runScheduledSync({ slot: 'evening', runDate: '2026-10-19' });

    expect(r.status).toBe('completed');
    expect(r.synced).toBe(2);
    expect(r.changed).toBe(1);
    expect(r.retryScheduled).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(caseUpdatedMock).toHaveBeenCalledTimes(1);
    expect(summaryMock).toHaveBeenCalledWith('firm-1', 'user-1', expect.objectContaining({
      slot: 'evening',
      runDate: '2026-10-19',
      retrying: false,
      finalAttempt: true,
      tally: expect.objectContaining({ total: 2, synced: 2, changed: 1, unreachable: 0 }),
    }));
  });

  it('a not-found CNR neither trips the breaker nor triggers a retry', async () => {
    const { EcourtsRecordNotFoundError } = await import('../case-sync.service');
    state.cases = caseRows(6);
    syncMock.mockRejectedValue(new EcourtsRecordNotFoundError('KLER010001682000'));

    const r = await runScheduledSync({ slot: 'morning', runDate: '2026-10-19' });

    expect(syncMock).toHaveBeenCalledTimes(6);
    expect(r.notFound).toBe(6);
    expect(r.status).toBe('completed');
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('defers instead of overlapping when another run is in progress', async () => {
    state.busy = [{ id: 'other-run' }];

    const r = await runScheduledSync({ slot: 'morning', runDate: '2026-10-19' });

    expect(r.status).toBe('skipped');
    expect(syncMock).not.toHaveBeenCalled();
    expect(state.queries.some((q) => q.includes('insert into ecourts_sync_runs'))).toBe(false);
    expect(enqueueMock).toHaveBeenCalledWith(
      'ecourts.sync.retry',
      { slot: 'morning', runDate: '2026-10-19', attempt: 1, busyDeferrals: 1 },
      expect.objectContaining({ delaySec: 600 }),
    );
  });

  it('stops retrying after the last allowed attempt', async () => {
    state.cases = caseRows(1);
    state.unreachable = 1;
    syncMock.mockRejectedValue(new EcourtsHttpError(503, 'down'));

    const r = await runScheduledSync({ slot: 'evening', runDate: '2026-10-19', attempt: 7 });

    expect(r.retryScheduled).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(summaryMock).not.toHaveBeenCalled(); // no groups returned by the fake
  });
});
