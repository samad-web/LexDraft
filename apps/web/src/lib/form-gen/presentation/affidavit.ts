// Presentation metadata for the standalone Affidavit doc-type — the advocate-readable
// layer over the engine's affidavit contract. Field keys are engine keys. The competence
// clause and attestation are structural (the engine emits them); the advocate supplies
// the deponent identity, the numbered averments (body_paras), the prayer, and the
// corporate/third-party facts that drive the mandatory authority/source averments.

import type { DocPresentation } from '../types';

export const affidavitPresentation: DocPresentation = {
  category: 'Affidavit',
  description:
    'A standalone affidavit: the deponent competence clause, numbered averments of fact, ' +
    'prayer, and attestation. Corporate and third-party deponents require the extra ' +
    'averments the law mandates (authority reference / source of knowledge).',
  sectionOrder: ['Court & Cause Title', 'Parties', 'Deponent', 'The Affidavit', 'Competence', 'Attestation'],
  defaultSection: 'Other',
  fields: {
    // --- Court & Cause Title (full court-affidavit format; all optional) ---
    court_name: { label: 'Court', section: 'Court & Cause Title', order: 1,
      placeholder: 'e.g. DISTRICT JUDGE' },
    court_district: { label: 'District', section: 'Court & Cause Title', order: 2 },
    suit_no: { label: 'Suit / case number', section: 'Court & Cause Title', order: 3 },
    suit_year: { label: 'Year', section: 'Court & Cause Title', order: 4 },
    suit_under: { label: 'Filed under (provision)', section: 'Court & Cause Title', order: 5,
      placeholder: 'e.g. SUIT UNDER ORDER XXXVII CPC, 1908' },

    // --- Parties ---
    plaintiff_name: { label: 'Plaintiff / Petitioner name', section: 'Parties', order: 1 },
    plaintiff_description: { label: 'Plaintiff description', section: 'Parties', order: 2, rows: 2,
      placeholder: 'e.g. A company incorporated under the Companies Act, through its Director Shri…' },
    defendant_name: { label: 'Defendant / Respondent name', section: 'Parties', order: 3 },
    defendant_description: { label: 'Defendant description', section: 'Parties', order: 4, rows: 2 },
    deponent_capacity: { label: 'Deponent capacity (for the AFFIDAVIT OF heading)', section: 'Parties', order: 5,
      placeholder: 'e.g. the director of M/s ABC Pvt. Ltd.' },

    // --- Deponent ---
    deponent_name: { label: 'Deponent name', section: 'Deponent', order: 1 },
    parentage_type: { label: 'Parentage', section: 'Deponent', order: 2,
      placeholder: 'S/o, D/o, W/o' },
    parentage_name: { label: 'Parent / husband name', section: 'Deponent', order: 3 },
    age: { label: 'Age', section: 'Deponent', order: 4 },
    occupation: { label: 'Occupation', section: 'Deponent', order: 5 },
    address: { label: 'Residential address', section: 'Deponent', order: 6, rows: 2 },
    religion: { label: 'Religion (if required by the forum)', section: 'Deponent', order: 7 },

    // --- The Affidavit ---
    role: { label: 'Role in the proceeding', section: 'The Affidavit', order: 1,
      placeholder: 'e.g. petitioner, complainant, applicant' },
    proceeding: { label: 'Proceeding / case reference', section: 'The Affidavit', order: 2,
      placeholder: 'e.g. W.P. No. 1234 of 2024' },
    court_place: { label: 'Court / place of the proceeding', section: 'The Affidavit', order: 3 },
    body_paras: { label: 'Averments of fact (one per line)', section: 'The Affidavit', order: 4,
      placeholder: 'One averment per line — each becomes a numbered paragraph.',
      help: 'Para 1 (the competence clause) is added automatically; these are numbered ' +
        'from para 2. Do not type the numbers.' },
    prayer: { label: 'Prayer', section: 'The Affidavit', order: 5,
      placeholder: 'e.g. allow the writ petition' },

    // --- Competence (corporate / third-party) ---
    is_corporate: { label: 'Corporate deponent?', section: 'Competence', order: 1,
      help: 'A corporate deponent must cite the authority to swear (board resolution / POA).' },
    authority_ref: { label: 'Authority reference', section: 'Competence', order: 2,
      placeholder: 'Board resolution / power of attorney reference',
      visibleWhen: { field: 'is_corporate', equals: 'Yes' },
      help: 'Required for a corporate deponent — the engine refuses without it.' },
    is_third_party: { label: 'Third-party deponent (not a party)?', section: 'Competence', order: 3,
      help: 'A deponent who is not a party must state the source of their knowledge.' },
    source_of_knowledge: { label: 'Source of knowledge', section: 'Competence', order: 4, rows: 2,
      visibleWhen: { field: 'is_third_party', equals: 'Yes' },
      help: 'Required for a third-party deponent — the engine refuses without it.' },

    // --- Attestation ---
    attestor: { label: 'Attesting officer', section: 'Attestation', order: 1,
      placeholder: 'Advocate / Notary Public / Oath Commissioner' },
    place: { label: 'Place of swearing', section: 'Attestation', order: 2 },
    affirm_date: { label: 'Date of swearing', section: 'Attestation', order: 3 },
  },
};
