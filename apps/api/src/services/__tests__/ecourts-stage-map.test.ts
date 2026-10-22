import { describe, expect, it } from 'vitest';
import { mapEcourtsPurposeToStage } from '../ecourts-stage-map';
import { stagesFor } from '../case-pipeline.service';

const civil = stagesFor('civil');
const criminal = stagesFor('criminal');
const consumer = stagesFor('consumer');
const writ = stagesFor('writ');

describe('mapEcourtsPurposeToStage', () => {
  it.each([
    ['FOR EVIDENCE', 'Evidence'],
    ['Cross Examination of PW1', 'Evidence'],
    ['P.W. 2 Chief', 'Evidence'],
    ['For Written Statement', 'Written Statement'],
    ['W.S.', 'Written Statement'],
    ['Framing of Issues', 'Issues'],
    ['For Arguments', 'Arguments'],
    ['Final Hearing', 'Arguments'],
    ['For Orders', 'Judgment'],
    ['Judgment', 'Judgment'],
    ['Summons', 'Summons'],
    ['Appearance', 'Summons'],
    ['Notice unserved', 'Summons'],
    ['I.A. Hearing', 'IA'],
    ['Interim Application', 'IA'],
    ['Fresh Admission', 'Filing'],
  ])('civil: %s -> %s', (purpose, stage) => {
    expect(mapEcourtsPurposeToStage(purpose, civil)).toBe(stage);
  });

  it.each([
    ['Framing of Charges', 'Framing of Charges'],
    ['Charge Sheet', 'Chargesheet'],
    ['For Cognizance', 'Cognizance'],
    ['Prosecution Evidence', 'Evidence'],
    ['Questioning', 'Evidence'],
    ['313 Questioning', 'Evidence'],
    ['Arguments', 'Arguments'],
  ])('criminal: %s -> %s', (purpose, stage) => {
    expect(mapEcourtsPurposeToStage(purpose, criminal)).toBe(stage);
  });

  it('uses the kind-specific label (consumer Notice/Reply/Order, writ Service/Counter)', () => {
    expect(mapEcourtsPurposeToStage('Notice', consumer)).toBe('Notice');
    expect(mapEcourtsPurposeToStage('For Reply', consumer)).toBe('Reply');
    expect(mapEcourtsPurposeToStage('For Orders', consumer)).toBe('Order');
    expect(mapEcourtsPurposeToStage('Service', writ)).toBe('Service');
    expect(mapEcourtsPurposeToStage('Counter Affidavit', writ)).toBe('Counter');
  });

  it('maps a disposed case to the judgment-type stage whatever the purpose', () => {
    expect(mapEcourtsPurposeToStage('Evidence', civil, true)).toBe('Judgment');
    expect(mapEcourtsPurposeToStage('', consumer, true)).toBe('Order');
  });

  it('prefers an exact match with a firm custom stage', () => {
    expect(mapEcourtsPurposeToStage('Mediation', [...civil, 'Mediation'])).toBe('Mediation');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(mapEcourtsPurposeToStage('Steps', civil)).toBeNull();
    expect(mapEcourtsPurposeToStage('', civil)).toBeNull();
    expect(mapEcourtsPurposeToStage(null, civil)).toBeNull();
    // A stage the matter's pipeline doesn't have is not invented.
    expect(mapEcourtsPurposeToStage('Framing of Charges', civil)).toBeNull();
  });
});
