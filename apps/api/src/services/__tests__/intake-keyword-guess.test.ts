import { describe, expect, it } from 'vitest';
import { explicitRequest, keywordGuessLabel } from '../intake.service';
import { LABEL_TO_ENGINE_DOC, isRoutable } from '../../lib/engine-field-map';

// The advocate's instruction is classified by these keyword cues FIRST and wins
// outright, so a wrong cue drafts the wrong document with "high" confidence.
const LABELS = Object.keys(LABEL_TO_ENGINE_DOC);
const guess = (s: string) => keywordGuessLabel(s, LABELS);

describe('keywordGuessLabel — court-issued instruments', () => {
  it.each([
    ['draft a court warrant', 'Court Warrant / Order'],
    ['Draft a warrant of attachment in execution of the decree', 'Court Warrant / Order'],
    ['prepare warrant for delivery of possession in the HRC eviction', 'Court Warrant / Order'],
    ['draft a prohibitory order under Order XXI Rule 54', 'Court Warrant / Order'],
    ['draft a court summons to the defendant', 'Court Summons'],
    ['issue summons to the witness', 'Court Summons'],
    ['draft a court notice to the respondent', 'Court Notice'],
  ])('%s -> %s', (instruction, label) => {
    expect(guess(instruction)).toBe(label);
  });

  it.each([
    // must NOT be hijacked by the new cues
    ['draft a bail application, a non-bailable warrant was issued', 'Regular Bail Application'],
    ['petition to recall the warrant', 'Recall Petition (s.70(2) CrPC)'],
    ['draft an execution application for the money decree', 'Execution Application'],
    ['draft a legal demand notice for the unpaid dues', 'General Demand Notice'],
    ['notice u/s 138 for the bounced cheque', 'Notice u/s 138 NI Act'],
    ['draft a process memo to issue summons at the new address', 'Process Memo'],
  ])('%s -> %s (unchanged)', (instruction, label) => {
    expect(guess(instruction)).toBe(label);
  });

  it.each([
    // pre-litigation notices must not be routed to a plaint
    ['draft a legal notice for recovery of dues', 'General Demand Notice'],
    ['send a demand notice for recovery of Rs. 5 lakhs', 'General Demand Notice'],
    ['draft a notice for payment of the outstanding amount', 'General Demand Notice'],
    ['draft a notice to quit to the tenant', 'Notice u/s 106 TPA (Ejectment)'],
    ['notice u/s 106 TPA terminating the tenancy', 'Notice u/s 106 TPA (Ejectment)'],
    ['draft a notice under section 80 CPC to the government', 'Notice u/s 80 CPC'],
    // a suit still goes to the plaint
    ['draft a plaint for recovery of money', 'Plaint (Money Recovery)'],
    ['civil suit for recovery of Rs. 5 lakhs after the legal notice', 'Plaint (Money Recovery)'],
  ])('%s -> %s', (instruction, label) => {
    expect(guess(instruction)).toBe(label);
  });

  it('a bare mention of summons does not force Court Summons', () => {
    expect(guess('petition for substituted service of summons')).not.toBe('Court Summons');
  });
});

describe('explicit request decides the format before fact words', () => {
  // The advocate's own "draft an affidavit for this case" must win over a fact
  // word earlier in the brief (here "gift", which alone routes to Gift Deed).
  const brief = 'My client Ramesh gifted his house property to his son by a registered gift deed in 2019. '
    + 'The son now denies it. Draft an affidavit for this case.';

  it('finds the LAST explicit request phrase', () => {
    expect(explicitRequest(brief)).toBe('affidavit for this case');
    expect(explicitRequest('Prepare a vakalatnama for my client')).toBe('vakalatnama for my client');
    expect(explicitRequest('The cheque bounced twice')).toBeNull();
  });

  it('routes the request phrase, not the facts', () => {
    expect(guess(explicitRequest(brief)!)).toBe('Affidavit'); // …the request picks the right one
  });

  it('affidavit is routable for the drafting card', () => {
    expect(LABEL_TO_ENGINE_DOC['Affidavit']).toBe('affidavit');
    expect(isRoutable('affidavit')).toBe(true);
  });
});
