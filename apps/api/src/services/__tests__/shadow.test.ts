import { beforeEach, describe, expect, it } from 'vitest';
import { shadowRecorderService } from '../shadow-recorder.service';
import { shadowReportService } from '../shadow-report.service';

// These drive the reporter directly off recorded pairs (in-memory store), so they
// exercise the classification without needing a live engine. The recorder's own
// engine call is covered by the engine-client tests; here the pairs are the REAL
// captured shape (model + engine responses), inserted via the store.

async function record(engineStatus: string, engine: unknown, model: unknown) {
  await (shadowRecorderService as any)._store(
    { docType: 's138_notice', matterId: 'm', firmId: 'f', capturedBy: 'u',
      fields: {}, model },
    engineStatus, engine,
  );
}

describe('shadow reporter — classification', () => {
  beforeEach(() => shadowRecorderService._resetMemory());

  it('refuses to report on zero recorded pairs and says so', async () => {
    const report = await shadowReportService.build('s138_notice');
    expect(report.hasData).toBe(false);
    expect(report.pairs).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.message).toMatch(/No recorded/i);
    expect(report.message).toMatch(/invented traffic tells us nothing/i);
  });

  it('CRITICAL: engine refused where the model drafted', async () => {
    await record(
      'refused',
      { outcome: 'refused', refusal: {
        code: 's138_notice_cheque_presented_after_validity',
        reason: 'cheque presented beyond validity',
        fields_implicated: ['cheques[].date', 'presentation_date'],
      } },
      { blocked: false }, // model produced a draft
    );
    const report = await shadowReportService.build('s138_notice');
    expect(report.hasData).toBe(true);
    expect(report.counts.CRITICAL).toBe(1);
    const f = report.findings[0]!;
    expect(f.severity).toBe('CRITICAL');
    expect(f.summary).toMatch(/engine refused/);
    expect(f.detail).toMatch(/legally-defective/);
  });

  it('REVIEW: model blocked where the engine generated', async () => {
    await record(
      'generated',
      { outcome: 'generated' },
      { blocked: true, verify: { old_law_references: ['Section 138 of NI Act'] } },
    );
    const report = await shadowReportService.build('s138_notice');
    expect(report.counts.REVIEW).toBe(1);
    expect(report.findings[0]!.severity).toBe('REVIEW');
  });

  it('AGREE: both generated (wording deltas are noise, not itemised)', async () => {
    await record('generated', { outcome: 'generated' }, { blocked: false });
    const report = await shadowReportService.build('s138_notice');
    expect(report.counts.AGREE).toBe(1);
    expect(report.findings).toEqual([]); // agreement is not an actionable finding
  });

  it('EXCLUDED: an engine error is not counted as agreement', async () => {
    await record('error', { message: 'boom' }, { blocked: false });
    const report = await shadowReportService.build('s138_notice');
    expect(report.counts.EXCLUDED).toBe(1);
    expect(report.counts.AGREE).toBe(0); // crucial: a broken engine != agreement
    expect(report.message).toMatch(/excluded/i);
  });

  it('CRITICAL sorts before REVIEW in the findings', async () => {
    await record('generated', { outcome: 'generated' },
      { blocked: true, verify: { old_law_references: ['x'] } }); // REVIEW
    await record('refused',
      { outcome: 'refused', refusal: { code: 'c', reason: 'r', fields_implicated: [] } },
      { blocked: false }); // CRITICAL
    const report = await shadowReportService.build('s138_notice');
    expect(report.findings[0]!.severity).toBe('CRITICAL');
    expect(report.findings[1]!.severity).toBe('REVIEW');
  });
});
