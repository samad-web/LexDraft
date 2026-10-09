import { describe, expect, it, vi, beforeEach } from 'vitest';

const dbMock = vi.fn();
vi.mock('../../db/client', () => ({ db: () => dbMock() }));

const syncCaseFromEcourtsMock = vi.fn();
vi.mock('../../services/case-sync.service', () => ({
  syncCaseFromEcourts: (...args: unknown[]) => syncCaseFromEcourtsMock(...args),
}));

const applyPlanStatusUpdateMock = vi.fn();
vi.mock('../../services/plan-status.service', () => ({
  applyPlanStatusUpdate: (...args: unknown[]) => applyPlanStatusUpdateMock(...args),
}));

const planStatusChangedMock = vi.fn();
vi.mock('../../services/notifications.service', () => ({
  notify: { planStatusChanged: (...args: unknown[]) => planStatusChangedMock(...args) },
}));

import { dispatchWebhook } from '../webhooks.routes';

function mkLog() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('dispatchWebhook', () => {
  beforeEach(() => {
    dbMock.mockReset();
    syncCaseFromEcourtsMock.mockReset();
    applyPlanStatusUpdateMock.mockReset();
    planStatusChangedMock.mockReset();
  });

  describe('source=ecourts', () => {
    it('resolves the CNR to a case and triggers a per-case sync', async () => {
      const sqlRows = [{ id: 'case-1', firm_id: 'firm-1' }];
      const sqlMock = Object.assign(
        vi.fn(() => Promise.resolve(sqlRows)),
        {},
      );
      dbMock.mockReturnValue(sqlMock as unknown as ReturnType<typeof dbMock>);
      syncCaseFromEcourtsMock.mockResolvedValue({ changes: [] });

      const log = mkLog();
      await dispatchWebhook('ecourts', { cnr: 'abcd1234567890ef' }, log);

      expect(sqlMock).toHaveBeenCalled();
      expect(syncCaseFromEcourtsMock).toHaveBeenCalledWith('case-1', 'firm-1');
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'case-1' }),
        'ecourts webhook: case synced',
      );
    });

    it('skips and warns when cnr is missing from the payload', async () => {
      const log = mkLog();
      await dispatchWebhook('ecourts', {}, log);

      expect(dbMock).not.toHaveBeenCalled();
      expect(syncCaseFromEcourtsMock).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'ecourts' }),
        'ecourts webhook: missing cnr, skipping',
      );
    });

    it('skips and warns when no case matches the CNR', async () => {
      const sqlMock = Object.assign(vi.fn(() => Promise.resolve([])), {});
      dbMock.mockReturnValue(sqlMock as unknown as ReturnType<typeof dbMock>);

      const log = mkLog();
      await dispatchWebhook('ecourts', { cnr: 'NOMATCH000000000' }, log);

      expect(syncCaseFromEcourtsMock).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cnr: 'NOMATCH000000000' }),
        'ecourts webhook: no matching case, skipping',
      );
    });

    it('does nothing when the database is unavailable (demo mode)', async () => {
      dbMock.mockReturnValue(null);
      const log = mkLog();
      await dispatchWebhook('ecourts', { cnr: 'ABCD1234567890EF' }, log);
      expect(syncCaseFromEcourtsMock).not.toHaveBeenCalled();
    });
  });

  describe('source=payment', () => {
    it('applies a valid status update and fires a notification', async () => {
      applyPlanStatusUpdateMock.mockResolvedValue(true);
      const log = mkLog();

      await dispatchWebhook('payment', { firmId: 'firm-1', status: 'past_due' }, log);

      expect(applyPlanStatusUpdateMock).toHaveBeenCalledWith('firm-1', {
        planStatus: 'past_due',
        renewsAt: null,
      });
      expect(planStatusChangedMock).toHaveBeenCalledWith('firm-1', {
        planStatus: 'past_due',
        renewsAt: null,
      });
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ firmId: 'firm-1', status: 'past_due' }),
        'payment webhook: plan status updated',
      );
    });

    it('rejects an unrecognized status value without touching the firm', async () => {
      const log = mkLog();
      await dispatchWebhook('payment', { firmId: 'firm-1', status: 'refunded' }, log);

      expect(applyPlanStatusUpdateMock).not.toHaveBeenCalled();
      expect(planStatusChangedMock).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'payment' }),
        'payment webhook: invalid payload, skipping',
      );
    });

    it('rejects a payload missing firmId', async () => {
      const log = mkLog();
      await dispatchWebhook('payment', { status: 'active' }, log);

      expect(applyPlanStatusUpdateMock).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalled();
    });

    it('warns without notifying when the firm does not exist', async () => {
      applyPlanStatusUpdateMock.mockResolvedValue(false);
      const log = mkLog();

      await dispatchWebhook('payment', { firmId: 'missing-firm', status: 'active' }, log);

      expect(planStatusChangedMock).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ firmId: 'missing-firm' }),
        'payment webhook: firm not found, skipping',
      );
    });
  });

  describe('source=esign', () => {
    it('acknowledges without any side effect', async () => {
      const log = mkLog();
      await dispatchWebhook('esign', { anything: 'here' }, log);

      expect(dbMock).not.toHaveBeenCalled();
      expect(applyPlanStatusUpdateMock).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(
        { source: 'esign' },
        'esign webhook: verified and acknowledged, no provider wired yet',
      );
    });
  });

  describe('unrecognized source', () => {
    it('acknowledges but warns without dispatching anywhere', async () => {
      const log = mkLog();
      await dispatchWebhook('mystery-provider', {}, log);

      expect(log.warn).toHaveBeenCalledWith(
        { source: 'mystery-provider' },
        'webhook: unrecognized source, acknowledged but not dispatched',
      );
    });
  });
});
