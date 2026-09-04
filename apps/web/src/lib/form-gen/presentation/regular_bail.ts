// Presentation metadata for Regular Bail — the advocate-readable layer merged over the
// engine's regular_bail contract. Field KEYS here must be engine keys (the generator
// places every engine field; these only style them). Any engine field omitted below
// still renders via the humanised fallback.

import type { DocPresentation } from '../types';

export const regularBailPresentation: DocPresentation = {
  category: 'Application',
  description:
    'Application for regular bail under Section 483 BNSS (post-arrest), grounded in the ' +
    'custody particulars and the triple-test grounds. Section identifiers resolve against ' +
    'the BNS/BNSS tables — never a model.',
  sectionOrder: [
    'Accused',
    'FIR & Offence',
    'Custody',
    'Court & Application',
    'Grounds',
    'Successive Application',
  ],
  defaultSection: 'Other',
  fields: {
    // --- Accused ---
    accused_name: { label: 'Accused name', section: 'Accused', order: 1,
      placeholder: 'Full name as in the FIR' },
    accused_parentage: { label: "Parentage (S/o, D/o, W/o)", section: 'Accused', order: 2,
      placeholder: 'e.g. S/o Kumaravel' },
    age: { label: 'Age', section: 'Accused', order: 3 },
    occupation: { label: 'Occupation', section: 'Accused', order: 4 },
    address: { label: 'Residential address', section: 'Accused', order: 5, rows: 2 },

    // --- FIR & Offence ---
    fir_no: { label: 'FIR / Crime number', section: 'FIR & Offence', order: 1,
      placeholder: 'e.g. 812/2024' },
    police_station: { label: 'Police station', section: 'FIR & Offence', order: 2 },
    district: { label: 'District', section: 'FIR & Offence', order: 3 },
    sections: { label: 'Offence sections', section: 'FIR & Offence', order: 4,
      placeholder: 'One per line, e.g.\nBNS s.303(2)\nBNS s.317(2)',
      help: 'Enter each BNS/BNSS section on its own line. Section text is drawn from the ' +
        'statute tables, not generated.' },
    offence_date: { label: 'Date of offence', section: 'FIR & Offence', order: 5,
      help: 'Used with the proceeding-start date to resolve the BNS/BNSS vs IPC/CrPC framework.' },
    proceeding_start_date: { label: 'Proceeding start date', section: 'FIR & Offence', order: 6 },
    is_fresh_action: { label: 'Fresh action (not a legacy carry-over)?', section: 'FIR & Offence', order: 7 },
    special_statute: { label: 'Special statute (if any)', section: 'FIR & Offence', order: 8,
      enumLabels: { ndps: 'NDPS Act', pmla: 'PMLA', uapa: 'UAPA', scst: 'SC/ST Act' },
      help: 'Triggers the statutory bail-bar the grounds must address.' },
    bail_bar_addressed: { label: 'Statutory bail-bar addressed in grounds?', section: 'FIR & Offence', order: 9 },

    // --- Custody ---
    custody_since: { label: 'In custody since', section: 'Custody', order: 1,
      help: 'Date the accused was taken into judicial custody.' },
    as_on: { label: 'Custody computed as on', section: 'Custody', order: 2,
      help: 'The date the period in custody is calculated to (usually the filing date).' },
    prison: { label: 'Prison / place of custody', section: 'Custody', order: 3 },
    chargesheet_filed: { label: 'Charge-sheet filed?', section: 'Custody', order: 4 },

    // --- Court & Application ---
    court_level: { label: 'Court level', section: 'Court & Application', order: 1,
      placeholder: 'e.g. Principal Sessions Judge, Tiruvallur' },
    bail_court: { label: 'Court name (as it appears in the cause title)', section: 'Court & Application', order: 2 },
    application_date: { label: 'Application date', section: 'Court & Application', order: 3 },
    place: { label: 'Place (for verification)', section: 'Court & Application', order: 4 },

    // --- Grounds ---
    prosecution_case: { label: 'Brief facts of the prosecution case', section: 'Grounds', order: 1, rows: 3 },
    grounds: { label: 'Grounds for bail', section: 'Grounds', order: 2, rows: 4,
      help: 'Left blank, the engine composes the standard triple-test grounds.' },
    parity_claims: { label: 'Parity claims (co-accused already on bail)', section: 'Grounds', order: 3,
      placeholder: 'One per line' },

    // --- Successive Application (conditional) ---
    is_successive: { label: 'Is this a successive bail application?', section: 'Successive Application', order: 1 },
    prior_order_ref: { label: 'Prior order reference', section: 'Successive Application', order: 2,
      visibleWhen: { field: 'is_successive', equals: 'Yes' } },
    change_of_circumstance: { label: 'Change in circumstances since the last application',
      section: 'Successive Application', order: 3, rows: 3,
      visibleWhen: { field: 'is_successive', equals: 'Yes' },
      help: 'Required for a successive application — what has changed since the last refusal.' },
  },
};
