// LexDraft document schemas - per-type field collection for drafting.
// Ported from _design/lexdraft/project/doc-schemas.jsx.
// Each schema lists the structured data the AI needs to compose that document.
// Fields ship with realistic defaults so the brief is usable immediately.

export type DocFieldType = 'text' | 'textarea' | 'select' | 'date' | 'number' | 'currency';

export interface DocField {
  key: string;
  label: string;
  type: DocFieldType;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  optional?: boolean;
  rows?: number;
  default?: string;
}

export interface DocSection {
  title: string;
  fields: DocField[];
}

export interface DocSchema {
  category: string;
  description: string;
  sections: DocSection[];
}

export const DOC_SCHEMAS: Record<string, DocSchema> = {
  'Notice u/s 138 NI Act': {
    category: 'Notice',
    description:
      'Statutory demand notice for a dishonoured cheque under Section 138 of the Negotiable Instruments Act, 1881.',
    sections: [
      {
        title: 'Drawer (Sender of Notice)',
        fields: [
          { key: 'sender_name', label: 'Payee name', type: 'text', placeholder: 'Full legal name of payee', required: true, default: 'Mehta Enterprises Pvt. Ltd.' },
          { key: 'sender_address', label: 'Payee address', type: 'textarea', rows: 2, required: true, default: 'Plot No. 14, Industrial Area Phase II,\nNaraina, New Delhi - 110028' },
          { key: 'sender_pan', label: 'PAN / GSTIN', type: 'text', placeholder: 'Optional', optional: true, default: '07AABCM4561K1ZP' },
        ],
      },
      {
        title: 'Drawee (Notice Recipient)',
        fields: [
          { key: 'recipient_name', label: 'Drawer name', type: 'text', placeholder: 'Person/entity who issued the cheque', required: true, default: 'Sandeep Verma' },
          { key: 'recipient_address', label: 'Drawer address', type: 'textarea', rows: 2, required: true, default: 'B-204, Greenwood Apartments,\nSector 47, Gurugram - 122018, Haryana' },
        ],
      },
      {
        title: 'Cheque Particulars',
        fields: [
          { key: 'cheque_no', label: 'Cheque number', type: 'text', placeholder: 'e.g. 000456789', required: true, default: '000456789' },
          { key: 'cheque_date', label: 'Cheque date', type: 'date', required: true, default: '2026-03-12' },
          { key: 'cheque_amount', label: 'Amount', type: 'currency', placeholder: '475000', required: true, default: '475000' },
          { key: 'drawee_bank', label: 'Drawee bank & branch', type: 'text', placeholder: 'e.g. HDFC Bank, Connaught Place, New Delhi', required: true, default: 'HDFC Bank, Connaught Place Branch, New Delhi' },
        ],
      },
      {
        title: 'Dishonour & Liability',
        fields: [
          { key: 'dishonour_date', label: 'Date of dishonour (return memo)', type: 'date', required: true, default: '2026-03-18' },
          {
            key: 'dishonour_reason',
            label: 'Reason for return',
            type: 'select',
            options: ['Funds Insufficient', 'Account Closed', 'Payment Stopped', 'Signature Differs', 'Refer to Drawer', 'Other'],
            required: true,
            default: 'Funds Insufficient',
          },
          {
            key: 'underlying_liability',
            label: 'Underlying transaction',
            type: 'textarea',
            rows: 3,
            placeholder: 'Brief: invoice / loan / contract reason for which the cheque was issued',
            required: true,
            default:
              'The cheque was issued towards part-payment of outstanding dues for industrial supplies delivered between January and February 2026 against Invoices INV/2025/1142 and INV/2026/0078.',
          },
          {
            key: 'invoice_refs',
            label: 'Invoice / agreement references',
            type: 'text',
            placeholder: 'e.g. Invoice INV/2025/1142 dated 14.02.2026',
            optional: true,
            default: 'Invoice INV/2025/1142 dated 14.02.2026; INV/2026/0078 dated 02.03.2026',
          },
        ],
      },
    ],
  },

  Plaint: {
    category: 'Pleading',
    description: 'Civil suit plaint under CPC - opens a civil action before a competent court.',
    sections: [
      {
        title: 'Court & Suit',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          {
            key: 'suit_type',
            label: 'Suit type',
            type: 'select',
            options: ['Suit for Recovery', 'Suit for Specific Performance', 'Suit for Declaration', 'Suit for Injunction', 'Suit for Partition', 'Other'],
            required: true,
            default: 'Suit for Recovery',
          },
          { key: 'suit_value', label: 'Suit valuation', type: 'currency', required: true, default: '950000' },
        ],
      },
      {
        title: 'Plaintiff',
        fields: [
          { key: 'plaintiff_name', label: 'Full name', type: 'text', required: true, default: 'Rohan Mehta' },
          { key: 'plaintiff_address', label: 'Address', type: 'textarea', rows: 2, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038, Karnataka' },
          { key: 'plaintiff_designation', label: 'Designation / Capacity', type: 'text', optional: true, default: 'Sole Proprietor of M/s Mehta Trading Co.' },
        ],
      },
      {
        title: 'Defendant',
        fields: [
          { key: 'defendant_name', label: 'Full name', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'defendant_address', label: 'Address', type: 'textarea', rows: 2, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043, Karnataka' },
          { key: 'defendant_designation', label: 'Designation / Capacity', type: 'text', optional: true, default: 'Through its Managing Director' },
        ],
      },
      {
        title: 'Cause of Action',
        fields: [
          {
            key: 'facts',
            label: 'Material facts',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              '1. The Plaintiff supplied steel and cement to the Defendant under purchase orders dated 04.05.2025 and 22.07.2025.\n2. Goods worth ₹9,50,000 were delivered against valid invoices and acknowledged by the Defendant.\n3. The Defendant agreed to pay within 45 days but has failed and neglected to make payment despite repeated demands and a legal notice dated 02.03.2026.',
          },
          { key: 'cause_date', label: 'Date cause of action arose', type: 'date', required: true, default: '2025-09-05' },
          {
            key: 'jurisdiction_basis',
            label: 'Basis of court jurisdiction',
            type: 'textarea',
            rows: 2,
            required: true,
            default:
              "The Defendant carries on business and the goods were delivered within the territorial jurisdiction of this Hon'ble Court at Bengaluru. The cause of action arose wholly within this jurisdiction.",
          },
          {
            key: 'limitation',
            label: 'Limitation note',
            type: 'text',
            optional: true,
            default: 'Within three years from the date of last acknowledgement, per Article 14 of the Limitation Act, 1963.',
          },
        ],
      },
      {
        title: 'Reliefs',
        fields: [
          {
            key: 'reliefs',
            label: 'Reliefs sought (one per line)',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'a) Decree the suit for ₹9,50,000 against the Defendant;\nb) Award interest at 12% p.a. from the date of suit till realisation;\nc) Award costs of the suit;\nd) Grant any other relief deemed fit in the interest of justice.',
          },
        ],
      },
    ],
  },

  Vakalatnama: {
    category: 'Authority',
    description: 'Memo of appearance authorising an advocate to represent a party.',
    sections: [
      {
        title: 'Court & Cause',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: "Hon'ble High Court of Karnataka at Bengaluru" },
          { key: 'case_title', label: 'Case title', type: 'text', required: true, default: 'Rohan Mehta v. M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'case_no', label: 'Case number / CNR', type: 'text', optional: true, default: 'W.P. No. 4892 of 2026 · CNR: KAHC01-004892-2026' },
        ],
      },
      {
        title: 'Client',
        fields: [
          { key: 'client_name', label: 'Client name', type: 'text', required: true, default: 'Rohan Mehta' },
          {
            key: 'client_capacity',
            label: 'Client capacity',
            type: 'select',
            options: ['Plaintiff', 'Defendant', 'Petitioner', 'Respondent', 'Appellant', 'Applicant', 'Accused', 'Complainant'],
            required: true,
            default: 'Petitioner',
          },
          { key: 'client_address', label: 'Client address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038, Karnataka' },
        ],
      },
      {
        title: 'Advocate',
        fields: [
          { key: 'advocate_name', label: 'Advocate name', type: 'text', required: true, default: 'Aarav Sharma' },
          { key: 'enrolment_no', label: 'Bar enrolment number', type: 'text', required: true, default: 'KAR/1842/2018' },
          {
            key: 'chamber_address',
            label: 'Chambers address',
            type: 'textarea',
            rows: 2,
            required: true,
            default: "Chamber No. 27, Advocates' Block,\nHigh Court Complex, Ambedkar Veedhi,\nBengaluru - 560001",
          },
        ],
      },
    ],
  },

  Affidavit: {
    category: 'Pleading',
    description: 'Sworn statement of facts - supporting an application or pleading.',
    sections: [
      {
        title: 'Deponent',
        fields: [
          { key: 'deponent_name', label: 'Deponent name', type: 'text', required: true, default: 'Rohan Mehta' },
          { key: 'deponent_age', label: 'Age', type: 'number', required: true, default: '38' },
          { key: 'deponent_father', label: 'S/o · D/o · W/o', type: 'text', required: true, default: 'S/o Late Shri Vinod Mehta' },
          { key: 'deponent_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038, Karnataka' },
          { key: 'deponent_occupation', label: 'Occupation', type: 'text', optional: true, default: 'Business - Sole Proprietor, M/s Mehta Trading Co.' },
        ],
      },
      {
        title: 'Sworn Statement',
        fields: [
          {
            key: 'purpose',
            label: 'Purpose of affidavit',
            type: 'text',
            required: true,
            default: 'In support of I.A. No. 234 of 2026 in O.S. No. 1247 of 2025 - application for temporary injunction.',
          },
          {
            key: 'paragraphs',
            label: 'Numbered paragraphs of fact (one per line)',
            type: 'textarea',
            rows: 8,
            required: true,
            default:
              "1. I am the Plaintiff in the above suit and am well acquainted with the facts of the case.\n2. I crave leave to refer to and rely upon the averments made in the plaint as if the same were set out herein verbatim.\n3. The Defendant, having received goods worth ₹9,50,000, is now attempting to alienate its assets to defeat any decree that may be passed in this suit.\n4. Unless this Hon'ble Court grants a temporary injunction restraining the Defendant from disposing of its assets, the suit will be rendered infructuous.\n5. I undertake to compensate the Defendant for any loss occasioned by such injunction, should the suit ultimately fail.",
          },
          { key: 'place_of_swearing', label: 'Place of swearing', type: 'text', required: true, default: 'Bengaluru' },
          { key: 'date_of_swearing', label: 'Date', type: 'date', required: true, default: '2026-04-22' },
        ],
      },
    ],
  },

  'Bail Application': {
    category: 'Criminal',
    description: 'Application seeking bail - regular, anticipatory, or interim.',
    sections: [
      {
        title: 'Court & FIR',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Sessions Judge, Saket District Courts, New Delhi' },
          {
            key: 'bail_type',
            label: 'Bail type',
            type: 'select',
            options: ['Regular bail (Sec 439 BNSS)', 'Anticipatory bail (Sec 482 BNSS)', 'Interim bail', 'Default bail (Sec 187(3) BNSS)'],
            required: true,
            default: 'Regular bail (Sec 439 BNSS)',
          },
          { key: 'fir_no', label: 'FIR number', type: 'text', required: true, default: 'FIR No. 0234 of 2026' },
          { key: 'police_station', label: 'Police station', type: 'text', required: true, default: 'P.S. Saket, South District, Delhi' },
          { key: 'sections', label: 'Sections invoked', type: 'text', required: true, default: 'Sections 318(4), 336(3) and 340(2) of the Bharatiya Nyaya Sanhita, 2023' },
        ],
      },
      {
        title: 'Accused',
        fields: [
          { key: 'accused_name', label: 'Full name', type: 'text', required: true, default: 'Sandeep Verma' },
          { key: 'accused_address', label: 'Address', type: 'textarea', rows: 2, default: 'B-204, Greenwood Apartments,\nSector 47, Gurugram - 122018, Haryana' },
          { key: 'accused_designation', label: 'Designation / Capacity', type: 'text', optional: true, default: 'Age 41 years, S/o Shri Mahesh Verma; Businessman' },
        ],
      },
      {
        title: 'Grounds',
        fields: [
          {
            key: 'arrest_status',
            label: 'Arrest status',
            type: 'select',
            options: ['In custody', 'Apprehending arrest', 'On notice', 'Released earlier'],
            required: true,
            default: 'In custody',
          },
          { key: 'custody_days', label: 'Days in custody (if applicable)', type: 'number', optional: true, default: '21' },
          {
            key: 'grounds',
            label: 'Grounds for bail',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              "a) The Applicant is innocent and has been falsely implicated owing to a commercial dispute;\nb) The investigation is substantially complete and the chargesheet has been filed; further custodial interrogation is unnecessary;\nc) The Applicant has clean antecedents and no criminal history;\nd) The Applicant is a permanent resident at the above address with deep roots in society and is not a flight risk;\ne) The Applicant is willing to abide by any conditions imposed by this Hon'ble Court including surrender of passport and weekly attendance.",
          },
          {
            key: 'sureties',
            label: 'Sureties offered',
            type: 'textarea',
            rows: 2,
            optional: true,
            default: 'Two local sureties of ₹1,00,000 each - Shri Anand Kapoor (Advocate) and Smt. Neha Verma (sister of the Applicant).',
          },
        ],
      },
    ],
  },

  'Written Statement': {
    category: 'Pleading',
    description: "Defendant's reply to a plaint under Order VIII CPC.",
    sections: [
      {
        title: 'Suit Reference',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'suit_no', label: 'Suit number / CNR', type: 'text', required: true, default: 'O.S. No. 1247 of 2025 · CNR: KAJU01-001247-2025' },
          { key: 'plaintiff_name', label: 'Plaintiff', type: 'text', required: true, default: 'Rohan Mehta' },
          { key: 'defendant_name', label: 'Defendant (your client)', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
        ],
      },
      {
        title: 'Defences',
        fields: [
          {
            key: 'preliminary_objections',
            label: 'Preliminary objections',
            type: 'textarea',
            rows: 4,
            optional: true,
            default:
              'a) The suit is barred by limitation, the alleged cause of action having arisen in May 2024;\nb) The plaint discloses no cause of action and is liable to be rejected under Order VII Rule 11 CPC;\nc) The valuation of the suit is incorrect and court fees are deficient.',
          },
          {
            key: 'admissions',
            label: 'Admissions (paragraphs admitted)',
            type: 'textarea',
            rows: 3,
            optional: true,
            default:
              'The contents of paragraphs 1 and 2 of the plaint regarding the identity and address of the parties are admitted as a matter of record. All other paragraphs are denied except those expressly admitted.',
          },
          {
            key: 'denials',
            label: 'Denials (paragraphs denied with reasons)',
            type: 'textarea',
            rows: 5,
            required: true,
            default:
              "The contents of paragraphs 3, 4 and 5 of the plaint are vehemently denied. The Defendant never placed the alleged purchase orders. The signatures on the documents annexed by the Plaintiff are forged. No goods were ever delivered to the Defendant's site. The alleged invoices are fabricated for the purposes of this suit.",
          },
          {
            key: 'additional_pleas',
            label: 'Additional pleas / counter-claim',
            type: 'textarea',
            rows: 4,
            optional: true,
            default:
              "Without prejudice, the Defendant counter-claims ₹2,00,000 towards reputational damage caused by the Plaintiff's false legal notice circulated in trade circles.",
          },
        ],
      },
    ],
  },
};

// Default fallback schema for doc types that aren't yet ported.
export const DEFAULT_SCHEMA: DocSchema = {
  category: 'General',
  description:
    'Generic legal document brief. Provide a short statement of the matter and the parties involved - the AI will compose a complete draft.',
  sections: [
    {
      title: 'Brief',
      fields: [
        { key: 'matter', label: 'Matter', type: 'textarea', rows: 5, required: true, placeholder: 'Summarise the dispute, transaction, or relief sought.' },
        { key: 'parties', label: 'Parties', type: 'text', placeholder: 'Names and roles of the parties involved.' },
      ],
    },
  ],
};

// Map old chip labels → new schema keys (for the picker UI).
export const DOC_TYPE_GROUPS: Array<{ group: string; items: string[] }> = [
  { group: 'Notices', items: ['Notice u/s 138 NI Act', 'Legal Notice'] },
  {
    group: 'Pleadings',
    items: ['Plaint', 'Written Statement', 'Replication / Rejoinder', 'Written Arguments', 'Affidavit', 'Evidence Affidavit', 'Appeal'],
  },
  { group: 'Applications', items: ['IA / Stay Application', 'Bail Application', 'Execution Petition', 'Caveat', 'RTI Application'] },
  { group: 'Authority', items: ['Vakalatnama', 'Settlement Agreement'] },
  { group: 'Letters', items: ['Correspondence'] },
  {
    group: 'Commercial Agreements',
    items: [
      'Sale Agreement / Sale Deed',
      'Lease / Rent / Tenancy Agreement',
      'Loan Agreement',
      'Mortgage Deed',
      'Hypothecation Deed',
      'Service Agreement',
      'Consultancy Agreement',
      'Employment Contract',
      'Non-Compete Agreement',
      'Memorandum of Understanding (MoU)',
      'Letter of Intent (LoI)',
      'Non-Disclosure Agreement (NDA)',
      'Distribution Agreement',
      'Franchise Agreement',
      'Licensing Agreement',
      'Construction / Works Contract',
      'Joint Venture Agreement',
    ],
  },
  {
    group: 'Corporate Agreements',
    items: [
      "Shareholders' Agreement (SHA)",
      'Share Purchase Agreement (SPA)',
      'Share Subscription Agreement (SSA)',
      'Asset Purchase Agreement',
      'Founder / Co-founder Agreement',
      'ESOP Grant Agreement',
      'Term Sheet',
      'Slump Sale Agreement',
    ],
  },
  {
    group: 'Property & Family',
    items: [
      'Gift Deed',
      'Partition Deed',
      'Relinquishment Deed',
      'Power of Attorney (General)',
      'Power of Attorney (Specific)',
      'Trust Deed',
      'Will',
      'Family Settlement Agreement',
      'Adoption Deed',
      'Pre-nuptial Agreement',
      'Post-nuptial Agreement',
    ],
  },
  {
    group: 'Specialised',
    items: [
      'Arbitration Agreement',
      'Indemnity Bond',
      'Guarantee Bond',
      'Pledge Agreement',
      'Insurance Contract',
    ],
  },
];

export function getSchema(docType: string): DocSchema {
  return DOC_SCHEMAS[docType] ?? DEFAULT_SCHEMA;
}
