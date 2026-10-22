import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EcourtsHttpError } from '../../lib/ecourts';
import * as store from '../ecourts-case-store.service';

// Live eCourts + the job queue are mocked; with no DATABASE_URL (unit setup)
// the store uses its in-memory fallback, which has the same semantics.
const { lookupByCnr, fetchFilingCaseHistory, enqueue } = vi.hoisted(() => ({
  lookupByCnr: vi.fn(),
  fetchFilingCaseHistory: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('../ecourts.service', () => ({ lookupByCnr, fetchFilingCaseHistory }));
vi.mock('../jobs.service', () => ({ jobs: { enqueue, register: vi.fn() } }));

const CASE = { cino: 'KLAL290000332022', pet_name: 'Shahul Hameed Ravuthar', res_name: 'Oohur' };
let n = 0;
const freshCnr = () => `KLAL29${String(++n).padStart(10, '0')}`;

beforeEach(() => {
  lookupByCnr.mockReset();
  fetchFilingCaseHistory.mockReset();
  enqueue.mockReset();
  enqueue.mockResolvedValue(undefined);
  store.__testing.resetBreaker();
});

describe('ecourts case store', () => {
  it('fetches live once, then serves the stored copy without calling eCourts', async () => {
    const cnr = freshCnr();
    lookupByCnr.mockImplementation(async (c: string, court: 'DC' | 'HC') => {
      await store.writeStored('history', c, court, CASE); // what ecourts.service does
      return CASE;
    });
    const first = await store.getCase('history', cnr, 'DC');
    expect(first.status).toBe('ok');
    expect(lookupByCnr).toHaveBeenCalledTimes(1);

    const second = await store.getCase('history', cnr, 'DC');
    expect(second).toMatchObject({ status: 'ok', stale: false, refreshing: false });
    expect(lookupByCnr).toHaveBeenCalledTimes(1);
  });

  it('serves a stale copy instantly and refreshes it in the background', async () => {
    const cnr = freshCnr();
    await store.writeStored('history', cnr, 'DC', CASE);
    // Age it past the freshness window.
    vi.useFakeTimers({ now: Date.now() + 7 * 60 * 60 * 1000, toFake: ['Date'] });
    lookupByCnr.mockResolvedValue(CASE);
    const r = await store.getCase('history', cnr, 'DC');
    vi.useRealTimers();
    expect(r).toMatchObject({ status: 'ok', stale: true, refreshing: true });
    await vi.waitFor(() => expect(lookupByCnr).toHaveBeenCalledTimes(1));
  });

  it('queues a retrying fetch when eCourts is down and nothing is stored', async () => {
    const cnr = freshCnr();
    lookupByCnr.mockRejectedValue(new EcourtsHttpError(405, 'eCourts is limiting requests right now.'));
    const r = await store.getCase('history', cnr, 'DC', { queueFor: { userId: 'u1', firmId: 'f1' } });
    expect(r.status).toBe('queued');
    expect(enqueue).toHaveBeenCalledWith('ecourts.case.fetch', expect.objectContaining({ cnr, userId: 'u1' }), expect.objectContaining({ retryLimit: 6 }));
  });

  it('does not queue row-status lookups; reports them unavailable', async () => {
    const cnr = freshCnr();
    fetchFilingCaseHistory.mockRejectedValue(new EcourtsHttpError(503, 'down'));
    const r = await store.getCase('filing', cnr, 'DC');
    expect(r.status).toBe('unavailable');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('stops calling eCourts for a while after it fails (circuit breaker)', async () => {
    lookupByCnr.mockRejectedValue(new EcourtsHttpError(405, 'throttled'));
    const who = { queueFor: { userId: 'u1', firmId: 'f1' } };
    expect((await store.getCase('history', freshCnr(), 'DC', who)).status).toBe('queued');
    expect((await store.getCase('history', freshCnr(), 'DC', who)).status).toBe('queued');
    expect(lookupByCnr).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('queues only one fetch per case while it is pending', async () => {
    lookupByCnr.mockRejectedValue(new EcourtsHttpError(405, 'throttled'));
    const cnr = freshCnr();
    const who = { queueFor: { userId: 'u1', firmId: 'f1' } };
    for (let i = 0; i < 3; i++) await store.getCase('history', cnr, 'DC', who);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('remembers "no such case" instead of asking eCourts again', async () => {
    const cnr = freshCnr();
    lookupByCnr.mockImplementation(async (c: string, court: 'DC' | 'HC') => {
      await store.writeStored('history', c, court, null);
      return null;
    });
    expect((await store.getCase('history', cnr, 'DC')).status).toBe('not_found');
    expect((await store.getCase('history', cnr, 'DC')).status).toBe('not_found');
    expect(lookupByCnr).toHaveBeenCalledTimes(1);
  });
});
