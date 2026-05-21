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

  // ---------------------------------------------------------------------------
  // Commercial Agreements
  // ---------------------------------------------------------------------------

  'Sale Agreement / Sale Deed': {
    category: 'Commercial Agreement',
    description:
      'Conveys absolute title in immovable property from seller to buyer against full consideration. Governed by the Transfer of Property Act, 1882 and stamp / registration laws of the relevant State.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'seller_name', label: 'Seller / Vendor', type: 'text', required: true, default: 'Shri Ramesh Iyer, S/o Late Shri Krishnan Iyer' },
          { key: 'seller_address', label: 'Seller address', type: 'textarea', rows: 2, required: true, default: 'No. 11, Cunningham Road,\nBengaluru - 560052, Karnataka' },
          { key: 'seller_pan', label: 'Seller PAN / Aadhaar', type: 'text', required: true, default: 'AAFPI4521C / XXXX XXXX 1834' },
          { key: 'buyer_name', label: 'Buyer / Vendee', type: 'text', required: true, default: 'Smt. Priya Menon, W/o Shri Arjun Menon' },
          { key: 'buyer_address', label: 'Buyer address', type: 'textarea', rows: 2, required: true, default: 'Flat 4B, Brigade Meadows,\nKanakapura Road, Bengaluru - 560082' },
          { key: 'buyer_pan', label: 'Buyer PAN / Aadhaar', type: 'text', required: true, default: 'BNZPM1187R / XXXX XXXX 4512' },
        ],
      },
      {
        title: 'Schedule Property',
        fields: [
          {
            key: 'property_description',
            label: 'Property description (Schedule "A")',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'All that piece and parcel of residential property bearing Site No. 27, measuring 2,400 sq. ft., situated at Sy. No. 142/2, Bilekahalli Village, Begur Hobli, Bengaluru South Taluk, within the limits of BBMP Ward No. 192, bounded as follows:\nNorth: Site No. 28  South: Site No. 26  East: 30-ft BBMP Road  West: Private Property of Sri G. Suresh.',
          },
          { key: 'survey_no', label: 'Survey / Khata number', type: 'text', required: true, default: 'Sy. No. 142/2 · Khata No. 1928/192/142-2' },
          { key: 'built_up_area', label: 'Built-up area (sq. ft.)', type: 'number', optional: true, default: '1850' },
          { key: 'land_area', label: 'Land area (sq. ft.)', type: 'number', required: true, default: '2400' },
        ],
      },
      {
        title: 'Consideration & Payment',
        fields: [
          { key: 'sale_consideration', label: 'Total sale consideration', type: 'currency', required: true, default: '12500000' },
          { key: 'advance_paid', label: 'Advance / earnest money paid', type: 'currency', optional: true, default: '1250000' },
          { key: 'advance_date', label: 'Date of advance', type: 'date', optional: true, default: '2026-03-10' },
          { key: 'balance_payment_mode', label: 'Mode of balance payment', type: 'select', options: ['RTGS / NEFT', 'Bank Draft', 'Cheque', 'Mixed'], required: true, default: 'RTGS / NEFT' },
          { key: 'tds_compliance', label: 'TDS u/s 194-IA compliance', type: 'text', optional: true, default: '1% TDS deducted by Buyer and remitted vide Form 26QB on or before execution.' },
        ],
      },
      {
        title: 'Title, Encumbrances & Delivery',
        fields: [
          {
            key: 'chain_of_title',
            label: 'Chain of title (acquisition by Seller)',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'The Seller acquired the Schedule Property by virtue of registered Sale Deed dated 14.08.2009, registered as Document No. 4827/2009-10, Book-I, Vol. 312, at Sub-Registrar Office, Begur, Bengaluru.',
          },
          { key: 'encumbrance_status', label: 'Encumbrance status', type: 'textarea', rows: 2, required: true, default: 'The Schedule Property is free from all encumbrances, mortgages, liens, attachments, court / acquisition proceedings, as confirmed by EC No. 4521/2026 dated 28.03.2026.' },
          { key: 'possession_date', label: 'Date of possession', type: 'date', required: true, default: '2026-05-22' },
          { key: 'jurisdiction', label: 'Sub-Registrar / jurisdiction', type: 'text', required: true, default: 'Sub-Registrar Office, Begur, Bengaluru' },
        ],
      },
    ],
  },

  'Lease / Rent / Tenancy Agreement': {
    category: 'Commercial Agreement',
    description:
      'Creates a leasehold interest over immovable property for a defined term and rent. Governed by Sections 105-117 of the Transfer of Property Act, 1882 and applicable Rent Control statutes.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'lessor_name', label: 'Lessor / Landlord', type: 'text', required: true, default: 'Shri Anil Kapoor, S/o Late Shri R.K. Kapoor' },
          { key: 'lessor_address', label: 'Lessor address', type: 'textarea', rows: 2, required: true, default: 'B-12, Greater Kailash-I,\nNew Delhi - 110048' },
          { key: 'lessee_name', label: 'Lessee / Tenant', type: 'text', required: true, default: 'M/s Aurora Designs LLP' },
          { key: 'lessee_address', label: 'Lessee address / registered office', type: 'textarea', rows: 2, required: true, default: '4th Floor, Block D, Cyber Hub,\nGurugram - 122002, Haryana' },
        ],
      },
      {
        title: 'Demised Premises',
        fields: [
          {
            key: 'premises',
            label: 'Description of premises',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'Ground Floor + First Floor of Property No. C-44, Defence Colony, New Delhi - 110024, admeasuring approximately 2,800 sq. ft. carpet area, with two covered car parks and shared terrace rights as per the building plan annexed.',
          },
          { key: 'purpose', label: 'Permitted use', type: 'select', options: ['Residential', 'Commercial - Office', 'Commercial - Retail', 'Industrial', 'Mixed Use'], required: true, default: 'Commercial - Office' },
          { key: 'furnishing', label: 'Furnishing status', type: 'select', options: ['Bare shell', 'Semi-furnished', 'Fully furnished'], required: true, default: 'Semi-furnished' },
        ],
      },
      {
        title: 'Term & Rent',
        fields: [
          { key: 'commencement_date', label: 'Commencement date', type: 'date', required: true, default: '2026-06-01' },
          { key: 'lease_term', label: 'Lease term (months)', type: 'number', required: true, default: '36' },
          { key: 'lock_in_months', label: 'Lock-in period (months)', type: 'number', optional: true, default: '12' },
          { key: 'monthly_rent', label: 'Monthly rent', type: 'currency', required: true, default: '185000' },
          { key: 'escalation', label: 'Escalation clause', type: 'text', optional: true, default: '7% over the previous year, every 12 months' },
          { key: 'security_deposit', label: 'Refundable security deposit', type: 'currency', required: true, default: '1110000' },
          { key: 'maintenance_charges', label: 'Maintenance / CAM charges', type: 'text', optional: true, default: '₹15/sq.ft./month payable to RWA, on the Lessee' },
        ],
      },
      {
        title: 'Termination & Jurisdiction',
        fields: [
          { key: 'notice_period_days', label: 'Termination notice (days)', type: 'number', required: true, default: '90' },
          { key: 'permitted_alterations', label: 'Permitted alterations', type: 'textarea', rows: 2, optional: true, default: 'Non-structural fit-outs permitted with the Lessor\'s prior written approval; original fixtures to be restored on expiry.' },
          { key: 'governing_law', label: 'Governing law & jurisdiction', type: 'text', required: true, default: 'Indian law; courts at New Delhi shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Loan Agreement': {
    category: 'Commercial Agreement',
    description:
      'Records the terms of a money loan between lender and borrower. Subject to the Indian Contract Act, 1872, RBI directions where applicable, and the Usurious Loans Act, 1918.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'lender_name', label: 'Lender', type: 'text', required: true, default: 'M/s Bluestone Capital Advisors Pvt. Ltd.' },
          { key: 'lender_address', label: 'Lender registered office', type: 'textarea', rows: 2, required: true, default: '801, Lodha Excelus,\nApollo Mills Compound, Mahalaxmi,\nMumbai - 400011' },
          { key: 'borrower_name', label: 'Borrower', type: 'text', required: true, default: 'Shri Karan Bhatia, S/o Shri Mukesh Bhatia' },
          { key: 'borrower_address', label: 'Borrower address', type: 'textarea', rows: 2, required: true, default: '14, Pali Hill, Bandra (W),\nMumbai - 400050, Maharashtra' },
        ],
      },
      {
        title: 'Loan Terms',
        fields: [
          { key: 'principal_amount', label: 'Principal amount', type: 'currency', required: true, default: '5000000' },
          { key: 'disbursement_mode', label: 'Disbursement mode', type: 'select', options: ['RTGS', 'NEFT', 'Bank Draft', 'Cheque'], required: true, default: 'RTGS' },
          { key: 'disbursement_date', label: 'Date of disbursement', type: 'date', required: true, default: '2026-05-15' },
          { key: 'purpose', label: 'Purpose of loan', type: 'textarea', rows: 2, required: true, default: 'Working capital for the Borrower\'s proprietary business carried on under the trade name "Bhatia Trading Co."' },
          { key: 'interest_rate', label: 'Interest rate (% p.a.)', type: 'number', required: true, default: '12' },
          { key: 'interest_type', label: 'Interest type', type: 'select', options: ['Simple', 'Compound (monthly)', 'Compound (quarterly)', 'Compound (annual)'], required: true, default: 'Compound (monthly)' },
        ],
      },
      {
        title: 'Repayment & Security',
        fields: [
          { key: 'tenure_months', label: 'Tenure (months)', type: 'number', required: true, default: '36' },
          { key: 'emi_amount', label: 'EMI amount', type: 'currency', optional: true, default: '166075' },
          { key: 'repayment_start', label: 'First instalment due', type: 'date', required: true, default: '2026-06-15' },
          { key: 'prepayment', label: 'Prepayment terms', type: 'text', optional: true, default: 'Prepayment permitted after 12 months without penalty.' },
          { key: 'security', label: 'Security / collateral', type: 'textarea', rows: 2, optional: true, default: 'Personal guarantee of Smt. Mira Bhatia (spouse) and 8 post-dated cheques covering principal.' },
          { key: 'default_rate', label: 'Penal interest on default', type: 'text', optional: true, default: '2% per month over and above the agreed rate, on all overdue amounts.' },
        ],
      },
      {
        title: 'Governing Law',
        fields: [
          { key: 'jurisdiction', label: 'Jurisdiction / dispute resolution', type: 'text', required: true, default: 'Courts at Mumbai shall have exclusive jurisdiction; disputes referrable to arbitration u/s 7 of the Arbitration & Conciliation Act, 1996 at the Lender\'s option.' },
        ],
      },
    ],
  },

  'Mortgage Deed': {
    category: 'Commercial Agreement',
    description:
      'Creates a mortgage over immovable property to secure repayment of a debt. Governed by Sections 58-104 of the Transfer of Property Act, 1882; requires registration under the Registration Act, 1908.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'mortgagor_name', label: 'Mortgagor', type: 'text', required: true, default: 'Shri Vivek Sharma, S/o Shri Ravinder Sharma' },
          { key: 'mortgagor_address', label: 'Mortgagor address', type: 'textarea', rows: 2, required: true, default: '32-A, Lawrence Road,\nAmritsar - 143001, Punjab' },
          { key: 'mortgagee_name', label: 'Mortgagee', type: 'text', required: true, default: 'Canara Bank, Civil Lines Branch, Amritsar' },
          { key: 'mortgagee_address', label: 'Mortgagee address', type: 'textarea', rows: 2, required: true, default: 'Canara Bank, Civil Lines,\nAmritsar - 143001, Punjab' },
        ],
      },
      {
        title: 'Mortgage Details',
        fields: [
          {
            key: 'mortgage_type',
            label: 'Type of mortgage',
            type: 'select',
            options: ['Simple Mortgage', 'Mortgage by Conditional Sale', 'Usufructuary Mortgage', 'English Mortgage', 'Mortgage by Deposit of Title Deeds (Equitable)', 'Anomalous Mortgage'],
            required: true,
            default: 'Simple Mortgage',
          },
          { key: 'principal_debt', label: 'Principal sum secured', type: 'currency', required: true, default: '7500000' },
          { key: 'interest_rate', label: 'Interest rate (% p.a.)', type: 'number', required: true, default: '10.5' },
          { key: 'repayment_period', label: 'Repayment period (months)', type: 'number', required: true, default: '120' },
        ],
      },
      {
        title: 'Schedule Property',
        fields: [
          {
            key: 'property_description',
            label: 'Description of mortgaged property',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Residential plot bearing No. 45, Sector 11-B, GT Road, Amritsar, admeasuring 250 sq. yards, bounded as follows:\nNorth: Plot No. 46  South: Plot No. 44  East: 40-ft Sector Road  West: Plot No. 45-A.',
          },
          { key: 'title_documents', label: 'Title documents deposited', type: 'textarea', rows: 2, required: true, default: 'Original Sale Deed dated 06.07.2014 (Doc. No. 7821/2014, Sub-Registrar Amritsar); Mutation Order; latest property tax receipts.' },
          { key: 'sub_registrar', label: 'Sub-Registrar of registration', type: 'text', required: true, default: 'Sub-Registrar Office, Amritsar (Urban)' },
        ],
      },
      {
        title: 'Default & Remedies',
        fields: [
          { key: 'default_consequences', label: 'Consequences of default', type: 'textarea', rows: 3, required: true, default: 'On default, the Mortgagee shall be entitled to enforce the mortgage by sale of the property through court / SARFAESI proceedings and recover the dues with interest and costs.' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Amritsar / DRT Chandigarh shall have jurisdiction.' },
        ],
      },
    ],
  },

  'Hypothecation Deed': {
    category: 'Commercial Agreement',
    description:
      'Creates a charge over movable assets (stock, receivables, equipment) without transfer of possession. Read with Section 2(n) SARFAESI Act, 2002.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'hypothecator_name', label: 'Hypothecator / Borrower', type: 'text', required: true, default: 'M/s Sunrise Auto Components Pvt. Ltd.' },
          { key: 'hypothecator_address', label: 'Hypothecator registered office', type: 'textarea', rows: 2, required: true, default: 'Plot 88, MIDC Phase II,\nChakan, Pune - 410501' },
          { key: 'hypothecatee_name', label: 'Hypothecatee / Lender', type: 'text', required: true, default: 'HDFC Bank Ltd., Corporate Banking Branch, Pune' },
          { key: 'hypothecatee_address', label: 'Hypothecatee address', type: 'textarea', rows: 2, required: true, default: 'HDFC Bank Ltd., Bund Garden Road,\nPune - 411001' },
        ],
      },
      {
        title: 'Facility',
        fields: [
          { key: 'facility_amount', label: 'Facility amount', type: 'currency', required: true, default: '25000000' },
          { key: 'facility_type', label: 'Facility type', type: 'select', options: ['Cash Credit', 'Working Capital Demand Loan', 'Term Loan', 'Overdraft', 'Bill Discounting'], required: true, default: 'Cash Credit' },
          { key: 'interest_rate', label: 'Interest rate (% p.a.)', type: 'text', required: true, default: '1-Year MCLR + 2.25% (currently 11.10% p.a.), reset annually' },
          { key: 'sanction_letter_ref', label: 'Sanction letter reference', type: 'text', required: true, default: 'Sanction Letter Ref. CB/PUN/2026/4421 dated 02.04.2026' },
        ],
      },
      {
        title: 'Hypothecated Assets',
        fields: [
          {
            key: 'asset_description',
            label: 'Description of hypothecated assets',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'All present and future stock-in-trade (raw materials, WIP, finished goods) and book debts of the Hypothecator lying at the registered office, factory premises at Plot 88, MIDC Chakan, and any other godown / godowns of the Hypothecator.',
          },
          { key: 'margin', label: 'Margin requirement', type: 'text', required: true, default: '25% on stock, 30% on book debts not older than 90 days' },
          { key: 'inspection_rights', label: 'Inspection rights', type: 'textarea', rows: 2, optional: true, default: 'The Hypothecatee may inspect the assets / books at any reasonable time on prior notice; stock statements shall be filed monthly.' },
        ],
      },
      {
        title: 'Default & Jurisdiction',
        fields: [
          { key: 'events_of_default', label: 'Events of default', type: 'textarea', rows: 3, required: true, default: 'a) Non-payment of any instalment for 30 days;\nb) Insolvency proceedings against Hypothecator;\nc) Material breach of representations;\nd) Removal of hypothecated assets without consent.' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Pune / DRT, Pune shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Service Agreement': {
    category: 'Commercial Agreement',
    description:
      'Engagement of a service provider on a non-employee basis to deliver defined services. Governed by the Indian Contract Act, 1872 and applicable GST/TDS laws.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'client_name', label: 'Client', type: 'text', required: true, default: 'Nexora Software Pvt. Ltd.' },
          { key: 'client_address', label: 'Client registered office', type: 'textarea', rows: 2, required: true, default: 'Level 6, RMZ Ecoworld,\nMarathahalli-Sarjapur Outer Ring Road,\nBengaluru - 560103' },
          { key: 'provider_name', label: 'Service Provider', type: 'text', required: true, default: 'M/s Indigo Cloud Services LLP' },
          { key: 'provider_address', label: 'Provider registered office', type: 'textarea', rows: 2, required: true, default: '402, Innov8 Coworking,\nKoramangala 4th Block,\nBengaluru - 560034' },
        ],
      },
      {
        title: 'Scope of Services',
        fields: [
          {
            key: 'services_description',
            label: 'Description of services',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Managed AWS infrastructure services covering: (i) 24x7 monitoring; (ii) patching & OS updates; (iii) DR drills every quarter; (iv) IAM hardening; (v) monthly compliance reports. SLA matrix as per Annexure-A.',
          },
          { key: 'deliverables', label: 'Deliverables / milestones', type: 'textarea', rows: 3, optional: true, default: 'Monthly SLA reports; quarterly DR drill report; annual SOC2-aligned compliance memo.' },
          { key: 'service_levels', label: 'Service levels / KPIs', type: 'text', optional: true, default: '99.9% uptime; P1 incident response within 15 minutes; root cause analysis within 48 hours.' },
        ],
      },
      {
        title: 'Term & Fees',
        fields: [
          { key: 'start_date', label: 'Commencement date', type: 'date', required: true, default: '2026-06-01' },
          { key: 'term_months', label: 'Initial term (months)', type: 'number', required: true, default: '24' },
          { key: 'renewal', label: 'Renewal terms', type: 'text', optional: true, default: 'Auto-renewal for 12-month terms unless either party gives 60 days\' notice.' },
          { key: 'fees', label: 'Service fees', type: 'currency', required: true, default: '450000' },
          { key: 'fee_basis', label: 'Fee basis', type: 'select', options: ['Monthly retainer', 'Fixed project fee', 'Hourly / time-and-material', 'Milestone-based'], required: true, default: 'Monthly retainer' },
          { key: 'tax_handling', label: 'Taxes & TDS', type: 'text', optional: true, default: 'GST extra at applicable rate; Client to deduct TDS u/s 194-J as applicable.' },
        ],
      },
      {
        title: 'Termination & IP',
        fields: [
          { key: 'termination_notice_days', label: 'Termination notice (days)', type: 'number', required: true, default: '60' },
          { key: 'ip_ownership', label: 'IP ownership', type: 'textarea', rows: 2, required: true, default: 'All work product, deliverables and derivatives shall vest with the Client on payment. Provider retains background IP and the right to reuse generic methodologies.' },
          { key: 'confidentiality', label: 'Confidentiality term', type: 'text', optional: true, default: 'Survives for 3 years post-termination; trade secrets indefinite.' },
          { key: 'jurisdiction', label: 'Governing law & jurisdiction', type: 'text', required: true, default: 'Indian law; courts at Bengaluru shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Consultancy Agreement': {
    category: 'Commercial Agreement',
    description:
      'Engagement of an independent consultant for advisory or specialist work, distinct from an employer-employee relationship. Read with Section 194-J of the Income-tax Act, 1961.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'client_name', label: 'Client / Engager', type: 'text', required: true, default: 'M/s Arclight Health Ventures Pvt. Ltd.' },
          { key: 'client_address', label: 'Client address', type: 'textarea', rows: 2, required: true, default: 'A-201, BKC Phase 3,\nBandra-Kurla Complex,\nMumbai - 400051' },
          { key: 'consultant_name', label: 'Consultant', type: 'text', required: true, default: 'Dr. Aishwarya Pillai' },
          { key: 'consultant_address', label: 'Consultant address', type: 'textarea', rows: 2, required: true, default: '17, Hiranandani Estate, Powai,\nMumbai - 400076' },
          { key: 'consultant_pan', label: 'Consultant PAN / GSTIN', type: 'text', optional: true, default: 'AVTPP4456R / 27AVTPP4456R1Z9' },
        ],
      },
      {
        title: 'Scope',
        fields: [
          {
            key: 'scope_of_work',
            label: 'Scope of consultancy',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Strategic advisory on clinical-trial design and regulatory pathway for the Client\'s lead oncology asset, including CDSCO submission strategy, GCP audit-readiness assessment, and KOL engagement plan. Deliverables per workplan in Annexure-A.',
          },
          { key: 'time_commitment', label: 'Expected time commitment', type: 'text', optional: true, default: 'Approx. 24 hours per month; on-site days at Mumbai once per month.' },
          { key: 'reporting_to', label: 'Reports to', type: 'text', optional: true, default: 'Chief Scientific Officer of the Client' },
        ],
      },
      {
        title: 'Term & Fees',
        fields: [
          { key: 'start_date', label: 'Start date', type: 'date', required: true, default: '2026-06-15' },
          { key: 'term', label: 'Term', type: 'text', required: true, default: '12 months, extendable by mutual written consent' },
          { key: 'fees', label: 'Professional fee', type: 'currency', required: true, default: '600000' },
          { key: 'fee_basis', label: 'Fee basis', type: 'select', options: ['Monthly retainer', 'Per hour', 'Per deliverable', 'Lump sum'], required: true, default: 'Monthly retainer' },
          { key: 'expenses', label: 'Reimbursable expenses', type: 'textarea', rows: 2, optional: true, default: 'Pre-approved travel, accommodation and per-diem reimbursable at actuals against invoices.' },
        ],
      },
      {
        title: 'Independence & Confidentiality',
        fields: [
          { key: 'relationship_status', label: 'Nature of relationship', type: 'text', required: true, default: 'Independent contractor; nothing herein creates an employer-employee, partnership or agency relationship.' },
          { key: 'confidentiality_term_years', label: 'Confidentiality term (years post-termination)', type: 'number', required: true, default: '3' },
          { key: 'non_solicit_months', label: 'Non-solicit (months post-termination)', type: 'number', optional: true, default: '12' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Mumbai shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Employment Contract': {
    category: 'Commercial Agreement',
    description:
      'Records the terms of employment between employer and employee. Subject to the Industrial Employment (Standing Orders) Act, 1946, Shops & Establishment statutes, and the Code on Wages, 2019.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'employer_name', label: 'Employer', type: 'text', required: true, default: 'Sentinel Analytics Pvt. Ltd.' },
          { key: 'employer_address', label: 'Employer registered office', type: 'textarea', rows: 2, required: true, default: 'Tower B, 9th Floor,\nDLF Cyber City Phase III,\nGurugram - 122002' },
          { key: 'employee_name', label: 'Employee', type: 'text', required: true, default: 'Shri Aditya Bansal' },
          { key: 'employee_address', label: 'Employee address', type: 'textarea', rows: 2, required: true, default: 'F-302, Vatika India Next,\nSector 82A, Gurugram - 122012' },
          { key: 'employee_id_no', label: 'PAN / Aadhaar', type: 'text', optional: true, default: 'AQPBG7723P / XXXX XXXX 4218' },
        ],
      },
      {
        title: 'Position & Term',
        fields: [
          { key: 'designation', label: 'Designation', type: 'text', required: true, default: 'Senior Data Engineer' },
          { key: 'department', label: 'Department / function', type: 'text', optional: true, default: 'Platform Engineering' },
          { key: 'reporting_to', label: 'Reporting manager', type: 'text', optional: true, default: 'VP, Engineering' },
          { key: 'start_date', label: 'Date of joining', type: 'date', required: true, default: '2026-06-15' },
          { key: 'employment_type', label: 'Employment type', type: 'select', options: ['Permanent - Full Time', 'Permanent - Part Time', 'Fixed Term', 'Probationary', 'Contractual'], required: true, default: 'Permanent - Full Time' },
          { key: 'probation_months', label: 'Probation period (months)', type: 'number', optional: true, default: '6' },
        ],
      },
      {
        title: 'Compensation',
        fields: [
          { key: 'ctc', label: 'Annual CTC', type: 'currency', required: true, default: '2800000' },
          { key: 'pay_cycle', label: 'Pay cycle', type: 'select', options: ['Monthly', 'Bi-weekly', 'Weekly'], required: true, default: 'Monthly' },
          { key: 'variable_pay', label: 'Variable / performance bonus', type: 'text', optional: true, default: 'Up to 15% of fixed CTC, payable annually subject to individual + company performance.' },
          { key: 'esop_eligibility', label: 'ESOP / equity eligibility', type: 'text', optional: true, default: '1,500 stock options vesting 1-year cliff + 3-year quarterly, per ESOP Plan 2023.' },
          { key: 'benefits', label: 'Benefits', type: 'textarea', rows: 2, optional: true, default: 'Group medical (₹5L family floater); group accident; gratuity per the Payment of Gratuity Act, 1972; PF & ESI as applicable.' },
        ],
      },
      {
        title: 'Restrictions & Termination',
        fields: [
          { key: 'working_hours', label: 'Working hours / location', type: 'text', optional: true, default: '9 hours/day inclusive of breaks; hybrid - 3 days/week in office.' },
          { key: 'leave_policy_ref', label: 'Leave policy', type: 'text', optional: true, default: 'Per Employee Handbook v4 - 18 PL + 12 CL + 8 SL per annum.' },
          { key: 'confidentiality', label: 'Confidentiality undertaking', type: 'text', required: true, default: 'Survives termination indefinitely for trade secrets; 2 years for general confidential information.' },
          { key: 'non_compete_months', label: 'Non-compete (months)', type: 'number', optional: true, default: '12' },
          { key: 'non_solicit_months', label: 'Non-solicitation (months)', type: 'number', optional: true, default: '12' },
          { key: 'notice_period_days', label: 'Notice period (days)', type: 'number', required: true, default: '60' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Gurugram shall have jurisdiction.' },
        ],
      },
    ],
  },

  'Non-Compete Agreement': {
    category: 'Commercial Agreement',
    description:
      'Restricts a party from competing with another during and (where enforceable) after a defined period. Section 27 of the Indian Contract Act, 1872 voids post-employment restraints except sale-of-goodwill cases (Niranjan Shankar Golikari).',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'beneficiary_name', label: 'Beneficiary (in whose favour)', type: 'text', required: true, default: 'Helixon Labs Pvt. Ltd.' },
          { key: 'beneficiary_address', label: 'Beneficiary address', type: 'textarea', rows: 2, required: true, default: 'Plot 12, IT Park,\nBangalore - 560100' },
          { key: 'covenantor_name', label: 'Covenantor (restricted party)', type: 'text', required: true, default: 'Shri Mukund Rao' },
          { key: 'covenantor_address', label: 'Covenantor address', type: 'textarea', rows: 2, required: true, default: '24, 14th Cross, Jayanagar 4th Block,\nBengaluru - 560011' },
        ],
      },
      {
        title: 'Underlying Transaction',
        fields: [
          {
            key: 'underlying_relationship',
            label: 'Underlying relationship / consideration',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'The Covenantor is selling his 100% stake in M/s Helixon Bio Pvt. Ltd. (target) to the Beneficiary vide Share Purchase Agreement dated 02.05.2026 for a total consideration of ₹18 crore, of which ₹2 crore is attributable to non-compete.',
          },
          { key: 'consideration_amount', label: 'Non-compete consideration', type: 'currency', optional: true, default: '20000000' },
        ],
      },
      {
        title: 'Restrictions',
        fields: [
          {
            key: 'restricted_activities',
            label: 'Restricted activities',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'Carrying on, or being engaged or interested directly or indirectly in, any business of (i) molecular diagnostics; (ii) precision-oncology assays; or (iii) any business that competes with the Beneficiary\'s products listed in Schedule-1.',
          },
          { key: 'restriction_territory', label: 'Territorial scope', type: 'text', required: true, default: 'India (including all Union Territories)' },
          { key: 'restriction_duration_months', label: 'Duration (months)', type: 'number', required: true, default: '36' },
          { key: 'carve_outs', label: 'Carve-outs / permitted activities', type: 'textarea', rows: 2, optional: true, default: 'Holding up to 1% of the listed shares of any publicly traded company is permitted.' },
        ],
      },
      {
        title: 'Remedies',
        fields: [
          { key: 'injunctive_relief', label: 'Injunctive relief clause', type: 'text', optional: true, default: 'The Beneficiary may seek injunctive relief without proof of actual damage in addition to damages.' },
          { key: 'liquidated_damages', label: 'Liquidated damages', type: 'currency', optional: true, default: '5000000' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Bengaluru shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Memorandum of Understanding (MoU)': {
    category: 'Commercial Agreement',
    description:
      'Records a non-binding (or partly binding) understanding between parties intending to formalise a transaction. Binding clauses (confidentiality, exclusivity, governing law) are clearly carved out.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'party_a_name', label: 'Party A', type: 'text', required: true, default: 'Northwind Logistics Pvt. Ltd.' },
          { key: 'party_a_address', label: 'Party A address', type: 'textarea', rows: 2, required: true, default: 'Office 14, World Trade Center,\nKharadi, Pune - 411014' },
          { key: 'party_b_name', label: 'Party B', type: 'text', required: true, default: 'OceanRoute Shipping LLP' },
          { key: 'party_b_address', label: 'Party B address', type: 'textarea', rows: 2, required: true, default: '5th Floor, Marathon Futurex,\nLower Parel, Mumbai - 400013' },
        ],
      },
      {
        title: 'Understanding',
        fields: [
          { key: 'purpose', label: 'Purpose / proposed transaction', type: 'textarea', rows: 3, required: true, default: 'Parties propose to set up a joint last-mile cold-chain network for pharmaceutical distribution across western India, with capital and operational responsibilities to be defined in a definitive JV agreement.' },
          { key: 'roles', label: 'Indicative roles & responsibilities', type: 'textarea', rows: 3, optional: true, default: 'Party A: cold-chain infrastructure, vehicles, ground operations.\nParty B: shipping coordination, port-side handling, customer relationships.' },
          { key: 'exclusivity', label: 'Exclusivity period', type: 'text', optional: true, default: 'Parties shall negotiate exclusively for 90 days from the effective date.' },
        ],
      },
      {
        title: 'Binding vs Non-binding',
        fields: [
          { key: 'effective_date', label: 'Effective date', type: 'date', required: true, default: '2026-05-20' },
          {
            key: 'binding_clauses',
            label: 'Binding clauses',
            type: 'textarea',
            rows: 2,
            required: true,
            default: 'Confidentiality, exclusivity, expenses, governing law and jurisdiction are binding. All other clauses are non-binding statements of intent.',
          },
          { key: 'expiry', label: 'Expiry / lapse', type: 'text', optional: true, default: 'Lapses 120 days from effective date unless extended by mutual written consent.' },
        ],
      },
      {
        title: 'Boilerplate',
        fields: [
          { key: 'confidentiality_term_years', label: 'Confidentiality (years)', type: 'number', required: true, default: '2' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Indian law; courts at Mumbai shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Letter of Intent (LoI)': {
    category: 'Commercial Agreement',
    description:
      'Buyer\'s non-binding expression of intent to enter into a transaction, typically used in M&A or large procurement deals before definitive documents are signed.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'buyer_name', label: 'Issuing party / Buyer', type: 'text', required: true, default: 'Trishul Capital Partners II LP' },
          { key: 'buyer_address', label: 'Buyer address', type: 'textarea', rows: 2, required: true, default: 'Maker Maxity, North Avenue,\nBandra-Kurla Complex, Mumbai - 400051' },
          { key: 'target_name', label: 'Recipient / Target', type: 'text', required: true, default: 'M/s Vivaan Foods Pvt. Ltd.' },
          { key: 'target_address', label: 'Target registered office', type: 'textarea', rows: 2, required: true, default: 'Plot No. 22, Food Park,\nVithalapur, Mehsana - 382728, Gujarat' },
        ],
      },
      {
        title: 'Proposed Transaction',
        fields: [
          {
            key: 'transaction_summary',
            label: 'Proposed transaction',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'Acquisition of 51% of the fully diluted share capital of the Target by the Buyer for an indicative enterprise value of ₹220 crore on a cash-free, debt-free basis, subject to due diligence and customary closing conditions.',
          },
          { key: 'indicative_consideration', label: 'Indicative consideration', type: 'currency', optional: true, default: '2200000000' },
          { key: 'conditions_precedent', label: 'Key conditions precedent', type: 'textarea', rows: 3, optional: true, default: 'Satisfactory financial, legal and tax due diligence; CCI approval; receipt of all regulatory consents; no material adverse change.' },
        ],
      },
      {
        title: 'Process & Exclusivity',
        fields: [
          { key: 'exclusivity_days', label: 'Exclusivity period (days)', type: 'number', required: true, default: '90' },
          { key: 'dd_period_days', label: 'Due-diligence window (days)', type: 'number', optional: true, default: '60' },
          { key: 'expense_allocation', label: 'Expense allocation', type: 'text', optional: true, default: 'Each party bears its own expenses; break-fee of ₹2 crore payable by Target on wilful breach of exclusivity.' },
        ],
      },
      {
        title: 'Binding Clauses',
        fields: [
          {
            key: 'binding_clauses',
            label: 'Binding provisions',
            type: 'textarea',
            rows: 2,
            required: true,
            default: 'Confidentiality, exclusivity, expense allocation, governing law and jurisdiction are binding. All other provisions are non-binding and subject to definitive documentation.',
          },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Indian law; courts at Mumbai shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Non-Disclosure Agreement (NDA)': {
    category: 'Commercial Agreement',
    description:
      'Protects confidential information shared between parties for a specified purpose. Enforceable under Section 27 of the Indian Contract Act read with common-law principles on equitable confidence.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'disclosing_party', label: 'Disclosing party', type: 'text', required: true, default: 'Lumina AI Labs Pvt. Ltd.' },
          { key: 'disclosing_address', label: 'Disclosing party address', type: 'textarea', rows: 2, required: true, default: '2nd Floor, WeWork Forum,\nDLF Cyber City, Gurugram - 122002' },
          { key: 'receiving_party', label: 'Receiving party', type: 'text', required: true, default: 'Boreal Capital Advisors LLP' },
          { key: 'receiving_address', label: 'Receiving party address', type: 'textarea', rows: 2, required: true, default: '7th Floor, One BKC,\nBandra-Kurla Complex, Mumbai - 400051' },
          { key: 'mutual', label: 'Mutual or one-way?', type: 'select', options: ['One-way (only Disclosing party shares)', 'Mutual (both parties share)'], required: true, default: 'One-way (only Disclosing party shares)' },
        ],
      },
      {
        title: 'Confidential Information',
        fields: [
          { key: 'purpose', label: 'Purpose of disclosure', type: 'textarea', rows: 2, required: true, default: 'Evaluation of a potential Series-B equity investment by the Receiving party into the Disclosing party.' },
          {
            key: 'definition',
            label: 'Scope of confidential information',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'All non-public technical, financial, commercial, operational, customer, employee and strategy information shared in any form, including model weights, training data composition, pricing schedules, financial projections and board minutes.',
          },
          { key: 'exclusions', label: 'Standard exclusions', type: 'textarea', rows: 2, optional: true, default: 'Publicly known information; information already known to receiver without obligation; independently developed; required to be disclosed by law (with notice).' },
        ],
      },
      {
        title: 'Obligations & Term',
        fields: [
          { key: 'permitted_use', label: 'Permitted use', type: 'text', required: true, default: 'Strictly limited to the Purpose; no commercial exploitation; no third-party disclosure save to advisers on a need-to-know basis.' },
          { key: 'standard_of_care', label: 'Standard of care', type: 'text', optional: true, default: 'Same degree of care as receiver applies to its own confidential information, not less than reasonable care.' },
          { key: 'term_years', label: 'Confidentiality term (years)', type: 'number', required: true, default: '3' },
          { key: 'return_destroy_days', label: 'Return / destroy on demand (days)', type: 'number', required: true, default: '30' },
        ],
      },
      {
        title: 'Remedies',
        fields: [
          { key: 'injunctive_relief', label: 'Injunctive relief', type: 'text', optional: true, default: 'Receiver acknowledges that breach causes irreparable harm; Disclosing party may seek injunctive relief without proof of damage.' },
          { key: 'jurisdiction', label: 'Governing law & jurisdiction', type: 'text', required: true, default: 'Indian law; courts at Mumbai shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Distribution Agreement': {
    category: 'Commercial Agreement',
    description:
      'Appoints a distributor to resell the supplier\'s products in a defined territory. Subject to the Sale of Goods Act, 1930 and the Competition Act, 2002 (vertical restraints).',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'supplier_name', label: 'Supplier / Principal', type: 'text', required: true, default: 'Mythri Beverages Pvt. Ltd.' },
          { key: 'supplier_address', label: 'Supplier registered office', type: 'textarea', rows: 2, required: true, default: 'Survey No. 412, Bidadi Industrial Area,\nRamanagara - 562109, Karnataka' },
          { key: 'distributor_name', label: 'Distributor', type: 'text', required: true, default: 'M/s Coastal Beverages Distribution Pvt. Ltd.' },
          { key: 'distributor_address', label: 'Distributor address', type: 'textarea', rows: 2, required: true, default: 'Plot 14, Industrial Estate,\nMangaluru - 575010, Karnataka' },
        ],
      },
      {
        title: 'Appointment & Territory',
        fields: [
          { key: 'products', label: 'Products covered', type: 'textarea', rows: 2, required: true, default: 'Carbonated soft drinks under the "Mythri" and "Mythri Lite" brands in 200ml, 600ml and 1.25L SKUs.' },
          { key: 'territory', label: 'Territory', type: 'text', required: true, default: 'Dakshina Kannada and Udupi districts, Karnataka' },
          { key: 'exclusivity', label: 'Exclusivity', type: 'select', options: ['Exclusive', 'Sole', 'Non-exclusive'], required: true, default: 'Exclusive' },
          { key: 'minimum_purchase', label: 'Minimum purchase commitment', type: 'text', optional: true, default: '₹2 crore per quarter, calculated on supplier invoice value' },
        ],
      },
      {
        title: 'Pricing & Term',
        fields: [
          { key: 'pricing_basis', label: 'Pricing basis', type: 'text', required: true, default: 'Supplier\'s ex-works price list (as updated quarterly), less 22% distributor margin.' },
          { key: 'payment_terms', label: 'Payment terms', type: 'text', required: true, default: 'Advance against pro-forma invoice; or 14-day credit against bank guarantee equal to 1 month\'s purchase.' },
          { key: 'start_date', label: 'Effective date', type: 'date', required: true, default: '2026-06-01' },
          { key: 'term_years', label: 'Initial term (years)', type: 'number', required: true, default: '3' },
          { key: 'renewal', label: 'Renewal', type: 'text', optional: true, default: 'Renewable for 2-year terms subject to performance review.' },
        ],
      },
      {
        title: 'Termination & Boilerplate',
        fields: [
          { key: 'termination_notice_days', label: 'Termination on notice (days)', type: 'number', required: true, default: '90' },
          { key: 'post_termination', label: 'Post-termination obligations', type: 'textarea', rows: 2, optional: true, default: 'Supplier to repurchase unsold stock in saleable condition; distributor to immediately cease use of all trademarks.' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Bengaluru shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Franchise Agreement': {
    category: 'Commercial Agreement',
    description:
      'Grants a franchisee the right to operate a business under the franchisor\'s brand and system, against initial and ongoing fees. Covered by IP, Contract Act and Competition Act considerations.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'franchisor_name', label: 'Franchisor', type: 'text', required: true, default: 'Arabica & Co. Coffee Pvt. Ltd.' },
          { key: 'franchisor_address', label: 'Franchisor registered office', type: 'textarea', rows: 2, required: true, default: '2nd Floor, Embassy Heights,\nMG Road, Bengaluru - 560001' },
          { key: 'franchisee_name', label: 'Franchisee', type: 'text', required: true, default: 'M/s Latte Lounge Hospitality LLP' },
          { key: 'franchisee_address', label: 'Franchisee address', type: 'textarea', rows: 2, required: true, default: 'No. 8, Calangute - Candolim Road,\nNorth Goa - 403516' },
        ],
      },
      {
        title: 'Grant & Territory',
        fields: [
          { key: 'brand', label: 'Brand / system licensed', type: 'text', required: true, default: '"Arabica & Co." retail coffee café concept' },
          { key: 'territory', label: 'Territory', type: 'text', required: true, default: 'North Goa district - up to 3 outlets within 5 km radius of Calangute' },
          { key: 'outlet_count', label: 'Permitted outlets', type: 'number', required: true, default: '3' },
          { key: 'exclusivity', label: 'Exclusivity', type: 'select', options: ['Exclusive in territory', 'Non-exclusive', 'Area development'], required: true, default: 'Exclusive in territory' },
        ],
      },
      {
        title: 'Fees & Term',
        fields: [
          { key: 'initial_fee', label: 'Initial franchise fee (per outlet)', type: 'currency', required: true, default: '1500000' },
          { key: 'royalty_pct', label: 'Royalty (% of net sales)', type: 'number', required: true, default: '6' },
          { key: 'marketing_pct', label: 'Marketing contribution (% of net sales)', type: 'number', optional: true, default: '2' },
          { key: 'term_years', label: 'Term (years)', type: 'number', required: true, default: '5' },
          { key: 'renewal', label: 'Renewal', type: 'text', optional: true, default: 'One 5-year renewal at franchisor\'s discretion on payment of 50% of then-prevailing initial fee.' },
        ],
      },
      {
        title: 'Operational & IP',
        fields: [
          { key: 'training', label: 'Training & support', type: 'textarea', rows: 2, optional: true, default: 'Initial 4-week training at Bengaluru flagship; refresher training every 12 months; field audits twice yearly.' },
          { key: 'ip_use', label: 'IP / branding use', type: 'text', required: true, default: 'Limited, non-transferable licence to use franchisor\'s trademarks, trade dress and system manuals during the term only.' },
          { key: 'post_term', label: 'Post-termination de-identification', type: 'text', optional: true, default: 'Within 14 days of termination, franchisee to remove all branded signage, packaging and uniforms.' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Bengaluru shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Licensing Agreement': {
    category: 'Commercial Agreement',
    description:
      'Grants a licence to use intellectual property (patent, trademark, copyright, know-how) on defined terms. Governed by the relevant IP statute (Patents Act 1970, Trade Marks Act 1999, Copyright Act 1957).',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'licensor_name', label: 'Licensor', type: 'text', required: true, default: 'Indus Pharma Research Pvt. Ltd.' },
          { key: 'licensor_address', label: 'Licensor registered office', type: 'textarea', rows: 2, required: true, default: 'C-21, Phase II,\nOkhla Industrial Area, New Delhi - 110020' },
          { key: 'licensee_name', label: 'Licensee', type: 'text', required: true, default: 'Sahyadri Generics Ltd.' },
          { key: 'licensee_address', label: 'Licensee registered office', type: 'textarea', rows: 2, required: true, default: 'Survey No. 144,\nMIDC Tarapur, Boisar - 401506, Maharashtra' },
        ],
      },
      {
        title: 'Licensed IP',
        fields: [
          { key: 'ip_type', label: 'IP type', type: 'select', options: ['Patent', 'Trademark', 'Copyright', 'Know-how / Trade Secret', 'Combination'], required: true, default: 'Patent' },
          { key: 'ip_identifier', label: 'IP identifier / registration', type: 'text', required: true, default: 'Indian Patent No. IN 422810 (granted 14.06.2022) - "Pediatric oral suspension formulation"' },
          { key: 'field_of_use', label: 'Field of use', type: 'textarea', rows: 2, required: true, default: 'Manufacture, marketing and sale of pediatric oral antibiotic suspensions within India only.' },
          { key: 'territory', label: 'Territory', type: 'text', required: true, default: 'Republic of India' },
          { key: 'exclusivity', label: 'Exclusivity', type: 'select', options: ['Exclusive', 'Sole', 'Non-exclusive'], required: true, default: 'Non-exclusive' },
          { key: 'sublicensing', label: 'Sublicensing permitted?', type: 'select', options: ['Yes', 'No', 'With prior written consent'], required: true, default: 'With prior written consent' },
        ],
      },
      {
        title: 'Royalty & Term',
        fields: [
          { key: 'upfront_fee', label: 'Upfront / signing fee', type: 'currency', optional: true, default: '5000000' },
          { key: 'royalty_pct', label: 'Royalty (% of net sales)', type: 'number', required: true, default: '5' },
          { key: 'minimum_guarantee', label: 'Minimum annual royalty', type: 'currency', optional: true, default: '2000000' },
          { key: 'audit_rights', label: 'Audit rights', type: 'text', optional: true, default: 'Licensor may audit royalty statements once per calendar year on 14-day notice.' },
          { key: 'term', label: 'Term', type: 'text', required: true, default: 'Until expiry of the licensed patent (i.e. up to 14.06.2042) unless terminated earlier.' },
        ],
      },
      {
        title: 'Quality, Warranties & Jurisdiction',
        fields: [
          { key: 'quality_control', label: 'Quality control / standards', type: 'textarea', rows: 2, optional: true, default: 'Licensee shall maintain GMP-compliant manufacturing standards and permit sample testing by Licensor twice annually.' },
          { key: 'ip_warranties', label: 'IP warranties / indemnity', type: 'text', optional: true, default: 'Licensor warrants ownership and right to license; indemnifies Licensee against third-party IP infringement claims, capped at fees paid in the preceding 12 months.' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Indian law; courts at New Delhi shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Construction / Works Contract': {
    category: 'Commercial Agreement',
    description:
      'Engagement of a contractor for construction, erection or installation works. Subject to the Indian Contract Act, 1872 and (for public works) the General Financial Rules / state PWD codes.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'employer_name', label: 'Employer / Owner', type: 'text', required: true, default: 'M/s Crestwood Developers LLP' },
          { key: 'employer_address', label: 'Employer registered office', type: 'textarea', rows: 2, required: true, default: 'Plot No. 4, Sector 18,\nNoida - 201301, Uttar Pradesh' },
          { key: 'contractor_name', label: 'Contractor', type: 'text', required: true, default: 'Shapoorji Allied Builders Pvt. Ltd.' },
          { key: 'contractor_address', label: 'Contractor registered office', type: 'textarea', rows: 2, required: true, default: '70 Nagindas Master Road,\nFort, Mumbai - 400023' },
        ],
      },
      {
        title: 'Scope of Works',
        fields: [
          {
            key: 'works_description',
            label: 'Description of works',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Civil, structural and finishing works for "Crestwood Skyline" - a 22-storey residential tower comprising 84 apartments and 2 levels of basement parking at Plot No. 4, Sector 18, Noida, in accordance with approved drawings and BOQ dated 14.03.2026.',
          },
          { key: 'site', label: 'Site address', type: 'text', required: true, default: 'Plot No. 4, Sector 18, Noida - 201301' },
          { key: 'drawings_ref', label: 'Reference drawings / BOQ', type: 'text', optional: true, default: 'Architectural drawings Rev-04 dated 02.03.2026; BOQ dated 14.03.2026 (Annexure-A and Annexure-B).' },
        ],
      },
      {
        title: 'Contract Price & Time',
        fields: [
          { key: 'contract_price', label: 'Total contract price', type: 'currency', required: true, default: '450000000' },
          { key: 'price_basis', label: 'Pricing basis', type: 'select', options: ['Lump sum', 'Item rate', 'Cost plus', 'EPC turnkey'], required: true, default: 'Item rate' },
          { key: 'commencement_date', label: 'Commencement date', type: 'date', required: true, default: '2026-06-01' },
          { key: 'completion_period_months', label: 'Completion period (months)', type: 'number', required: true, default: '30' },
          { key: 'liquidated_damages', label: 'LD for delay', type: 'text', optional: true, default: '0.5% of contract price per week of delay, capped at 7.5% of contract price' },
          { key: 'payment_milestones', label: 'Payment milestones', type: 'textarea', rows: 3, optional: true, default: '10% mobilisation advance against bank guarantee; running bills monthly with 5% retention; final 5% released against virtual completion certificate and snag-list closure.' },
        ],
      },
      {
        title: 'Security, Warranty & Disputes',
        fields: [
          { key: 'performance_bg', label: 'Performance bank guarantee', type: 'text', required: true, default: '5% of contract price, valid till 90 days post defect-liability period.' },
          { key: 'defect_liability_months', label: 'Defect liability (months)', type: 'number', required: true, default: '12' },
          { key: 'insurance', label: 'Insurance requirements', type: 'text', optional: true, default: 'CAR / EAR policy in joint names; workmen compensation as per statute; third-party liability ₹10 crore.' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'Arbitration u/s 7 of the Arbitration & Conciliation Act, 1996, sole arbitrator, seat Delhi.' },
        ],
      },
    ],
  },

  'Joint Venture Agreement': {
    category: 'Commercial Agreement',
    description:
      'Establishes the terms of a joint venture between two or more parties - contractual or via a JV company. Subject to the Companies Act, 2013 (for JVCo), FEMA (for FDI), and CCI clearance thresholds.',
    sections: [
      {
        title: 'JV Parties',
        fields: [
          { key: 'party_a_name', label: 'JV Partner A', type: 'text', required: true, default: 'Indus Renewables Pvt. Ltd.' },
          { key: 'party_a_address', label: 'Partner A registered office', type: 'textarea', rows: 2, required: true, default: 'A-22, Sector 16,\nNoida - 201301' },
          { key: 'party_b_name', label: 'JV Partner B', type: 'text', required: true, default: 'Pacific Solar Holdings Pte. Ltd.' },
          { key: 'party_b_address', label: 'Partner B registered office', type: 'textarea', rows: 2, required: true, default: '8 Marina View, #20-04 Asia Square Tower 2, Singapore 018960' },
        ],
      },
      {
        title: 'JV Structure',
        fields: [
          { key: 'jv_form', label: 'JV form', type: 'select', options: ['Equity JV (new company)', 'Contractual JV (unincorporated)', 'LLP', 'Strategic alliance'], required: true, default: 'Equity JV (new company)' },
          { key: 'jvco_name', label: 'JVCo name (proposed)', type: 'text', optional: true, default: 'IndusPacific Solar Pvt. Ltd.' },
          { key: 'jurisdiction_of_incorporation', label: 'Place of incorporation', type: 'text', optional: true, default: 'India - Delhi, NCT' },
          { key: 'business_purpose', label: 'Business purpose', type: 'textarea', rows: 3, required: true, default: 'Development, construction and operation of utility-scale solar PV plants in India totalling 1.2 GW over 5 years, including bidding for SECI / state-discom tenders.' },
        ],
      },
      {
        title: 'Capital & Shareholding',
        fields: [
          { key: 'authorised_capital', label: 'Authorised capital', type: 'currency', optional: true, default: '5000000000' },
          { key: 'initial_paid_up', label: 'Initial paid-up capital', type: 'currency', required: true, default: '1000000000' },
          { key: 'shareholding_a_pct', label: 'Partner A shareholding (%)', type: 'number', required: true, default: '51' },
          { key: 'shareholding_b_pct', label: 'Partner B shareholding (%)', type: 'number', required: true, default: '49' },
          { key: 'capital_contribution', label: 'Contribution split', type: 'textarea', rows: 2, optional: true, default: 'Partner A: cash + land bank valued at ₹260 crore; Partner B: cash + EPC contracts valued at ₹240 crore.' },
        ],
      },
      {
        title: 'Governance, Exit & Boilerplate',
        fields: [
          { key: 'board_composition', label: 'Board composition', type: 'text', required: true, default: '5 directors: 3 nominated by Partner A; 2 nominated by Partner B; Chairperson from Partner A with no casting vote.' },
          { key: 'reserved_matters', label: 'Reserved (consent) matters', type: 'textarea', rows: 3, optional: true, default: 'Capital changes, M&A, dividend > 30% PAT, related-party transactions > ₹10 crore, business plan amendments, debt > 3x EBITDA - require approval from both partners.' },
          { key: 'deadlock', label: 'Deadlock resolution', type: 'text', optional: true, default: 'Russian roulette buyout mechanism after a 90-day cooling-off period.' },
          { key: 'transfer_restrictions', label: 'Transfer restrictions', type: 'text', optional: true, default: 'Lock-in of 4 years; thereafter ROFR / tag-along / drag-along apply.' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'SIAC arbitration, 3-member panel, seat Singapore, English language.' },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Corporate Agreements
  // ---------------------------------------------------------------------------

  "Shareholders' Agreement (SHA)": {
    category: 'Corporate Agreement',
    description:
      'Governs the relationship between shareholders of a private company - rights, board control, transfer restrictions, reserved matters and exit. Read with the Companies Act, 2013 (Sections 58, 88, 89) and SEBI ICDR for unlisted companies that may IPO.',
    sections: [
      {
        title: 'Parties & Company',
        fields: [
          { key: 'company_name', label: 'Company', type: 'text', required: true, default: 'Helixon Bio Sciences Pvt. Ltd.' },
          { key: 'company_cin', label: 'CIN', type: 'text', required: true, default: 'U73100KA2021PTC156234' },
          { key: 'company_address', label: 'Registered office', type: 'textarea', rows: 2, required: true, default: 'No. 17, 2nd Floor, IBC Knowledge Park,\nBannerghatta Road, Bengaluru - 560029' },
          { key: 'founder_holders', label: 'Founder shareholder(s)', type: 'textarea', rows: 2, required: true, default: 'Dr. Aishwarya Pillai (60% pre-money); Shri Kunal Verma (40% pre-money).' },
          { key: 'investor_holders', label: 'Investor shareholder(s)', type: 'textarea', rows: 2, required: true, default: 'Trishul Capital Partners II LP, through its investment manager Trishul Advisors LLP.' },
        ],
      },
      {
        title: 'Capital Structure',
        fields: [
          { key: 'pre_money_valuation', label: 'Pre-money valuation', type: 'currency', required: true, default: '1500000000' },
          { key: 'investment_amount', label: 'Investment amount (this round)', type: 'currency', required: true, default: '500000000' },
          { key: 'security_type', label: 'Security being issued', type: 'select', options: ['Equity Shares', 'CCPS', 'OCRPS', 'CCD', 'OCD'], required: true, default: 'CCPS' },
          { key: 'post_money_investor_pct', label: 'Investor post-money %', type: 'number', required: true, default: '25' },
          { key: 'esop_pool_pct', label: 'ESOP pool (post-money %)', type: 'number', optional: true, default: '10' },
        ],
      },
      {
        title: 'Governance',
        fields: [
          { key: 'board_size', label: 'Board size', type: 'number', required: true, default: '5' },
          { key: 'board_composition', label: 'Board composition', type: 'textarea', rows: 2, required: true, default: 'Founders: 2 directors; Investor: 1 director + 1 observer; 2 independent directors mutually agreed.' },
          { key: 'quorum', label: 'Board / shareholder quorum', type: 'text', optional: true, default: 'Board: majority including Investor Director; General meetings: majority including Investor representative.' },
          { key: 'reserved_matters', label: 'Reserved (affirmative-vote) matters', type: 'textarea', rows: 4, required: true, default: 'a) Amendment of MoA / AoA;\nb) Issue of new securities or change in capital structure;\nc) M&A, asset sale, dissolution;\nd) Annual budget and business plan;\ne) Related-party transactions > ₹1 crore;\nf) Senior hiring (CXO) and CXO compensation;\ng) Debt > ₹5 crore;\nh) Change of business / new line of business.' },
        ],
      },
      {
        title: 'Transfer & Exit',
        fields: [
          { key: 'lock_in_months', label: 'Founder lock-in (months)', type: 'number', required: true, default: '36' },
          { key: 'transfer_restrictions', label: 'Transfer restrictions', type: 'textarea', rows: 2, optional: true, default: 'ROFR / ROFO in favour of Investor and continuing shareholders; tag-along on > 5% transfers; drag-along once threshold approval is obtained.' },
          { key: 'liquidation_preference', label: 'Liquidation preference', type: 'text', required: true, default: '1x non-participating preference on the Investor\'s subscription amount, plus declared but unpaid dividends.' },
          { key: 'anti_dilution', label: 'Anti-dilution', type: 'select', options: ['Broad-based weighted average', 'Narrow-based weighted average', 'Full ratchet', 'None'], required: true, default: 'Broad-based weighted average' },
          { key: 'exit_window_years', label: 'Exit obligation (years)', type: 'number', required: true, default: '7' },
          { key: 'exit_modes', label: 'Permitted exit modes', type: 'textarea', rows: 2, optional: true, default: 'Qualified IPO, strategic sale, secondary sale or buy-back; if not achieved by year 7, drag-along available to Investor.' },
        ],
      },
      {
        title: 'Boilerplate',
        fields: [
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'Arbitration u/s 7 of the Arbitration & Conciliation Act, 1996; 3 arbitrators; seat New Delhi; English.' },
        ],
      },
    ],
  },

  'Share Purchase Agreement (SPA)': {
    category: 'Corporate Agreement',
    description:
      'Sale of existing shares by selling shareholders to a buyer. Subject to the Companies Act, 2013, SCRA, FEMA NDI Rules (if cross-border), and Section 56(2)(x) of the Income-tax Act, 1961 on FMV.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'buyer_name', label: 'Buyer / Acquirer', type: 'text', required: true, default: 'Trishul Capital Partners II LP' },
          { key: 'buyer_address', label: 'Buyer registered office', type: 'textarea', rows: 2, required: true, default: 'PO Box 309, Ugland House,\nGrand Cayman KY1-1104, Cayman Islands' },
          { key: 'sellers', label: 'Selling shareholder(s)', type: 'textarea', rows: 2, required: true, default: 'Dr. Aishwarya Pillai (8,500 equity shares); Shri Kunal Verma (5,200 equity shares).' },
          { key: 'target_name', label: 'Target company', type: 'text', required: true, default: 'Helixon Bio Sciences Pvt. Ltd.' },
          { key: 'target_cin', label: 'Target CIN', type: 'text', required: true, default: 'U73100KA2021PTC156234' },
        ],
      },
      {
        title: 'Sale Shares & Consideration',
        fields: [
          { key: 'sale_shares', label: 'Sale shares', type: 'text', required: true, default: '13,700 equity shares of face value ₹10 each, representing 32.5% of the issued share capital of the Target' },
          { key: 'price_per_share', label: 'Price per share', type: 'currency', required: true, default: '85000' },
          { key: 'total_consideration', label: 'Total consideration', type: 'currency', required: true, default: '1164500000' },
          { key: 'payment_mode', label: 'Mode of payment', type: 'select', options: ['Single tranche at closing', 'Closing + deferred consideration', 'Closing + escrow + earn-out', 'Earn-out only'], required: true, default: 'Closing + escrow + earn-out' },
          { key: 'escrow_amount', label: 'Indemnity escrow amount', type: 'currency', optional: true, default: '116450000' },
          { key: 'escrow_period_months', label: 'Escrow period (months)', type: 'number', optional: true, default: '24' },
        ],
      },
      {
        title: 'Closing Mechanics',
        fields: [
          { key: 'signing_date', label: 'Signing date', type: 'date', required: true, default: '2026-05-20' },
          { key: 'long_stop_date', label: 'Long-stop date', type: 'date', optional: true, default: '2026-08-20' },
          { key: 'conditions_precedent', label: 'Conditions precedent', type: 'textarea', rows: 3, required: true, default: 'a) CCI clearance (if applicable);\nb) Board / shareholder approvals of Target;\nc) Lender consents under existing loan agreements;\nd) Bring-down of warranties as of closing;\ne) Completion of confirmatory DD with no material adverse finding.' },
          { key: 'closing_deliverables', label: 'Closing deliverables', type: 'textarea', rows: 3, optional: true, default: 'Share transfer forms (SH-4), original share certificates, board resolutions, updated members register, resignation letters of outgoing directors, statutory filings (PAS-3 / MGT-7 where applicable).' },
        ],
      },
      {
        title: 'Reps, Warranties & Indemnity',
        fields: [
          { key: 'warranty_period_months', label: 'General warranty period (months)', type: 'number', required: true, default: '24' },
          { key: 'tax_warranty_period_years', label: 'Tax warranty period (years)', type: 'number', required: true, default: '7' },
          { key: 'fundamental_warranties', label: 'Fundamental warranties period', type: 'text', optional: true, default: 'Title to shares, authority, capacity - unlimited (subject to limitation laws).' },
          { key: 'indemnity_cap', label: 'Indemnity cap', type: 'text', required: true, default: '100% of consideration for fundamental / tax warranties; 30% for general business warranties.' },
          { key: 'de_minimis', label: 'De-minimis threshold', type: 'currency', optional: true, default: '1000000' },
          { key: 'basket_amount', label: 'Basket / tipping amount', type: 'currency', optional: true, default: '10000000' },
        ],
      },
      {
        title: 'Boilerplate',
        fields: [
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'SIAC arbitration, 3-member panel, seat Singapore, English language.' },
        ],
      },
    ],
  },

  'Share Subscription Agreement (SSA)': {
    category: 'Corporate Agreement',
    description:
      'Primary issuance of new shares by the company to an investor. Subject to Companies Act, 2013 (Sections 42, 62), Rule 13 of Companies (PAS) Rules and FEMA pricing guidelines for non-resident investors.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'company_name', label: 'Issuer (Company)', type: 'text', required: true, default: 'Sentinel Analytics Pvt. Ltd.' },
          { key: 'company_cin', label: 'Issuer CIN', type: 'text', required: true, default: 'U72200HR2022PTC102456' },
          { key: 'company_address', label: 'Registered office', type: 'textarea', rows: 2, required: true, default: 'Tower B, 9th Floor,\nDLF Cyber City Phase III,\nGurugram - 122002' },
          { key: 'investor_name', label: 'Investor', type: 'text', required: true, default: 'Aurelius Growth Fund III LP' },
          { key: 'investor_address', label: 'Investor address', type: 'textarea', rows: 2, required: true, default: 'Maples Corporate Services,\nUgland House, KY1-1104,\nCayman Islands' },
        ],
      },
      {
        title: 'Subscription Terms',
        fields: [
          { key: 'security_type', label: 'Security subscribed', type: 'select', options: ['Equity Shares', 'CCPS', 'OCRPS', 'CCD', 'OCD'], required: true, default: 'CCPS' },
          { key: 'number_of_shares', label: 'Number of securities', type: 'number', required: true, default: '5882' },
          { key: 'face_value', label: 'Face value per security', type: 'currency', required: true, default: '10' },
          { key: 'subscription_price', label: 'Subscription price per security', type: 'currency', required: true, default: '85000' },
          { key: 'investment_amount', label: 'Total subscription amount', type: 'currency', required: true, default: '500000000' },
          { key: 'post_money_pct', label: 'Investor post-money %', type: 'number', required: true, default: '15' },
        ],
      },
      {
        title: 'Closing & Use of Funds',
        fields: [
          { key: 'signing_date', label: 'Signing date', type: 'date', required: true, default: '2026-05-20' },
          { key: 'long_stop_date', label: 'Long-stop date', type: 'date', optional: true, default: '2026-07-31' },
          { key: 'tranche_structure', label: 'Tranche structure', type: 'textarea', rows: 2, optional: true, default: 'Tranche 1: ₹30 crore at closing; Tranche 2: ₹20 crore subject to achievement of revenue milestone of ₹50 crore TTM by 30.06.2027.' },
          { key: 'use_of_proceeds', label: 'Use of proceeds', type: 'textarea', rows: 3, required: true, default: 'a) Sales & marketing scale-up (40%);\nb) R&D and product engineering (30%);\nc) International expansion - SEA region (20%);\nd) General corporate purposes (10%).' },
        ],
      },
      {
        title: 'Conditions, Reps & Warranties',
        fields: [
          { key: 'conditions_precedent', label: 'Conditions precedent', type: 'textarea', rows: 3, required: true, default: 'Board / shareholder approvals; amendment to AoA to incorporate Investor rights; entry into SHA on Closing; bring-down of warranties; legal & financial DD comfort.' },
          { key: 'warranty_period_months', label: 'General warranty period (months)', type: 'number', required: true, default: '24' },
          { key: 'indemnity_cap', label: 'Indemnity cap', type: 'text', required: true, default: 'Capped at the subscription amount; uncapped for fraud / wilful misconduct / title.' },
        ],
      },
      {
        title: 'Boilerplate',
        fields: [
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'SIAC arbitration, 3-member panel, seat Singapore.' },
        ],
      },
    ],
  },

  'Asset Purchase Agreement': {
    category: 'Corporate Agreement',
    description:
      'Cherry-picking sale of specific business assets and assumption of specified liabilities (as opposed to share purchase). Subject to Sale of Goods Act, 1930, Transfer of Property Act, 1882 and Section 50B of the Income-tax Act (if treated as slump sale).',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'seller_name', label: 'Seller', type: 'text', required: true, default: 'Vivaan Foods Pvt. Ltd.' },
          { key: 'seller_address', label: 'Seller registered office', type: 'textarea', rows: 2, required: true, default: 'Plot No. 22, Food Park,\nVithalapur, Mehsana - 382728, Gujarat' },
          { key: 'buyer_name', label: 'Buyer', type: 'text', required: true, default: 'Northwind Foods Acquisition Pvt. Ltd.' },
          { key: 'buyer_address', label: 'Buyer registered office', type: 'textarea', rows: 2, required: true, default: '14th Floor, One BKC,\nBandra-Kurla Complex, Mumbai - 400051' },
        ],
      },
      {
        title: 'Transferred Assets',
        fields: [
          {
            key: 'assets_description',
            label: 'Description of assets being transferred',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'a) Manufacturing facility at Plot No. 22, Vithalapur (land, building, plant & machinery);\nb) Customer contracts listed in Schedule-A;\nc) Brand "Vivaan Snacks" and related TM registrations;\nd) Inventory as of Closing valued per Schedule-B;\ne) Specified employees who have accepted offers from Buyer.',
          },
          { key: 'excluded_assets', label: 'Excluded assets', type: 'textarea', rows: 2, optional: true, default: 'Cash and bank balances; intercompany receivables; head-office property at Ahmedabad; brand "Vivaan Beverages".' },
          { key: 'assumed_liabilities', label: 'Assumed liabilities', type: 'textarea', rows: 2, optional: true, default: 'Trade payables of the transferred business as of Closing; contracts in Schedule-A; employee continuity benefits.' },
          { key: 'excluded_liabilities', label: 'Excluded liabilities', type: 'textarea', rows: 2, optional: true, default: 'All tax liabilities prior to Closing; debt and bank borrowings; litigation pending as on the signing date.' },
        ],
      },
      {
        title: 'Consideration & Allocation',
        fields: [
          { key: 'total_consideration', label: 'Total purchase price', type: 'currency', required: true, default: '650000000' },
          { key: 'allocation', label: 'Purchase-price allocation', type: 'textarea', rows: 3, optional: true, default: 'Land & building: ₹22 cr; P&M: ₹18 cr; Intangibles (brand, TMs): ₹12 cr; Inventory: ₹8 cr; Goodwill: ₹5 cr.' },
          { key: 'payment_terms', label: 'Payment terms', type: 'text', required: true, default: '80% at Closing; 20% held in escrow for 18 months as indemnity holdback.' },
          { key: 'closing_date', label: 'Closing date', type: 'date', required: true, default: '2026-08-15' },
        ],
      },
      {
        title: 'Conditions & Warranties',
        fields: [
          { key: 'conditions_precedent', label: 'Conditions precedent', type: 'textarea', rows: 3, required: true, default: 'Third-party consents on assigned contracts; lender NOC; CCI approval (if applicable); employee acceptances; transfer of FSSAI, factory and environmental licences.' },
          { key: 'employee_transition', label: 'Employee transition', type: 'textarea', rows: 2, optional: true, default: 'Buyer to offer continued employment on no-less-favourable terms; Seller liable for accrued benefits until Closing.' },
          { key: 'warranty_period_months', label: 'Warranty survival (months)', type: 'number', required: true, default: '24' },
          { key: 'indemnity_cap', label: 'Indemnity cap', type: 'text', required: true, default: '30% of purchase price for general warranties; 100% for fundamental and tax warranties.' },
        ],
      },
      {
        title: 'Boilerplate',
        fields: [
          { key: 'non_compete_months', label: 'Seller non-compete (months)', type: 'number', optional: true, default: '36' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'MCIA arbitration, 3-member panel, seat Mumbai, English language.' },
        ],
      },
    ],
  },

  'Founder / Co-founder Agreement': {
    category: 'Corporate Agreement',
    description:
      'Inter-se agreement between co-founders covering equity split, vesting, roles, IP assignment and exit. Read with the Indian Contract Act, 1872 and the Companies Act, 2013.',
    sections: [
      {
        title: 'Founders',
        fields: [
          { key: 'company_name', label: 'Company / proposed entity', type: 'text', required: true, default: 'Lumina AI Labs Pvt. Ltd.' },
          { key: 'founder_a_name', label: 'Founder A', type: 'text', required: true, default: 'Shri Aniruddh Khanna' },
          { key: 'founder_a_role', label: 'Founder A role', type: 'text', required: true, default: 'Chief Executive Officer (CEO)' },
          { key: 'founder_b_name', label: 'Founder B', type: 'text', required: true, default: 'Smt. Riya Kapoor' },
          { key: 'founder_b_role', label: 'Founder B role', type: 'text', required: true, default: 'Chief Technology Officer (CTO)' },
          { key: 'founder_c_name', label: 'Founder C (if any)', type: 'text', optional: true, default: 'Dr. Sandeep Iyengar' },
          { key: 'founder_c_role', label: 'Founder C role', type: 'text', optional: true, default: 'Chief Scientific Officer (CSO) - part-time' },
        ],
      },
      {
        title: 'Equity & Vesting',
        fields: [
          { key: 'equity_split', label: 'Equity split (founder %)', type: 'textarea', rows: 2, required: true, default: 'Founder A (CEO): 45%; Founder B (CTO): 40%; Founder C (CSO): 15%.' },
          { key: 'total_shares_issued', label: 'Total founder shares', type: 'number', required: true, default: '100000' },
          { key: 'face_value', label: 'Face value per share', type: 'currency', required: true, default: '10' },
          { key: 'vesting_schedule', label: 'Vesting schedule', type: 'text', required: true, default: '4-year vesting with 1-year cliff (25%), thereafter monthly vesting of remaining 75%.' },
          { key: 'acceleration', label: 'Acceleration triggers', type: 'text', optional: true, default: 'Double-trigger: 50% acceleration on a change-of-control followed by involuntary termination within 12 months.' },
        ],
      },
      {
        title: 'Roles, IP & Commitment',
        fields: [
          { key: 'full_time_commitment', label: 'Full-time commitment', type: 'select', options: ['Yes - all founders full-time', 'Mixed (specify in description)', 'Part-time during transition'], required: true, default: 'Mixed (specify in description)' },
          { key: 'time_commitment_notes', label: 'Time commitment notes', type: 'textarea', rows: 2, optional: true, default: 'Founders A & B full-time from incorporation; Founder C joins full-time after 6 months post seed-round close.' },
          { key: 'ip_assignment', label: 'IP assignment', type: 'textarea', rows: 2, required: true, default: 'All pre-existing IP relevant to the business and all IP developed during the engagement is assigned absolutely to the Company; no founder retains any residual rights.' },
          { key: 'non_compete_term', label: 'Non-compete during tenure', type: 'text', optional: true, default: 'Full non-compete during tenure; 12-month non-solicit post-departure.' },
        ],
      },
      {
        title: 'Exit & Departure',
        fields: [
          { key: 'leaver_provisions', label: 'Good leaver / bad leaver', type: 'textarea', rows: 3, required: true, default: 'Good leaver: vested shares retained; unvested forfeited to Company at face value.\nBad leaver: vested and unvested shares re-purchaseable by Company at face value for misconduct, fraud or breach.' },
          { key: 'rofr', label: 'ROFR / ROFO', type: 'text', optional: true, default: 'On any proposed transfer by a founder, remaining founders enjoy ROFR pro-rata; failing them, the Company.' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'Mediation followed by arbitration u/s 7 of A&C Act, 1996; sole arbitrator; seat Bengaluru.' },
        ],
      },
    ],
  },

  'ESOP Grant Agreement': {
    category: 'Corporate Agreement',
    description:
      'Issues stock options to an employee under the Company\'s ESOP scheme. Governed by Section 62(1)(b) of the Companies Act, 2013, Rule 12 of Companies (Share Capital & Debentures) Rules and SEBI SBEB Regulations for listed entities.',
    sections: [
      {
        title: 'Grant Parties',
        fields: [
          { key: 'company_name', label: 'Company', type: 'text', required: true, default: 'Sentinel Analytics Pvt. Ltd.' },
          { key: 'scheme_name', label: 'ESOP scheme name', type: 'text', required: true, default: 'Sentinel Analytics Employee Stock Option Plan, 2023 ("ESOP 2023")' },
          { key: 'grantee_name', label: 'Grantee', type: 'text', required: true, default: 'Shri Aditya Bansal' },
          { key: 'grantee_designation', label: 'Grantee designation', type: 'text', required: true, default: 'Senior Data Engineer' },
          { key: 'grantee_employee_id', label: 'Employee ID', type: 'text', optional: true, default: 'SNT-EMP-1142' },
        ],
      },
      {
        title: 'Option Terms',
        fields: [
          { key: 'number_of_options', label: 'Number of options granted', type: 'number', required: true, default: '1500' },
          { key: 'exercise_price', label: 'Exercise price per option', type: 'currency', required: true, default: '1000' },
          { key: 'fmv_at_grant', label: 'FMV at grant (per Cat-I merchant banker)', type: 'currency', optional: true, default: '4250' },
          { key: 'grant_date', label: 'Grant date', type: 'date', required: true, default: '2026-06-15' },
          { key: 'option_type', label: 'Option type', type: 'select', options: ['Equity options (ESOP)', 'Restricted Stock Units (RSU)', 'Stock Appreciation Rights (SAR)', 'Phantom Stock'], required: true, default: 'Equity options (ESOP)' },
        ],
      },
      {
        title: 'Vesting',
        fields: [
          { key: 'vesting_commencement', label: 'Vesting commencement date', type: 'date', required: true, default: '2026-06-15' },
          { key: 'vesting_period_years', label: 'Total vesting period (years)', type: 'number', required: true, default: '4' },
          { key: 'cliff_months', label: 'Cliff period (months)', type: 'number', required: true, default: '12' },
          { key: 'vesting_pattern', label: 'Vesting pattern', type: 'text', required: true, default: '25% on cliff, then 1/36th of remaining options vest monthly over the next 36 months.' },
          { key: 'performance_conditions', label: 'Performance conditions', type: 'text', optional: true, default: 'No performance gate beyond continued employment in good standing.' },
        ],
      },
      {
        title: 'Exercise & Forfeiture',
        fields: [
          { key: 'exercise_window_years', label: 'Exercise window post-vesting (years)', type: 'number', required: true, default: '7' },
          { key: 'leaver_treatment', label: 'Leaver treatment', type: 'textarea', rows: 3, required: true, default: 'Good leaver: vested options retained, exercisable within 12 months of separation.\nBad leaver (fraud/wilful misconduct): all options (vested + unvested) lapse.\nDeath/Disability: 100% vesting; exercise within 24 months by legal heirs.' },
          { key: 'transferability', label: 'Transferability', type: 'text', optional: true, default: 'Options are non-transferable except by testamentary succession.' },
          { key: 'tax_treatment_note', label: 'Tax treatment note', type: 'textarea', rows: 2, optional: true, default: 'Perquisite tax under Section 17(2)(vi) at exercise; capital gains on subsequent sale under Section 45.' },
        ],
      },
    ],
  },

  'Term Sheet': {
    category: 'Corporate Agreement',
    description:
      'Non-binding summary of principal commercial terms for an investment or transaction. Binding clauses (exclusivity, confidentiality, expenses, governing law) are clearly demarcated.',
    sections: [
      {
        title: 'Parties & Transaction',
        fields: [
          { key: 'investor_name', label: 'Lead investor', type: 'text', required: true, default: 'Trishul Capital Partners II LP' },
          { key: 'company_name', label: 'Company', type: 'text', required: true, default: 'Helixon Bio Sciences Pvt. Ltd.' },
          { key: 'founders', label: 'Founders / promoters', type: 'text', required: true, default: 'Dr. Aishwarya Pillai; Shri Kunal Verma' },
          { key: 'round', label: 'Round name', type: 'select', options: ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Bridge', 'Pre-IPO'], required: true, default: 'Series B' },
        ],
      },
      {
        title: 'Valuation & Structure',
        fields: [
          { key: 'pre_money_valuation', label: 'Pre-money valuation', type: 'currency', required: true, default: '1500000000' },
          { key: 'investment_amount', label: 'Investment amount', type: 'currency', required: true, default: '500000000' },
          { key: 'security_type', label: 'Security', type: 'select', options: ['Equity Shares', 'CCPS', 'CCD', 'SAFE Note', 'Convertible Note'], required: true, default: 'CCPS' },
          { key: 'investor_post_money_pct', label: 'Investor post-money %', type: 'number', required: true, default: '25' },
          { key: 'esop_pool', label: 'ESOP pool top-up', type: 'text', optional: true, default: 'Pre-money expansion of ESOP pool to 12% of fully-diluted post-money capitalisation.' },
        ],
      },
      {
        title: 'Investor Rights',
        fields: [
          { key: 'liquidation_preference', label: 'Liquidation preference', type: 'text', required: true, default: '1x non-participating' },
          { key: 'anti_dilution', label: 'Anti-dilution', type: 'select', options: ['Broad-based weighted average', 'Narrow-based weighted average', 'Full ratchet', 'None'], required: true, default: 'Broad-based weighted average' },
          { key: 'board_seat', label: 'Board representation', type: 'text', required: true, default: '1 Investor Director + 1 Observer; consent right on reserved matters.' },
          { key: 'information_rights', label: 'Information rights', type: 'text', optional: true, default: 'Audited annuals, unaudited quarterly, monthly MIS, annual budget; inspection rights.' },
          { key: 'pro_rata', label: 'Pro-rata participation', type: 'text', optional: true, default: 'Right to participate in future rounds up to maintain percentage shareholding.' },
        ],
      },
      {
        title: 'Process & Binding Provisions',
        fields: [
          { key: 'exclusivity_days', label: 'Exclusivity period (days)', type: 'number', required: true, default: '60' },
          { key: 'dd_window_days', label: 'Due-diligence window (days)', type: 'number', optional: true, default: '45' },
          { key: 'long_stop_date', label: 'Long-stop / definitive doc target', type: 'date', optional: true, default: '2026-08-15' },
          { key: 'expense_allocation', label: 'Expense allocation', type: 'text', optional: true, default: 'Company to reimburse Investor\'s reasonable legal / DD costs up to ₹50 lakh on closing.' },
          {
            key: 'binding_clauses',
            label: 'Binding provisions',
            type: 'textarea',
            rows: 2,
            required: true,
            default:
              'Exclusivity, confidentiality, expense allocation, governing law and dispute resolution are binding. All other terms are non-binding and subject to definitive documentation.',
          },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law; SIAC arbitration; seat Singapore.' },
        ],
      },
    ],
  },

  'Slump Sale Agreement': {
    category: 'Corporate Agreement',
    description:
      'Transfer of one or more undertakings as a going concern for a lump-sum consideration without separately valuing individual assets and liabilities. Defined in Section 2(42C) and taxed under Section 50B of the Income-tax Act, 1961.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'seller_name', label: 'Transferor / Seller', type: 'text', required: true, default: 'Marigold Industries Ltd.' },
          { key: 'seller_address', label: 'Transferor registered office', type: 'textarea', rows: 2, required: true, default: 'Marigold House, 12 Boat Club Road,\nPune - 411001, Maharashtra' },
          { key: 'buyer_name', label: 'Transferee / Buyer', type: 'text', required: true, default: 'Indus Speciality Chemicals Pvt. Ltd.' },
          { key: 'buyer_address', label: 'Transferee registered office', type: 'textarea', rows: 2, required: true, default: 'Plot No. 14, Dahej PCPIR,\nBharuch - 392130, Gujarat' },
        ],
      },
      {
        title: 'Undertaking',
        fields: [
          {
            key: 'undertaking_description',
            label: 'Description of undertaking transferred',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'The "Speciality Chemicals Undertaking" of the Seller, comprising the manufacturing facility at Plot 88, Tarapur MIDC, together with all related fixed assets, current assets, contracts, IP, employees, regulatory approvals (PCB, factory licence, GST registrations) and liabilities, as a going concern.',
          },
          { key: 'going_concern_certificate', label: 'Going-concern confirmation', type: 'text', optional: true, default: 'Auditor\'s certificate that the undertaking has been transferred as a going concern within Section 2(42C) of the Income-tax Act, 1961.' },
          { key: 'excluded_items', label: 'Specifically excluded items', type: 'textarea', rows: 2, optional: true, default: 'Cash & bank balances, intercompany loans, head-office shared services and brand "Marigold" (which Seller retains for other businesses).' },
        ],
      },
      {
        title: 'Consideration',
        fields: [
          { key: 'lump_sum_consideration', label: 'Lump-sum consideration', type: 'currency', required: true, default: '1850000000' },
          { key: 'consideration_form', label: 'Form of consideration', type: 'select', options: ['Cash', 'Equity shares of Buyer', 'Cash + equity', 'Cash + deferred / earn-out'], required: true, default: 'Cash + deferred / earn-out' },
          { key: 'payment_schedule', label: 'Payment schedule', type: 'textarea', rows: 2, optional: true, default: '85% at Closing; 10% deferred over 12 months as indemnity holdback; 5% earn-out linked to 24-month EBITDA performance of the undertaking.' },
          { key: 'net_worth_certificate', label: 'Net-worth (Section 50B) computation', type: 'text', optional: true, default: 'CA-certified net worth of the undertaking as on the appointed date enclosed as Schedule-C.' },
        ],
      },
      {
        title: 'Closing & Approvals',
        fields: [
          { key: 'appointed_date', label: 'Appointed date', type: 'date', required: true, default: '2026-04-01' },
          { key: 'closing_date', label: 'Closing date', type: 'date', required: true, default: '2026-08-15' },
          { key: 'conditions_precedent', label: 'Conditions precedent', type: 'textarea', rows: 3, required: true, default: 'Shareholder approval u/s 180(1)(a) of Companies Act, 2013; lender / debenture-trustee NOCs; CCI clearance if thresholds met; consents on material assigned contracts; transfer of regulatory licences.' },
          { key: 'employee_transition', label: 'Employee transition', type: 'text', optional: true, default: 'All employees of the undertaking transferred on no-less-favourable terms with continuity of service.' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'MCIA arbitration, seat Mumbai, English language.' },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Property & Family
  // ---------------------------------------------------------------------------

  'Gift Deed': {
    category: 'Property & Family',
    description:
      'Voluntary transfer of immovable / movable property without consideration. Governed by Sections 122-129 of the Transfer of Property Act, 1882 (or personal-law principles for Muslims under Hiba). Requires registration under Section 17 of the Registration Act, 1908.',
    sections: [
      {
        title: 'Donor',
        fields: [
          { key: 'donor_name', label: 'Donor name', type: 'text', required: true, default: 'Shri Ramesh Iyer, S/o Late Shri Krishnan Iyer' },
          { key: 'donor_age', label: 'Donor age', type: 'number', required: true, default: '68' },
          { key: 'donor_address', label: 'Donor address', type: 'textarea', rows: 2, required: true, default: 'No. 11, Cunningham Road,\nBengaluru - 560052, Karnataka' },
          { key: 'donor_pan', label: 'Donor PAN / Aadhaar', type: 'text', optional: true, default: 'AAFPI4521C / XXXX XXXX 1834' },
        ],
      },
      {
        title: 'Donee',
        fields: [
          { key: 'donee_name', label: 'Donee name', type: 'text', required: true, default: 'Smt. Priya Menon, W/o Shri Arjun Menon' },
          { key: 'donee_age', label: 'Donee age', type: 'number', required: true, default: '34' },
          { key: 'donee_address', label: 'Donee address', type: 'textarea', rows: 2, required: true, default: 'Flat 4B, Brigade Meadows,\nKanakapura Road, Bengaluru - 560082' },
          { key: 'relationship', label: 'Relationship to donor', type: 'text', required: true, default: 'Daughter' },
        ],
      },
      {
        title: 'Gifted Property',
        fields: [
          {
            key: 'property_description',
            label: 'Description of gifted property (Schedule)',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Residential flat bearing Flat No. 4B, 4th Floor, "Brigade Meadows", admeasuring 1,180 sq.ft. super built-up area, with one covered car park, situated on Sy. No. 88/2, Kanakapura Main Road, Bengaluru, bounded by:\nNorth: Flat 4A  South: Common passage  East: Open balcony  West: Flat 4C.',
          },
          { key: 'fair_market_value', label: 'Fair market value', type: 'currency', required: true, default: '8500000' },
          { key: 'acquisition_basis', label: "Donor's title / source", type: 'textarea', rows: 2, required: true, default: 'Acquired by Donor under registered Sale Deed dated 18.09.2015 (Doc. No. 6712/2015-16, SRO Begur), Khata No. 2841/4B.' },
          { key: 'encumbrance_status', label: 'Encumbrance status', type: 'text', required: true, default: 'Property is free from all encumbrances, mortgages and litigation, as confirmed by EC No. 2208/2026 dated 02.04.2026.' },
        ],
      },
      {
        title: 'Acceptance & Registration',
        fields: [
          { key: 'consideration_clause', label: 'Consideration / love-and-affection recital', type: 'text', required: true, default: 'Out of natural love and affection that the Donor bears for the Donee, his daughter, without any monetary consideration whatsoever.' },
          { key: 'acceptance_clause', label: 'Acceptance by donee', type: 'text', required: true, default: 'The Donee hereby gratefully accepts the gift during the lifetime of the Donor.' },
          { key: 'possession_handover', label: 'Possession', type: 'text', optional: true, default: 'Vacant physical possession is delivered to the Donee on execution of this Deed.' },
          { key: 'sub_registrar', label: 'Sub-Registrar of registration', type: 'text', required: true, default: 'Sub-Registrar Office, Begur, Bengaluru' },
        ],
      },
    ],
  },

  'Partition Deed': {
    category: 'Property & Family',
    description:
      'Divides joint / coparcenary / co-owned property among co-owners into separate shares. Governed by the Hindu Succession Act, 1956 (for HUF), Section 44 of the Transfer of Property Act, 1882 and personal-law principles.',
    sections: [
      {
        title: 'Co-owners / Coparceners',
        fields: [
          {
            key: 'parties',
            label: 'Names, ages & relationship of co-owners',
            type: 'textarea',
            rows: 5,
            required: true,
            default:
              '1. Shri Mahesh Sharma, S/o Late Shri Govind Sharma, aged 62 years (Karta) - Party No. 1\n2. Shri Sandeep Sharma, S/o Late Shri Govind Sharma, aged 58 years - Party No. 2\n3. Smt. Sunita Mishra, D/o Late Shri Govind Sharma, aged 55 years - Party No. 3\n4. Shri Rohan Sharma, S/o Shri Mahesh Sharma, aged 32 years (representing branch of Party No. 1) - Party No. 4',
          },
          { key: 'common_address', label: 'Address (if joint)', type: 'textarea', rows: 2, optional: true, default: 'Ancestral house at 32, Lawrence Road,\nAmritsar - 143001, Punjab' },
        ],
      },
      {
        title: 'Property Subject to Partition',
        fields: [
          {
            key: 'property_description',
            label: 'Description of joint property (Schedule-A)',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              '1. Residential plot bearing No. 32, Lawrence Road, Amritsar, admeasuring 500 sq. yards (Survey No. 2418/32).\n2. Agricultural land at Khasra No. 442, Village Jandiala Guru, Tehsil Amritsar-II, admeasuring 5 acres.\n3. Commercial shop bearing No. 17, Hall Bazaar, Amritsar.',
          },
          { key: 'acquisition_basis', label: 'How property became joint', type: 'textarea', rows: 2, required: true, default: 'Inherited from common ancestor Late Shri Govind Sharma (d. 14.08.2020) by intestate succession under the Hindu Succession Act, 1956.' },
          { key: 'aggregate_value', label: 'Aggregate value', type: 'currency', optional: true, default: '32500000' },
        ],
      },
      {
        title: 'Allotment',
        fields: [
          {
            key: 'share_allocation',
            label: 'Share allocation (one line per party)',
            type: 'textarea',
            rows: 5,
            required: true,
            default:
              'Party No. 1 (Mahesh): residential plot at Lawrence Road, valued at ₹1.2 cr (Schedule-B1).\nParty No. 2 (Sandeep): commercial shop, Hall Bazaar + ₹40 lakh cash equalisation, valued at ₹1.1 cr (Schedule-B2).\nParty No. 3 (Sunita): 5 acres at Jandiala Guru, valued at ₹85 lakh (Schedule-B3).\nParty No. 4 (Rohan): ₹35 lakh cash equalisation paid by Party No. 1 (Schedule-B4).',
          },
          { key: 'equalisation', label: 'Equalisation / owelty money', type: 'text', optional: true, default: '₹40 lakh paid by Party No. 1 to Party No. 2; ₹35 lakh paid by Party No. 1 to Party No. 4 on execution.' },
          { key: 'mutual_releases', label: 'Mutual release of claims', type: 'text', required: true, default: 'Each party releases and gives up all right, title and interest in the property allotted to the others.' },
        ],
      },
      {
        title: 'Registration',
        fields: [
          { key: 'possession_clause', label: 'Possession', type: 'text', optional: true, default: 'Each party shall be entitled to exclusive possession and enjoyment of the property allotted to him / her with effect from the date of registration.' },
          { key: 'sub_registrar', label: 'Sub-Registrar', type: 'text', required: true, default: 'Sub-Registrar Office, Amritsar (Urban)' },
          { key: 'execution_date', label: 'Date of execution', type: 'date', required: true, default: '2026-05-22' },
        ],
      },
    ],
  },

  'Relinquishment Deed': {
    category: 'Property & Family',
    description:
      'A co-owner relinquishes (renounces) his / her undivided share in joint property in favour of the remaining co-owners, without consideration. Requires registration under the Registration Act, 1908.',
    sections: [
      {
        title: 'Relinquisher',
        fields: [
          { key: 'releaser_name', label: 'Releaser / Relinquisher', type: 'text', required: true, default: 'Smt. Sunita Mishra, D/o Late Shri Govind Sharma' },
          { key: 'releaser_age', label: 'Age', type: 'number', required: true, default: '55' },
          { key: 'releaser_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'C-44, Lodhi Estate,\nNew Delhi - 110003' },
        ],
      },
      {
        title: 'Releasee(s)',
        fields: [
          {
            key: 'releasees',
            label: 'Releasee(s)',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              '1. Shri Mahesh Sharma, S/o Late Shri Govind Sharma, R/o 32, Lawrence Road, Amritsar - 143001.\n2. Shri Sandeep Sharma, S/o Late Shri Govind Sharma, R/o B-1, Model Town, Jalandhar - 144003.',
          },
          { key: 'relationship', label: 'Relationship', type: 'text', required: true, default: 'Real brothers (children of common parents)' },
        ],
      },
      {
        title: 'Joint Property & Share Released',
        fields: [
          {
            key: 'property_description',
            label: 'Description of joint property',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'Residential plot bearing No. 32, Lawrence Road, Amritsar, admeasuring 500 sq. yards, originally owned by Late Shri Govind Sharma, devolved on his three children (the Releaser and the Releasees) in equal 1/3rd shares by intestate succession.',
          },
          { key: 'share_released', label: 'Share being released', type: 'text', required: true, default: 'The Releaser\'s undivided 1/3rd share in the Schedule property' },
          { key: 'share_distribution', label: 'Distribution among releasees', type: 'text', optional: true, default: 'In favour of the Releasees in equal halves (1/6th each), so they end up holding 1/2 each.' },
        ],
      },
      {
        title: 'Consideration & Registration',
        fields: [
          { key: 'consideration', label: 'Consideration', type: 'text', required: true, default: 'NIL - released out of natural love and affection. No monetary consideration whatsoever.' },
          { key: 'no_revocation', label: 'Irrevocability', type: 'text', required: true, default: 'The relinquishment is absolute, voluntary and irrevocable; the Releaser shall have no future claim of any nature whatsoever.' },
          { key: 'sub_registrar', label: 'Sub-Registrar', type: 'text', required: true, default: 'Sub-Registrar Office, Amritsar (Urban)' },
        ],
      },
    ],
  },

  'Power of Attorney (General)': {
    category: 'Property & Family',
    description:
      'Authorises an attorney to act on the principal\'s behalf in respect of a class of matters. Governed by the Powers of Attorney Act, 1882 and stamped per state stamp laws. A GPA for transfer of immovable property is not a conveyance (Suraj Lamp v. State of Haryana, (2012) 1 SCC 656).',
    sections: [
      {
        title: 'Principal',
        fields: [
          { key: 'principal_name', label: 'Principal name', type: 'text', required: true, default: 'Shri Vikram Iyengar' },
          { key: 'principal_age', label: 'Age', type: 'number', required: true, default: '52' },
          { key: 'principal_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: '24, 5th Cross, Jayanagar 4th Block,\nBengaluru - 560011' },
          { key: 'principal_id', label: 'PAN / Aadhaar', type: 'text', optional: true, default: 'AGVPI8821J / XXXX XXXX 4502' },
        ],
      },
      {
        title: 'Attorney',
        fields: [
          { key: 'attorney_name', label: 'Attorney name', type: 'text', required: true, default: 'Shri Karthik Iyengar' },
          { key: 'attorney_age', label: 'Age', type: 'number', required: true, default: '40' },
          { key: 'attorney_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'Flat 7B, Sobha Pristine,\nWhitefield Main Road, Bengaluru - 560066' },
          { key: 'relationship', label: 'Relationship to principal', type: 'text', optional: true, default: 'Real brother' },
        ],
      },
      {
        title: 'Powers Granted',
        fields: [
          {
            key: 'powers_description',
            label: 'Class of acts authorised',
            type: 'textarea',
            rows: 5,
            required: true,
            default:
              "a) To manage all immovable properties owned by the Principal in Karnataka including collection of rent, payment of taxes / utility bills, and dealing with municipal authorities;\nb) To represent the Principal before any tax, regulatory or revenue authority;\nc) To operate the Principal's bank accounts in Karnataka, deposit / withdraw amounts, issue cheques up to ₹5,00,000 per transaction;\nd) To engage and instruct advocates, file / defend civil proceedings, sign vakalatnamas;\ne) To execute and register lease agreements not exceeding 11 months and 11 days.",
          },
          { key: 'powers_excluded', label: 'Powers expressly excluded', type: 'textarea', rows: 2, optional: true, default: 'Sale, gift or mortgage of immovable property; transactions exceeding ₹5,00,000; matters relating to the Principal\'s minor children.' },
        ],
      },
      {
        title: 'Term & Revocation',
        fields: [
          { key: 'effective_date', label: 'Effective date', type: 'date', required: true, default: '2026-05-25' },
          { key: 'duration', label: 'Duration', type: 'text', required: true, default: '24 months from effective date, unless revoked earlier in writing.' },
          { key: 'revocation_clause', label: 'Revocation', type: 'text', required: true, default: 'Revocable by the Principal at any time on written notice to the Attorney; revocation effective on the date of receipt.' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law; courts at Bengaluru shall have jurisdiction.' },
        ],
      },
    ],
  },

  'Power of Attorney (Specific)': {
    category: 'Property & Family',
    description:
      'Authorises an attorney to do one or more specific acts only - typically used for a single transaction (sale, share-transfer, court appearance). Governed by the Powers of Attorney Act, 1882.',
    sections: [
      {
        title: 'Principal',
        fields: [
          { key: 'principal_name', label: 'Principal name', type: 'text', required: true, default: 'Smt. Neha Verma, W/o Shri Suresh Verma' },
          { key: 'principal_age', label: 'Age', type: 'number', required: true, default: '46' },
          { key: 'principal_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: '212 Lansdowne Building, Charles Street,\nLondon W1B 1XX, United Kingdom' },
        ],
      },
      {
        title: 'Attorney',
        fields: [
          { key: 'attorney_name', label: 'Attorney name', type: 'text', required: true, default: 'Shri Anand Kapoor, Advocate' },
          { key: 'attorney_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'Chamber No. 27, Advocates\' Block,\nHigh Court Complex, Ambedkar Veedhi,\nBengaluru - 560001' },
          { key: 'relationship', label: 'Relationship / capacity', type: 'text', optional: true, default: 'Engaged advocate' },
        ],
      },
      {
        title: 'Specific Act Authorised',
        fields: [
          {
            key: 'specific_act',
            label: 'Specific act / transaction',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'To execute and register the Sale Deed in respect of Flat No. 4B, 4th Floor, "Brigade Meadows", Kanakapura Main Road, Bengaluru, for a consideration of ₹1.25 crore in favour of Smt. Priya Menon, and to receive the entire sale consideration and execute receipts therefor on behalf of the Principal.',
          },
          { key: 'property_or_subject', label: 'Property / subject reference', type: 'text', required: true, default: 'Flat No. 4B, "Brigade Meadows", Kanakapura Main Road, Bengaluru - 560082' },
          { key: 'consideration_handling', label: 'Treatment of consideration / proceeds', type: 'text', optional: true, default: 'Attorney shall remit the entire consideration to the Principal\'s NRO bank account at HDFC Bank, Jayanagar branch (A/c No. 50100123456) within 7 days of receipt.' },
        ],
      },
      {
        title: 'Term & Boilerplate',
        fields: [
          { key: 'effective_date', label: 'Effective date', type: 'date', required: true, default: '2026-05-25' },
          { key: 'expiry', label: 'Expiry', type: 'text', required: true, default: 'Stands extinguished on completion of the specific act, or on 31.12.2026, whichever is earlier.' },
          { key: 'revocation_clause', label: 'Revocation', type: 'text', optional: true, default: 'Revocable in writing at any time before the act is performed.' },
          { key: 'apostille_note', label: 'Notarisation / apostille (if executed abroad)', type: 'text', optional: true, default: 'Executed in London; notarised and apostilled under the Hague Convention before use in India.' },
        ],
      },
    ],
  },

  'Trust Deed': {
    category: 'Property & Family',
    description:
      'Settles property on trustees to be held for the benefit of named or charitable beneficiaries. Governed by the Indian Trusts Act, 1882 (private trusts) or applicable state Public Trusts Acts (charitable / religious trusts).',
    sections: [
      {
        title: 'Settlor & Trustees',
        fields: [
          { key: 'settlor_name', label: 'Settlor / Author of Trust', type: 'text', required: true, default: 'Shri Ramesh Iyer, S/o Late Shri Krishnan Iyer' },
          { key: 'settlor_address', label: 'Settlor address', type: 'textarea', rows: 2, required: true, default: 'No. 11, Cunningham Road,\nBengaluru - 560052' },
          {
            key: 'trustees',
            label: 'Trustees (names, ages, addresses)',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              '1. Smt. Priya Menon, aged 34, of Flat 4B, Brigade Meadows, Bengaluru - 560082 (Managing Trustee).\n2. Shri Arjun Menon, aged 38, of Flat 4B, Brigade Meadows, Bengaluru - 560082 (Trustee).\n3. CA Rakesh Bhat, aged 51, of 14, Vasant Vihar, Bengaluru - 560085 (Independent Trustee).',
          },
          { key: 'min_trustees', label: 'Minimum number of trustees', type: 'number', required: true, default: '3' },
        ],
      },
      {
        title: 'Trust Particulars',
        fields: [
          { key: 'trust_name', label: 'Name of the Trust', type: 'text', required: true, default: 'Iyer Family Welfare Trust' },
          { key: 'trust_type', label: 'Trust type', type: 'select', options: ['Private Specific', 'Private Discretionary', 'Public Charitable', 'Public Religious'], required: true, default: 'Private Discretionary' },
          { key: 'office_address', label: 'Registered office of trust', type: 'text', required: true, default: 'No. 11, Cunningham Road, Bengaluru - 560052' },
          {
            key: 'objects',
            label: 'Objects of the Trust',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'a) Maintenance, welfare and education of the lineal descendants of the Settlor;\nb) Medical care of the Settlor\'s spouse and children;\nc) Payment of scholarships to deserving students from the extended Iyer family;\nd) Such other family-welfare purposes as the Trustees may from time to time approve.',
          },
        ],
      },
      {
        title: 'Trust Property & Beneficiaries',
        fields: [
          {
            key: 'trust_property',
            label: 'Property settled on trust (corpus)',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              '1. Cash of ₹50,00,000 transferred by RTGS to the trust\'s account on execution.\n2. Residential flat at No. 14, Cunningham Lofts, Bengaluru (Sy. No. 88/3) valued at ₹3.2 crore.\n3. Equity shares of M/s Iyer Family Holdings Pvt. Ltd. - 4,800 shares of ₹10 each.',
          },
          { key: 'beneficiaries', label: 'Beneficiaries', type: 'textarea', rows: 2, required: true, default: 'Lineal descendants of the Settlor, his spouse Smt. Lakshmi Iyer, his daughter Smt. Priya Menon and grandchildren born / to be born.' },
        ],
      },
      {
        title: 'Administration',
        fields: [
          { key: 'quorum', label: 'Quorum / decision-making', type: 'text', optional: true, default: 'Majority of Trustees in meeting; ties broken by Managing Trustee.' },
          { key: 'investment_powers', label: 'Investment powers', type: 'text', optional: true, default: 'Trustees may invest in bank fixed deposits, government securities, listed equity / mutual funds and immovable property in India - no speculative investments.' },
          { key: 'duration', label: 'Duration', type: 'text', required: true, default: 'Perpetual, subject to the rule against perpetuities under the Transfer of Property Act, 1882.' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law; courts at Bengaluru shall have jurisdiction.' },
        ],
      },
    ],
  },

  Will: {
    category: 'Property & Family',
    description:
      "Testamentary disposition of the testator's property to take effect after death. Governed by the Indian Succession Act, 1925 (Hindus, Christians, Parsis - personal-law concepts apply to Muslims). No registration required, but advisable; probate required in specified jurisdictions.",
    sections: [
      {
        title: 'Testator',
        fields: [
          { key: 'testator_name', label: 'Testator name', type: 'text', required: true, default: 'Shri Ramesh Iyer, S/o Late Shri Krishnan Iyer' },
          { key: 'testator_age', label: 'Age', type: 'number', required: true, default: '68' },
          { key: 'testator_address', label: 'Residence', type: 'textarea', rows: 2, required: true, default: 'No. 11, Cunningham Road,\nBengaluru - 560052, Karnataka' },
          { key: 'religion', label: 'Religion / personal law', type: 'select', options: ['Hindu', 'Christian', 'Parsi', 'Muslim', 'Other'], required: true, default: 'Hindu' },
          { key: 'soundness_recital', label: 'Soundness of mind recital', type: 'text', required: true, default: 'I am in sound and disposing state of mind, free from any coercion, undue influence or fraud, and am executing this Will of my own free volition.' },
        ],
      },
      {
        title: 'Revocation',
        fields: [
          { key: 'revocation_clause', label: 'Revocation of prior wills', type: 'text', required: true, default: 'I hereby revoke all previous wills, codicils and testamentary dispositions made by me at any time prior to this Will.' },
        ],
      },
      {
        title: 'Executor & Family',
        fields: [
          { key: 'executor_name', label: 'Executor', type: 'text', required: true, default: 'Smt. Priya Menon (daughter), of Flat 4B, Brigade Meadows, Bengaluru - 560082' },
          { key: 'alternate_executor', label: 'Alternate executor', type: 'text', optional: true, default: 'CA Rakesh Bhat, of 14, Vasant Vihar, Bengaluru - 560085' },
          {
            key: 'family_details',
            label: 'Family / dependants',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'I have one wife - Smt. Lakshmi Iyer, aged 64, and one daughter - Smt. Priya Menon, aged 34. I have no other natural or adopted children.',
          },
        ],
      },
      {
        title: 'Bequests',
        fields: [
          {
            key: 'bequests',
            label: 'Specific bequests',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              'a) My residential house at No. 11, Cunningham Road, Bengaluru, absolutely to my wife Smt. Lakshmi Iyer.\nb) On my wife predeceasing me, the said house to devolve on my daughter Smt. Priya Menon absolutely.\nc) All my equity-share holdings in M/s Iyer Family Holdings Pvt. Ltd. to my daughter Smt. Priya Menon absolutely.\nd) Cash and bank balances aggregating to ₹1 crore to be divided equally between my wife and my daughter.\ne) My jewellery and personal effects to my wife absolutely.',
          },
          { key: 'residuary_clause', label: 'Residuary clause', type: 'text', optional: true, default: 'All the rest, residue and remainder of my estate, of whatever nature and wherever situate, shall pass absolutely to my daughter Smt. Priya Menon.' },
        ],
      },
      {
        title: 'Execution & Witnesses',
        fields: [
          { key: 'place_of_execution', label: 'Place of execution', type: 'text', required: true, default: 'Bengaluru' },
          { key: 'date_of_execution', label: 'Date', type: 'date', required: true, default: '2026-05-22' },
          {
            key: 'witnesses',
            label: 'Two attesting witnesses (name & address)',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              '1. Dr. Anand Rao, MBBS, of 27, 8th Main, Indiranagar 1st Stage, Bengaluru - 560038.\n2. Adv. Suresh Pillai, Enrolment No. KAR/2310/2009, of Chamber No. 14, City Civil Court Complex, Bengaluru - 560001.',
          },
        ],
      },
    ],
  },

  'Family Settlement Agreement': {
    category: 'Property & Family',
    description:
      "Settles disputes or potential disputes among family members touching family property by mutual concessions. Bona fide settlements are not transfers and may be exempt from stamp / capital-gains tax (Kale v. Dy. Director of Consolidation, (1976) 3 SCC 119).",
    sections: [
      {
        title: 'Family Members',
        fields: [
          {
            key: 'parties',
            label: 'Names, ages & relationship',
            type: 'textarea',
            rows: 5,
            required: true,
            default:
              '1. Shri Mahesh Sharma, S/o Late Shri Govind Sharma, aged 62 - Party No. 1 (eldest son)\n2. Shri Sandeep Sharma, aged 58 - Party No. 2 (second son)\n3. Smt. Sunita Mishra, aged 55 - Party No. 3 (daughter)\n4. Smt. Kamla Devi, aged 84 - Party No. 4 (mother / widow of Late Govind Sharma)',
          },
        ],
      },
      {
        title: 'Background & Disputes',
        fields: [
          {
            key: 'background',
            label: 'Background of family property',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'On the demise of Late Shri Govind Sharma on 14.08.2020, all immovable / movable assets owned by him devolved by intestate succession on the parties hereto in equal shares under the Hindu Succession Act, 1956. The parties have, since then, had differences in respect of management and use of the family properties.',
          },
          {
            key: 'disputes',
            label: 'Disputes / claims being settled',
            type: 'textarea',
            rows: 3,
            optional: true,
            default:
              'Pending suit O.S. No. 1247 of 2024 filed by Party No. 3 against Party Nos. 1 & 2 before the Civil Judge, Senior Division, Amritsar, for declaration and partition. Differences regarding rent collected from commercial shop at Hall Bazaar by Party No. 1 since 2020.',
          },
        ],
      },
      {
        title: 'Settlement Terms',
        fields: [
          {
            key: 'settlement_terms',
            label: 'Terms of settlement',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              'a) Party No. 1 retains exclusive ownership of the residential plot at Lawrence Road and pays ₹35 lakh to Party No. 4 by RTGS within 30 days.\nb) Party No. 2 takes the commercial shop at Hall Bazaar with arrears of rent waived in his favour.\nc) Party No. 3 takes 5 acres at Jandiala Guru plus ₹15 lakh paid by Party No. 1.\nd) Party No. 4 (mother) retains the right to reside in the Lawrence Road house for life, and receives ₹35 lakh from Party No. 1.\ne) Suit O.S. No. 1247 / 2024 to be withdrawn within 14 days.\nf) Parties release each other from all claims relating to the estate of Late Govind Sharma.',
          },
          { key: 'no_revocation', label: 'Finality & no-revocation', type: 'text', required: true, default: 'This settlement is final, binding and irrevocable; each party releases the others from all past, present and future claims relating to the family property.' },
        ],
      },
      {
        title: 'Registration & Boilerplate',
        fields: [
          { key: 'registration_clause', label: 'Stamp / registration treatment', type: 'text', optional: true, default: 'The settlement records pre-existing rights and is not a transfer; parties shall present this Agreement for registration in line with Kale v. Dy. Director of Consolidation, (1976) 3 SCC 119.' },
          { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true, default: 'Courts at Amritsar shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Adoption Deed': {
    category: 'Property & Family',
    description:
      'Records the giving and taking of a child in adoption. Governed by the Hindu Adoptions & Maintenance Act, 1956 (for Hindus, Buddhists, Jains, Sikhs) or the Juvenile Justice Act, 2015 (statutory adoption open to all communities).',
    sections: [
      {
        title: 'Adoptive Parent(s)',
        fields: [
          { key: 'adoptive_father_name', label: 'Adoptive father', type: 'text', required: true, default: 'Shri Aniruddh Khanna, S/o Shri Vivek Khanna' },
          { key: 'adoptive_father_age', label: 'Father age', type: 'number', required: true, default: '42' },
          { key: 'adoptive_mother_name', label: 'Adoptive mother', type: 'text', required: true, default: 'Smt. Riya Khanna, W/o Shri Aniruddh Khanna' },
          { key: 'adoptive_mother_age', label: 'Mother age', type: 'number', required: true, default: '39' },
          { key: 'adoptive_address', label: 'Adoptive parents\' address', type: 'textarea', rows: 2, required: true, default: 'A-22, Sector 16,\nNoida - 201301, Uttar Pradesh' },
          { key: 'religion', label: 'Religion of adoptive parents', type: 'select', options: ['Hindu', 'Buddhist', 'Jain', 'Sikh', 'Statutory (JJ Act)'], required: true, default: 'Hindu' },
        ],
      },
      {
        title: 'Natural Parent(s) / Guardian',
        fields: [
          { key: 'natural_father_name', label: 'Natural father (if alive)', type: 'text', optional: true, default: 'Shri Suresh Pillai (deceased - 02.04.2024)' },
          { key: 'natural_mother_name', label: 'Natural mother (if alive)', type: 'text', required: true, default: 'Smt. Lakshmi Pillai, W/o Late Shri Suresh Pillai' },
          { key: 'natural_address', label: 'Natural parent / guardian address', type: 'textarea', rows: 2, required: true, default: 'House No. 142, Kalpetta Road,\nWayanad - 673121, Kerala' },
          { key: 'consent_recital', label: 'Consent recital', type: 'textarea', rows: 2, required: true, default: 'The natural mother, after the demise of the natural father, with full understanding and free consent and out of consideration for the welfare of the child, has agreed to give the child in adoption.' },
        ],
      },
      {
        title: 'Adopted Child',
        fields: [
          { key: 'child_name', label: 'Name of child', type: 'text', required: true, default: 'Master Aarav Pillai (to be renamed Aarav Khanna)' },
          { key: 'child_dob', label: 'Date of birth', type: 'date', required: true, default: '2020-11-08' },
          { key: 'child_gender', label: 'Gender', type: 'select', options: ['Male', 'Female'], required: true, default: 'Male' },
          { key: 'no_other_child_recital', label: 'No-other-child recital (HAMA §11)', type: 'text', optional: true, default: 'The adoptive parents do not have a Hindu son / son\'s son / son\'s son\'s son living at the time of adoption, and the child has not already been adopted by anyone.' },
        ],
      },
      {
        title: 'Giving & Taking',
        fields: [
          { key: 'giving_taking_recital', label: 'Ceremony of giving & taking', type: 'textarea', rows: 3, required: true, default: 'The natural mother has actually given and the adoptive parents have actually taken the child in adoption in the presence of the witnesses named hereunder, in accordance with the customary rites and ceremonies of the Hindu community, on 22.05.2026 at Noida.' },
          { key: 'date_of_adoption', label: 'Date of adoption', type: 'date', required: true, default: '2026-05-22' },
          { key: 'place', label: 'Place of execution', type: 'text', required: true, default: 'Noida, Uttar Pradesh' },
          {
            key: 'witnesses',
            label: 'Two witnesses',
            type: 'textarea',
            rows: 2,
            optional: true,
            default:
              '1. Shri Rohan Khanna (paternal uncle), of B-14, Sector 16, Noida.\n2. Smt. Lalitha Pillai (maternal aunt), of House No. 88, Kalpetta Road, Wayanad.',
          },
        ],
      },
    ],
  },

  'Pre-nuptial Agreement': {
    category: 'Property & Family',
    description:
      'Records the parties\' understanding on property, maintenance and inheritance to apply on or after marriage / separation. Enforceability in India is uncertain - personal-law statutes generally treat such agreements as opposed to public policy under §23 of the Indian Contract Act, 1872; nonetheless persuasive for division of self-acquired property.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'party_a_name', label: 'Intended spouse A', type: 'text', required: true, default: 'Shri Aarav Bansal, S/o Shri Vivek Bansal' },
          { key: 'party_a_age', label: 'Age', type: 'number', required: true, default: '34' },
          { key: 'party_a_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'B-401, Magnolias,\nDLF Phase V, Gurugram - 122002' },
          { key: 'party_b_name', label: 'Intended spouse B', type: 'text', required: true, default: 'Smt. Ananya Mehta, D/o Shri Rakesh Mehta' },
          { key: 'party_b_age', label: 'Age', type: 'number', required: true, default: '31' },
          { key: 'party_b_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'C-21, Vasant Vihar,\nNew Delhi - 110057' },
          { key: 'wedding_date', label: 'Intended date of marriage', type: 'date', required: true, default: '2026-12-08' },
        ],
      },
      {
        title: 'Disclosures',
        fields: [
          {
            key: 'party_a_disclosure',
            label: 'Spouse A - assets & liabilities disclosure',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Assets: Apartment at DLF Phase V (valued ₹4.2 cr), ESOP holdings in Nexora Pvt. Ltd. (valued ₹1.5 cr at last 409A), mutual fund portfolio (₹85 lakh), gold and watches (₹20 lakh).\nLiabilities: Home loan with HDFC Bank - outstanding ₹1.4 cr.',
          },
          {
            key: 'party_b_disclosure',
            label: 'Spouse B - assets & liabilities disclosure',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Assets: Inheritance from grandfather (commercial property at Connaught Place, ₹3.8 cr), equity portfolio (₹50 lakh), jewellery (₹40 lakh), partnership interest in M/s Mehta & Co. CAs.\nLiabilities: Nil.',
          },
        ],
      },
      {
        title: 'Property Treatment',
        fields: [
          { key: 'separate_property_clause', label: 'Separate property', type: 'textarea', rows: 2, required: true, default: 'All assets owned by each party as of the date of marriage (per the disclosures above), and any inheritances received during the marriage, shall remain the exclusive separate property of that party.' },
          { key: 'joint_property_clause', label: 'Marital / joint property', type: 'textarea', rows: 2, optional: true, default: 'Assets jointly purchased during the marriage in joint names shall be held in 50:50 ratio, irrespective of who contributed funds.' },
          { key: 'maintenance_clause', label: 'Maintenance on separation', type: 'textarea', rows: 2, optional: true, default: 'Each party waives any claim for spousal maintenance, save and except statutory rights of any minor child / children, which are non-waivable.' },
          { key: 'inheritance_clause', label: 'Inheritance on death', type: 'text', optional: true, default: 'Each party shall be free to dispose of his / her separate property by Will or otherwise; no claim by survivor on separate property.' },
        ],
      },
      {
        title: 'Independent Legal Advice & Boilerplate',
        fields: [
          { key: 'independent_advice', label: 'Independent legal advice recital', type: 'text', required: true, default: 'Each party has received independent legal advice before execution - Spouse A by Adv. Arjun Saigal; Spouse B by Adv. Meera Iyer.' },
          { key: 'no_duress', label: 'No duress / fair disclosure', type: 'text', required: true, default: 'Executed voluntarily, with full disclosure of assets and without any coercion or undue influence.' },
          { key: 'governing_law', label: 'Governing law & jurisdiction', type: 'text', required: true, default: 'Indian law; courts at New Delhi shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Post-nuptial Agreement': {
    category: 'Property & Family',
    description:
      'Executed during subsisting marriage to record the spouses\' understanding on property, maintenance and inheritance. Same enforceability caveats as pre-nuptial agreements (Section 23 of the Indian Contract Act, 1872).',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'husband_name', label: 'Husband', type: 'text', required: true, default: 'Shri Aarav Bansal' },
          { key: 'husband_age', label: 'Husband age', type: 'number', required: true, default: '36' },
          { key: 'wife_name', label: 'Wife', type: 'text', required: true, default: 'Smt. Ananya Bansal' },
          { key: 'wife_age', label: 'Wife age', type: 'number', required: true, default: '33' },
          { key: 'marriage_date', label: 'Date of marriage', type: 'date', required: true, default: '2026-12-08' },
          { key: 'matrimonial_address', label: 'Matrimonial home', type: 'textarea', rows: 2, required: true, default: 'B-401, Magnolias,\nDLF Phase V, Gurugram - 122002' },
        ],
      },
      {
        title: 'Children & Background',
        fields: [
          { key: 'children_details', label: 'Children of the marriage', type: 'textarea', rows: 2, optional: true, default: 'Master Arjun Bansal, aged 4 years, S/o the parties.' },
          { key: 'background_recital', label: 'Background / occasion', type: 'textarea', rows: 3, optional: true, default: 'The parties have, after due reflection and on receipt of independent legal advice, decided to formalise their understanding regarding ownership and division of property accumulated during the subsistence of the marriage, having regard to the wife\'s contribution to the household and family business.' },
        ],
      },
      {
        title: 'Property & Maintenance',
        fields: [
          {
            key: 'property_terms',
            label: 'Property arrangement',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'a) The matrimonial home at B-401 Magnolias shall be transferred to joint names of the spouses by way of Gift Deed within 60 days.\n2 (sic) b) Equity portfolio of ₹85 lakh held by the husband shall be transferred 50% to the wife on execution.\nc) Future inheritances received by either party shall remain that party\'s separate property.\nd) Joint bank accounts opened during the marriage shall continue to be operated severally and jointly.',
          },
          { key: 'maintenance_terms', label: 'Maintenance / financial support', type: 'textarea', rows: 2, optional: true, default: 'In the event of separation, the husband shall pay ₹1,50,000 per month to the wife for life or until remarriage, plus all educational expenses of the minor child.' },
          { key: 'custody_recital', label: 'Custody of child (non-binding indicator)', type: 'text', optional: true, default: 'The parties indicate joint legal custody with primary physical custody to the mother and structured visitation to the father - subject always to the welfare-of-the-child principle.' },
        ],
      },
      {
        title: 'Independent Advice & Boilerplate',
        fields: [
          { key: 'independent_advice', label: 'Independent legal advice', type: 'text', required: true, default: 'Both spouses confirm independent legal advice prior to execution - husband by Adv. Arjun Saigal; wife by Adv. Meera Iyer.' },
          { key: 'no_coercion', label: 'No coercion / fair disclosure', type: 'text', required: true, default: 'Executed voluntarily, after full disclosure of assets and liabilities, without coercion or undue influence.' },
          { key: 'governing_law', label: 'Governing law & jurisdiction', type: 'text', required: true, default: 'Indian law; courts at Gurugram / New Delhi shall have jurisdiction.' },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Specialised
  // ---------------------------------------------------------------------------

  'Arbitration Agreement': {
    category: 'Specialised',
    description:
      'Standalone agreement to refer present or future disputes to arbitration. Governed by Section 7 of the Arbitration & Conciliation Act, 1996; must be in writing.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'party_a_name', label: 'Party A', type: 'text', required: true, default: 'Northwind Logistics Pvt. Ltd.' },
          { key: 'party_a_address', label: 'Party A address', type: 'textarea', rows: 2, required: true, default: 'Office 14, World Trade Center,\nKharadi, Pune - 411014' },
          { key: 'party_b_name', label: 'Party B', type: 'text', required: true, default: 'OceanRoute Shipping LLP' },
          { key: 'party_b_address', label: 'Party B address', type: 'textarea', rows: 2, required: true, default: '5th Floor, Marathon Futurex,\nLower Parel, Mumbai - 400013' },
        ],
      },
      {
        title: 'Scope & Underlying Contract',
        fields: [
          { key: 'underlying_contract', label: 'Underlying contract / transaction', type: 'text', optional: true, default: 'Master Services Agreement dated 14.04.2025 between the Parties' },
          { key: 'scope', label: 'Scope of arbitrable disputes', type: 'textarea', rows: 3, required: true, default: 'All disputes, differences or claims arising out of or in connection with the underlying contract, including its existence, validity, performance, breach, interpretation or termination, shall be referred to and finally resolved by arbitration.' },
          { key: 'excluded_matters', label: 'Excluded matters (non-arbitrable)', type: 'text', optional: true, default: 'Criminal matters; insolvency / winding-up; tenancy under rent-control statutes; matrimonial; testamentary - per Vidya Drolia v. Durga Trading Corp. (2021) 2 SCC 1.' },
        ],
      },
      {
        title: 'Tribunal',
        fields: [
          { key: 'number_of_arbitrators', label: 'Number of arbitrators', type: 'select', options: ['Sole arbitrator', 'Three arbitrators'], required: true, default: 'Sole arbitrator' },
          { key: 'appointment_mechanism', label: 'Appointment mechanism', type: 'textarea', rows: 3, required: true, default: 'Sole arbitrator: appointed by mutual consent within 30 days of notice of dispute; failing which, appointment by the Hon\'ble High Court of Bombay under §11 of the A&C Act, 1996.\n[Or for 3 arbitrators: one each by the Parties and the presiding arbitrator chosen by the two so-appointed arbitrators.]' },
          { key: 'institutional_rules', label: 'Institutional rules', type: 'select', options: ['Ad hoc (rules of A&C Act, 1996)', 'MCIA Rules', 'DIAC Rules', 'SIAC Rules', 'ICC Rules', 'LCIA Rules'], required: true, default: 'MCIA Rules' },
        ],
      },
      {
        title: 'Seat, Venue & Boilerplate',
        fields: [
          { key: 'seat', label: 'Seat of arbitration', type: 'text', required: true, default: 'Mumbai' },
          { key: 'venue', label: 'Venue of hearings', type: 'text', optional: true, default: 'Mumbai (or such other place as the Parties may mutually agree)' },
          { key: 'language', label: 'Language of arbitration', type: 'select', options: ['English', 'Hindi', 'Bilingual'], required: true, default: 'English' },
          { key: 'interim_relief', label: 'Court for §9 / §27 interim relief', type: 'text', optional: true, default: 'High Court of Bombay shall have exclusive jurisdiction for interim relief under §9 and assistance under §27.' },
          { key: 'governing_law', label: 'Substantive governing law', type: 'text', required: true, default: 'Indian law' },
        ],
      },
    ],
  },

  'Indemnity Bond': {
    category: 'Specialised',
    description:
      'A contract by which one party promises to save the other from loss caused by the conduct of the promisor or any third party. Governed by Section 124 of the Indian Contract Act, 1872.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'indemnifier_name', label: 'Indemnifier (executant)', type: 'text', required: true, default: 'Shri Vikram Iyengar, S/o Shri Krishna Iyengar' },
          { key: 'indemnifier_address', label: 'Indemnifier address', type: 'textarea', rows: 2, required: true, default: '24, 5th Cross, Jayanagar 4th Block,\nBengaluru - 560011' },
          { key: 'indemnifier_id', label: 'PAN / Aadhaar', type: 'text', optional: true, default: 'AGVPI8821J / XXXX XXXX 4502' },
          { key: 'indemnified_name', label: 'Indemnified party', type: 'text', required: true, default: 'HDFC Bank Ltd., Jayanagar Branch, Bengaluru' },
          { key: 'indemnified_address', label: 'Indemnified address', type: 'textarea', rows: 2, required: true, default: 'HDFC Bank Ltd., 11th Main, 4th Block,\nJayanagar, Bengaluru - 560011' },
        ],
      },
      {
        title: 'Occasion / Recital',
        fields: [
          {
            key: 'occasion',
            label: 'Occasion / cause for indemnity',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              "The Indemnifier has applied for issuance of a duplicate Fixed Deposit Receipt bearing FDR No. 50300/AGJ/04421 dated 14.02.2024 for ₹15,00,000, the original of which has been lost / misplaced and despite diligent search cannot be traced.",
          },
          { key: 'value_at_risk', label: 'Amount / value at risk', type: 'currency', required: true, default: '1500000' },
        ],
      },
      {
        title: 'Covenant of Indemnity',
        fields: [
          {
            key: 'indemnity_covenant',
            label: 'Covenant of indemnity',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'The Indemnifier hereby agrees to keep the Indemnified party indemnified and harmless against all losses, damages, claims, suits, costs, charges and expenses which the Indemnified party may suffer or incur by reason of issuing the duplicate FDR, if the original FDR is subsequently produced by any third party or any adverse claim is made against the Indemnified party in relation thereto.',
          },
          { key: 'indemnity_cap', label: 'Indemnity cap (if any)', type: 'currency', optional: true, default: '3000000' },
          { key: 'survival', label: 'Survival', type: 'text', optional: true, default: 'The indemnity shall remain in full force until the limitation period for any third-party claim expires.' },
        ],
      },
      {
        title: 'Execution',
        fields: [
          { key: 'place_of_execution', label: 'Place of execution', type: 'text', required: true, default: 'Bengaluru' },
          { key: 'date_of_execution', label: 'Date', type: 'date', required: true, default: '2026-05-22' },
          {
            key: 'witnesses',
            label: 'Witnesses',
            type: 'textarea',
            rows: 2,
            optional: true,
            default:
              '1. Dr. Anand Rao, of 27, 8th Main, Indiranagar 1st Stage, Bengaluru - 560038.\n2. Smt. Geetha Iyengar (spouse), of 24, 5th Cross, Jayanagar 4th Block, Bengaluru - 560011.',
          },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law; courts at Bengaluru shall have jurisdiction.' },
        ],
      },
    ],
  },

  'Guarantee Bond': {
    category: 'Specialised',
    description:
      'A contract to perform the promise, or discharge the liability, of a third person in case of his default. Governed by Sections 126-147 of the Indian Contract Act, 1872. Common forms: continuing guarantee, performance guarantee, bank guarantee (BG).',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'surety_name', label: 'Surety / Guarantor', type: 'text', required: true, default: 'Shri Mahesh Sharma' },
          { key: 'surety_address', label: 'Guarantor address', type: 'textarea', rows: 2, required: true, default: '32, Lawrence Road,\nAmritsar - 143001, Punjab' },
          { key: 'principal_debtor_name', label: 'Principal debtor', type: 'text', required: true, default: 'M/s Sharma Trading Co. (proprietorship of Shri Sandeep Sharma)' },
          { key: 'principal_debtor_address', label: 'Principal debtor address', type: 'textarea', rows: 2, required: true, default: 'Shop No. 17, Hall Bazaar,\nAmritsar - 143001' },
          { key: 'creditor_name', label: 'Creditor / Beneficiary', type: 'text', required: true, default: 'Punjab National Bank, Civil Lines Branch, Amritsar' },
          { key: 'creditor_address', label: 'Creditor address', type: 'textarea', rows: 2, required: true, default: 'Punjab National Bank, Civil Lines,\nAmritsar - 143001' },
        ],
      },
      {
        title: 'Underlying Liability',
        fields: [
          { key: 'underlying_facility', label: 'Underlying facility / contract', type: 'text', required: true, default: 'Cash Credit facility of ₹50,00,000 sanctioned by Punjab National Bank to the principal debtor vide Sanction Letter Ref. CC/ASR/2026/4421 dated 02.04.2026.' },
          { key: 'guaranteed_amount', label: 'Guaranteed amount (max liability)', type: 'currency', required: true, default: '5000000' },
          { key: 'guarantee_type', label: 'Type of guarantee', type: 'select', options: ['Continuing guarantee', 'Specific / single transaction', 'Performance guarantee', 'Financial / payment guarantee', 'Bid-bond'], required: true, default: 'Continuing guarantee' },
        ],
      },
      {
        title: 'Surety\'s Obligations',
        fields: [
          {
            key: 'guarantee_covenant',
            label: 'Surety\'s covenant',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'The Surety hereby unconditionally and irrevocably guarantees to the Creditor the due and punctual repayment by the Principal Debtor of all monies due under the facility, with interest, costs and charges thereon, up to a maximum aggregate liability of ₹50,00,000, and undertakes that on the Principal Debtor\'s default the Surety shall pay the entire outstanding amount within 7 days of written demand without protest, demur or proof of default.',
          },
          { key: 'continuing_clause', label: 'Continuing-guarantee clause (if applicable)', type: 'text', optional: true, default: 'This is a continuing guarantee covering all transactions and renewals of the facility until expressly revoked in writing under §130 of the Indian Contract Act, 1872.' },
          { key: 'co_extensive_liability', label: 'Co-extensive liability', type: 'text', optional: true, default: 'Surety\'s liability is co-extensive with that of the Principal Debtor; Creditor need not first proceed against the Principal Debtor or any security held.' },
        ],
      },
      {
        title: 'Term & Revocation',
        fields: [
          { key: 'effective_date', label: 'Effective date', type: 'date', required: true, default: '2026-05-25' },
          { key: 'expiry', label: 'Expiry / validity', type: 'text', required: true, default: 'Until the facility is fully repaid and all liabilities discharged.' },
          { key: 'revocation_notice_days', label: 'Revocation notice (days, future transactions only)', type: 'number', optional: true, default: '30' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law; courts at Amritsar shall have jurisdiction.' },
        ],
      },
    ],
  },

  'Pledge Agreement': {
    category: 'Specialised',
    description:
      'Bailment of goods / securities as security for payment of a debt. Governed by Sections 172-181 of the Indian Contract Act, 1872; possession of pledged goods passes to the pledgee.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'pledgor_name', label: 'Pledgor / Pawnor', type: 'text', required: true, default: 'Shri Karan Bhatia' },
          { key: 'pledgor_address', label: 'Pledgor address', type: 'textarea', rows: 2, required: true, default: '14, Pali Hill, Bandra (W),\nMumbai - 400050' },
          { key: 'pledgee_name', label: 'Pledgee / Pawnee', type: 'text', required: true, default: 'M/s Bluestone Capital Advisors Pvt. Ltd.' },
          { key: 'pledgee_address', label: 'Pledgee address', type: 'textarea', rows: 2, required: true, default: '801, Lodha Excelus,\nApollo Mills Compound, Mahalaxmi,\nMumbai - 400011' },
        ],
      },
      {
        title: 'Pledged Property',
        fields: [
          {
            key: 'pledged_assets',
            label: 'Description of pledged goods / securities',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              '1. 12,500 equity shares of Reliance Industries Ltd. (ISIN: INE002A01018) held in DEMAT Account No. IN30021412345678 with NSDL via Zerodha Broking Ltd.\n2. 8,200 equity shares of HDFC Bank Ltd. (ISIN: INE040A01034) held in the same DEMAT account.',
          },
          { key: 'asset_value', label: 'Aggregate value at pledge', type: 'currency', required: true, default: '8500000' },
          { key: 'margin', label: 'Required margin (% of debt)', type: 'number', optional: true, default: '170' },
          { key: 'top_up_obligation', label: 'Margin top-up obligation', type: 'text', optional: true, default: 'Pledgor to top up additional securities within 24 hours of any margin call by the Pledgee.' },
        ],
      },
      {
        title: 'Secured Debt',
        fields: [
          { key: 'principal_debt', label: 'Principal debt secured', type: 'currency', required: true, default: '5000000' },
          { key: 'interest_rate', label: 'Interest rate (% p.a.)', type: 'number', required: true, default: '12' },
          { key: 'repayment_date', label: 'Repayment / due date', type: 'date', required: true, default: '2027-05-15' },
          { key: 'underlying_loan_ref', label: 'Reference to underlying loan', type: 'text', optional: true, default: 'Loan Agreement dated 14.05.2026 between the parties (Loan Ref. BCA/LN/2026/0042)' },
        ],
      },
      {
        title: 'Default & Sale',
        fields: [
          { key: 'right_of_sale', label: "Pledgee's right of sale (§176)", type: 'textarea', rows: 3, required: true, default: 'On default by the Pledgor, the Pledgee may, after giving reasonable notice (not less than 7 days), bring a suit against the Pledgor for the debt while retaining the pledged goods as security, OR sell the pledged goods in the open market and apply the proceeds towards the debt.' },
          { key: 'surplus_handling', label: 'Surplus / shortfall on sale', type: 'text', optional: true, default: 'Surplus, if any, after meeting the debt and sale costs, to be returned to the Pledgor; shortfall recoverable from the Pledgor personally.' },
          { key: 'governing_law', label: 'Governing law', type: 'text', required: true, default: 'Indian law; courts at Mumbai shall have exclusive jurisdiction.' },
        ],
      },
    ],
  },

  'Insurance Contract': {
    category: 'Specialised',
    description:
      'Contract of indemnity (general insurance) or contingent contract (life insurance) between insurer and insured. Governed by the Insurance Act, 1938 and IRDAI regulations; principles of uberrimae fidei, insurable interest and contribution apply.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'insurer_name', label: 'Insurer', type: 'text', required: true, default: 'HDFC ERGO General Insurance Company Ltd.' },
          { key: 'insurer_irdai_no', label: 'IRDAI registration', type: 'text', optional: true, default: 'IRDAI Reg. No. 146' },
          { key: 'insurer_address', label: 'Insurer registered office', type: 'textarea', rows: 2, required: true, default: '1st Floor, HDFC House,\n165-166 Backbay Reclamation, Churchgate,\nMumbai - 400020' },
          { key: 'insured_name', label: 'Insured / policyholder', type: 'text', required: true, default: 'M/s Sunrise Auto Components Pvt. Ltd.' },
          { key: 'insured_address', label: 'Insured address', type: 'textarea', rows: 2, required: true, default: 'Plot 88, MIDC Phase II,\nChakan, Pune - 410501' },
        ],
      },
      {
        title: 'Policy Particulars',
        fields: [
          { key: 'policy_type', label: 'Type of policy', type: 'select', options: ['Life - Term', 'Life - Endowment / ULIP', 'Health / Mediclaim', 'Motor - OD + TP', 'Fire / Property (Bharat Sookshma Udyam)', 'Marine Cargo', 'Marine Hull', 'Liability - Professional / D&O / CGL', 'Group Personal Accident', 'Cyber'], required: true, default: 'Fire / Property (Bharat Sookshma Udyam)' },
          { key: 'policy_number', label: 'Policy number', type: 'text', required: true, default: 'HDFCE-FIR-2026-Q2-04421' },
          { key: 'sum_insured', label: 'Sum insured', type: 'currency', required: true, default: '150000000' },
          { key: 'premium', label: 'Annual premium', type: 'currency', required: true, default: '425000' },
          { key: 'effective_date', label: 'Risk commencement', type: 'date', required: true, default: '2026-06-01' },
          { key: 'expiry_date', label: 'Policy expiry', type: 'date', required: true, default: '2027-05-31' },
        ],
      },
      {
        title: 'Coverage',
        fields: [
          {
            key: 'risks_covered',
            label: 'Risks covered',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              "Loss / damage to building, plant & machinery and stock at Plot 88, MIDC Chakan, caused by:\na) Fire, lightning, explosion / implosion of domestic boilers;\nb) Aircraft damage;\nc) Riot, strike, malicious damage;\nd) Storm, cyclone, flood, inundation;\ne) Earthquake;\nf) Bursting and overflowing of water tanks / pipes;\ng) Impact damage by rail / road vehicles.",
          },
          { key: 'exclusions', label: 'Material exclusions', type: 'textarea', rows: 2, optional: true, default: 'War / nuclear perils; wilful misconduct; wear & tear / gradual deterioration; consequential losses; theft after fire; loss of profits (unless add-on BI cover taken).' },
          { key: 'deductible', label: 'Deductible / excess', type: 'currency', optional: true, default: '50000' },
        ],
      },
      {
        title: 'Claims & Disputes',
        fields: [
          { key: 'claim_intimation_days', label: 'Claim intimation (days)', type: 'number', required: true, default: '7' },
          { key: 'documents_required', label: 'Documents required on claim', type: 'textarea', rows: 2, optional: true, default: 'Duly filled claim form; FIR (where applicable); fire-brigade report; surveyor\'s report; invoices and proof of ownership; statement of loss.' },
          { key: 'subrogation_clause', label: 'Subrogation', type: 'text', optional: true, default: 'On payment of claim, Insurer is subrogated to all the Insured\'s rights and remedies against third parties responsible for the loss.' },
          { key: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, default: 'Disputes referrable to the Insurance Ombudsman (consumer-level) or arbitration under §11 of the A&C Act, 1996; courts at Mumbai shall have jurisdiction for non-arbitrable issues.' },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Notices, Pleadings, Applications, Authority, Letters
  // ---------------------------------------------------------------------------

  'Legal Notice': {
    category: 'Notice',
    description:
      'Pre-litigation demand notice setting out a grievance and the relief sought. Often a statutory pre-requisite (e.g. §80 CPC for govt notices, §138 NI Act, §21 of the Specific Relief Act for tenancy).',
    sections: [
      {
        title: 'Sender (Notice Issuer)',
        fields: [
          { key: 'sender_name', label: 'Sender / client', type: 'text', required: true, default: 'M/s Mehta Enterprises Pvt. Ltd.' },
          { key: 'sender_address', label: 'Sender address', type: 'textarea', rows: 2, required: true, default: 'Plot No. 14, Industrial Area Phase II,\nNaraina, New Delhi - 110028' },
          { key: 'advocate_name', label: 'Advocate (issuing notice)', type: 'text', required: true, default: 'Aarav Sharma, Advocate' },
          { key: 'advocate_enrolment', label: 'Bar enrolment number', type: 'text', optional: true, default: 'D/2418/2017' },
          { key: 'advocate_address', label: 'Advocate chambers', type: 'textarea', rows: 2, optional: true, default: 'Chamber No. 27, Saket Court Complex,\nNew Delhi - 110017' },
        ],
      },
      {
        title: 'Recipient',
        fields: [
          { key: 'recipient_name', label: 'Recipient / addressee', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd., through its Managing Director' },
          { key: 'recipient_address', label: 'Recipient address', type: 'textarea', rows: 2, required: true, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043, Karnataka' },
        ],
      },
      {
        title: 'Cause of Action',
        fields: [
          { key: 'transaction', label: 'Underlying transaction / relationship', type: 'textarea', rows: 2, required: true, default: 'Purchase Orders dated 04.05.2025 and 22.07.2025 placed by the Recipient for supply of steel and cement, aggregating to ₹9,50,000.' },
          {
            key: 'facts',
            label: 'Material facts (numbered)',
            type: 'textarea',
            rows: 5,
            required: true,
            default:
              '1. The Sender supplied steel and cement worth ₹9,50,000 against the said purchase orders.\n2. The goods were delivered against invoices INV/2025/1142 dated 14.02.2026 and INV/2026/0078 dated 02.03.2026.\n3. The Recipient acknowledged receipt of the goods and agreed to pay within 45 days.\n4. Despite repeated reminders, the Recipient has wilfully and without justification failed to make payment.',
          },
          { key: 'breach', label: 'Breach / wrong complained of', type: 'textarea', rows: 2, required: true, default: 'Non-payment of admitted dues amounting to ₹9,50,000 in violation of the agreed credit terms.' },
        ],
      },
      {
        title: 'Demand & Compliance',
        fields: [
          {
            key: 'demand',
            label: 'Demand / relief called upon',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'You are hereby called upon to:\na) Pay the sum of ₹9,50,000 along with interest at 18% p.a. from the respective invoice due dates;\nb) Reimburse the legal costs of this Notice quantified at ₹25,000.',
          },
          { key: 'compliance_period_days', label: 'Compliance period (days)', type: 'number', required: true, default: '15' },
          { key: 'consequence', label: 'Consequence of non-compliance', type: 'text', required: true, default: 'Failing which the Sender shall be constrained to initiate civil and / or criminal proceedings at your cost and risk, including but not limited to a suit for recovery and proceedings under §138 of the NI Act.' },
          { key: 'date_of_notice', label: 'Date of notice', type: 'date', required: true, default: '2026-05-22' },
        ],
      },
    ],
  },

  'Replication / Rejoinder': {
    category: 'Pleading',
    description:
      "Plaintiff's reply to the defendant's written statement under Order VIII Rule 9 CPC, denying new facts pleaded therein and replying to counter-claims.",
    sections: [
      {
        title: 'Suit Reference',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'suit_no', label: 'Suit number / CNR', type: 'text', required: true, default: 'O.S. No. 1247 of 2025 · CNR: KAJU01-001247-2025' },
          { key: 'plaintiff_name', label: 'Plaintiff (your client)', type: 'text', required: true, default: 'Rohan Mehta' },
          { key: 'defendant_name', label: 'Defendant', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
        ],
      },
      {
        title: 'Reply to Written Statement',
        fields: [
          {
            key: 'preliminary_response',
            label: 'Reply to preliminary objections',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'a) The plea of limitation is misconceived. The cause of action arose on 02.03.2026 when the Defendant repudiated liability vide reply notice; the suit filed on 15.04.2026 is well within three years.\nb) Order VII Rule 11 is not attracted - the plaint discloses a clear cause of action for recovery of admitted dues.\nc) The valuation of the suit is correct under §7(i) of the Court Fees Act, 1870, and full court fees have been paid.',
          },
          {
            key: 'reply_admissions',
            label: 'Reply to admissions / denials',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'The denials in paragraphs 3-5 of the written statement are false and an afterthought. The signed delivery receipts, GST e-way bills and ledger confirmations annexed to the plaint conclusively establish that goods were placed and received. The allegation that signatures are "forged" is mala fide and contradicts the Defendant\'s own bank statements showing part-payment in October 2025.',
          },
          {
            key: 'reply_counterclaim',
            label: 'Reply to counter-claim',
            type: 'textarea',
            rows: 3,
            optional: true,
            default:
              'The counter-claim for ₹2,00,000 towards alleged reputational damage is denied as false, frivolous and vexatious. The legal notice dated 02.03.2026 was a bona fide pre-litigation demand and was not "circulated in trade circles" as falsely alleged. The Plaintiff seeks dismissal of the counter-claim with exemplary costs.',
          },
        ],
      },
      {
        title: 'New Facts (if any)',
        fields: [
          { key: 'new_facts', label: 'New facts brought on record', type: 'textarea', rows: 4, optional: true, default: 'Post the filing of the plaint, the Plaintiff has come into possession of email correspondence dated 18.10.2025 from the Defendant\'s purchase manager confirming the dispatch schedule, copies of which are produced herewith.' },
          { key: 'date_of_filing', label: 'Date of filing', type: 'date', required: true, default: '2026-06-12' },
          { key: 'verification_clause', label: 'Verification', type: 'text', required: true, default: 'Verified at Bengaluru on this 12th day of June, 2026 that the contents of the foregoing replication are true and correct to the Plaintiff\'s knowledge and information.' },
        ],
      },
    ],
  },

  'Written Arguments': {
    category: 'Pleading',
    description:
      'Written submission of final arguments by a party at the stage of conclusion of evidence, under Order XVIII Rule 2(3-A) CPC. Typically filed after closing oral arguments to crystallise the legal position.',
    sections: [
      {
        title: 'Case Reference',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'case_title', label: 'Case title', type: 'text', required: true, default: 'Rohan Mehta v. M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'case_no', label: 'Case number / CNR', type: 'text', required: true, default: 'O.S. No. 1247 of 2025 · CNR: KAJU01-001247-2025' },
          { key: 'filed_by', label: 'Filed on behalf of', type: 'select', options: ['Plaintiff', 'Defendant', 'Petitioner', 'Respondent', 'Appellant', 'Applicant'], required: true, default: 'Plaintiff' },
        ],
      },
      {
        title: 'Summary of Case',
        fields: [
          {
            key: 'case_summary',
            label: 'Brief summary of the case',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'Suit for recovery of ₹9,50,000 towards admitted dues for supply of steel and cement, with 12% interest and costs. The Defendant\'s defence rests on bare denials unsupported by any documentary evidence.',
          },
          { key: 'issues_framed', label: 'Issues framed by the court', type: 'textarea', rows: 3, required: true, default: '1. Whether the Plaintiff supplied the goods worth ₹9,50,000 as alleged?\n2. Whether the Defendant is liable to pay the said amount with interest?\n3. To what relief is the Plaintiff entitled?' },
        ],
      },
      {
        title: 'Arguments',
        fields: [
          {
            key: 'arguments',
            label: 'Issue-wise arguments',
            type: 'textarea',
            rows: 10,
            required: true,
            default:
              'Issue No. 1: Supply of goods stands proved through Exs. P-1 to P-7 (purchase orders, invoices, e-way bills, delivery receipts) and the deposition of PW-1 and PW-2. The Defendant\'s witness DW-1 admitted in cross-examination that the rubber-stamp on Ex. P-4 belongs to the company. Reliance is placed on Anwar P.V. v. P.K. Basheer (2014) 10 SCC 473 on admissibility of electronic records.\n\nIssue No. 2: Liability flows directly from supply. The Defendant\'s plea of "forged signatures" is unsubstantiated and contradicted by part-payment of ₹1,50,000 reflected in the Defendant\'s bank statement (Ex. P-9). Interest is payable under §34 CPC and Hyderabad Industries Ltd. v. UOI (1999) 5 SCC 15.\n\nIssue No. 3: The Plaintiff is entitled to the suit amount with interest and costs.',
          },
          { key: 'citations', label: 'Key authorities relied upon', type: 'textarea', rows: 3, optional: true, default: '1. Anwar P.V. v. P.K. Basheer (2014) 10 SCC 473.\n2. Hyderabad Industries Ltd. v. UOI (1999) 5 SCC 15.\n3. Vishwanath Sood v. UOI (1989) 1 SCC 657 (on interest jurisprudence).' },
        ],
      },
      {
        title: 'Prayer',
        fields: [
          { key: 'prayer', label: 'Prayer', type: 'textarea', rows: 3, required: true, default: 'For the reasons aforesaid, it is most respectfully prayed that this Hon\'ble Court may be pleased to decree the suit in favour of the Plaintiff for ₹9,50,000 with interest at 12% p.a. and costs throughout, in the interest of justice and equity.' },
          { key: 'date_of_filing', label: 'Date of filing', type: 'date', required: true, default: '2027-02-18' },
        ],
      },
    ],
  },

  'Evidence Affidavit': {
    category: 'Pleading',
    description:
      'Examination-in-chief of a witness on affidavit under Order XVIII Rule 4 CPC. Substitutes oral chief examination; witness still goes through cross-examination orally.',
    sections: [
      {
        title: 'Case Reference',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'case_title', label: 'Case title', type: 'text', required: true, default: 'Rohan Mehta v. M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'case_no', label: 'Case number / CNR', type: 'text', required: true, default: 'O.S. No. 1247 of 2025 · CNR: KAJU01-001247-2025' },
          { key: 'filed_by', label: 'Filed on behalf of', type: 'select', options: ['Plaintiff', 'Defendant', 'Petitioner', 'Respondent', 'Applicant'], required: true, default: 'Plaintiff' },
        ],
      },
      {
        title: 'Deponent / Witness',
        fields: [
          { key: 'witness_name', label: 'Witness / deponent', type: 'text', required: true, default: 'Rohan Mehta, S/o Late Shri Vinod Mehta' },
          { key: 'witness_age', label: 'Age', type: 'number', required: true, default: '38' },
          { key: 'witness_occupation', label: 'Occupation', type: 'text', optional: true, default: 'Sole Proprietor, M/s Mehta Trading Co.' },
          { key: 'witness_address', label: 'Address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038, Karnataka' },
          { key: 'capacity', label: 'Capacity in suit', type: 'select', options: ['Party (Plaintiff/Defendant in person)', 'Authorised representative', 'Witness to fact', 'Expert witness', 'Attesting witness'], required: true, default: 'Party (Plaintiff/Defendant in person)' },
        ],
      },
      {
        title: 'Examination-in-Chief',
        fields: [
          {
            key: 'paragraphs',
            label: 'Numbered statement of facts',
            type: 'textarea',
            rows: 10,
            required: true,
            default:
              '1. I am the Plaintiff in the present suit and am well acquainted with the facts of the case from my personal knowledge.\n2. I crave leave to refer to and rely upon the averments made in the plaint as if the same were set out herein verbatim.\n3. I had supplied steel and cement to the Defendant pursuant to Purchase Orders dated 04.05.2025 and 22.07.2025 (now exhibited as Exs. P-1 and P-2).\n4. The goods were delivered against Invoices INV/2025/1142 and INV/2026/0078 (Exs. P-3 and P-4) and acknowledged by the Defendant\'s authorised representative under stamp and signature.\n5. Despite repeated written reminders, the Defendant has wilfully failed to pay the agreed sum of ₹9,50,000.\n6. The legal notice dated 02.03.2026 (Ex. P-6) was duly served on the Defendant, who replied vide letter dated 14.03.2026 (Ex. P-7) admitting receipt of goods but disputing quantity.',
          },
          { key: 'exhibits', label: 'Documents being exhibited', type: 'textarea', rows: 3, optional: true, default: 'Ex. P-1: PO dated 04.05.2025\nEx. P-2: PO dated 22.07.2025\nEx. P-3: Invoice INV/2025/1142\nEx. P-4: Invoice INV/2026/0078\nEx. P-5: Ledger statement\nEx. P-6: Legal notice\nEx. P-7: Reply notice' },
        ],
      },
      {
        title: 'Verification',
        fields: [
          { key: 'place_of_swearing', label: 'Place of swearing', type: 'text', required: true, default: 'Bengaluru' },
          { key: 'date_of_swearing', label: 'Date', type: 'date', required: true, default: '2026-11-14' },
          { key: 'verification_clause', label: 'Verification', type: 'text', required: true, default: 'Verified at Bengaluru on this 14th day of November, 2026 that the contents of paragraphs 1 to 6 above are true and correct to my personal knowledge; no part thereof is false and no material has been concealed.' },
        ],
      },
    ],
  },

  Appeal: {
    category: 'Pleading',
    description:
      'Memorandum of Appeal challenging a decree / order before a higher court. First appeals under §96 CPC, second appeals under §100 CPC (only on substantial question of law).',
    sections: [
      {
        title: 'Appellate Court & Cause',
        fields: [
          { key: 'court', label: 'Appellate court', type: 'text', required: true, default: "Hon'ble High Court of Karnataka at Bengaluru" },
          {
            key: 'appeal_type',
            label: 'Type of appeal',
            type: 'select',
            options: ['First Appeal u/s 96 CPC', 'Second Appeal u/s 100 CPC', 'Letters Patent Appeal', 'Cross Appeal', 'Criminal Appeal', 'Tax / Tribunal Appeal'],
            required: true,
            default: 'First Appeal u/s 96 CPC',
          },
          { key: 'appeal_no', label: 'Appeal number (if assigned)', type: 'text', optional: true, default: 'R.F.A. No. ____ of 2027' },
          { key: 'impugned_order_court', label: 'Court whose order is impugned', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'impugned_order_no', label: 'Impugned judgment / decree', type: 'text', required: true, default: 'Judgment and decree dated 14.02.2027 in O.S. No. 1247 of 2025' },
        ],
      },
      {
        title: 'Parties',
        fields: [
          { key: 'appellant_name', label: 'Appellant', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'appellant_address', label: 'Appellant address', type: 'textarea', rows: 2, required: true, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043' },
          { key: 'appellant_capacity', label: 'Appellant capacity in trial court', type: 'text', required: true, default: 'Defendant in O.S. No. 1247 of 2025' },
          { key: 'respondent_name', label: 'Respondent', type: 'text', required: true, default: 'Rohan Mehta' },
          { key: 'respondent_address', label: 'Respondent address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038' },
          { key: 'respondent_capacity', label: 'Respondent capacity in trial court', type: 'text', required: true, default: 'Plaintiff in O.S. No. 1247 of 2025' },
        ],
      },
      {
        title: 'Grounds of Appeal',
        fields: [
          {
            key: 'grounds',
            label: 'Grounds of appeal (numbered)',
            type: 'textarea',
            rows: 8,
            required: true,
            default:
              '1. The learned Trial Court erred in law and on facts in decreeing the suit without proper appreciation of evidence on record.\n2. The Trial Court failed to consider that PW-1 admitted in cross-examination that the rubber-stamp on Ex. P-4 was misused by a disgruntled former employee.\n3. The Trial Court ignored the bar of limitation - the cause of action arose on 04.05.2025 and the suit filed in April 2026 was beyond the contractual limitation of 12 months.\n4. The award of interest at 12% p.a. was excessive and contrary to §34 CPC read with the rate prevailing for commercial transactions.\n5. The Trial Court failed to consider the counter-claim of the Appellant for reputational damage caused by circulation of the legal notice.',
          },
          { key: 'questions_of_law', label: 'Substantial questions of law (for §100 appeals)', type: 'textarea', rows: 3, optional: true, default: 'a) Whether the Trial Court could rely on disputed electronic records without §65B certification?\nb) Whether commercial limitation under specific contractual terms can be overridden by general limitation principles?' },
        ],
      },
      {
        title: 'Prayer & Limitation',
        fields: [
          { key: 'prayer', label: 'Prayer', type: 'textarea', rows: 3, required: true, default: 'It is most respectfully prayed that this Hon\'ble Court be pleased to:\na) Set aside the impugned judgment and decree dated 14.02.2027;\nb) Dismiss O.S. No. 1247 of 2025 with costs;\nc) Allow the counter-claim of the Appellant; and\nd) Grant such further relief as this Hon\'ble Court may deem fit.' },
          { key: 'limitation_note', label: 'Limitation note', type: 'text', required: true, default: 'The appeal is filed within 90 days from the date of the impugned decree, computed in accordance with Article 116 of the Limitation Act, 1963.' },
          { key: 'court_fee', label: 'Court fee paid', type: 'currency', optional: true, default: '12500' },
          { key: 'date_of_filing', label: 'Date of filing', type: 'date', required: true, default: '2027-05-10' },
        ],
      },
    ],
  },

  'IA / Stay Application': {
    category: 'Application',
    description:
      "Interlocutory application seeking temporary injunction / stay / interim relief pending disposal of the main matter. Typically under Order XXXIX Rules 1-2 CPC (civil) or §397/482 BNSS (criminal).",
    sections: [
      {
        title: 'Court & Cause',
        fields: [
          { key: 'court', label: 'Court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'main_case', label: 'Main case reference', type: 'text', required: true, default: 'O.S. No. 1247 of 2025 · CNR: KAJU01-001247-2025' },
          { key: 'ia_no', label: 'IA number (if assigned)', type: 'text', optional: true, default: 'I.A. No. ____ of 2026' },
          {
            key: 'relief_type',
            label: 'Type of interim relief sought',
            type: 'select',
            options: ['Temporary injunction (Order XXXIX r. 1-2)', 'Stay of operation', 'Attachment before judgment (Order XXXVIII)', 'Appointment of receiver (Order XL)', 'Stay of proceedings', 'Other'],
            required: true,
            default: 'Temporary injunction (Order XXXIX r. 1-2)',
          },
        ],
      },
      {
        title: 'Parties',
        fields: [
          { key: 'applicant_name', label: 'Applicant', type: 'text', required: true, default: 'Rohan Mehta (Plaintiff in O.S. 1247/2025)' },
          { key: 'applicant_address', label: 'Applicant address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038' },
          { key: 'opposite_party_name', label: 'Opposite party / non-applicant', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'opposite_party_address', label: 'Opposite party address', type: 'textarea', rows: 2, required: true, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043' },
        ],
      },
      {
        title: 'Grounds',
        fields: [
          {
            key: 'prima_facie_case',
            label: 'Prima facie case',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'The Plaintiff has a clear prima facie case on merits - documentary evidence (POs, invoices, e-way bills) establishes admitted supply of goods worth ₹9,50,000 by the Defendant.',
          },
          { key: 'balance_of_convenience', label: 'Balance of convenience', type: 'textarea', rows: 2, required: true, default: 'The balance of convenience lies in favour of the Applicant - the Defendant is attempting to alienate its assets which will render the eventual decree infructuous; no prejudice will be caused to the Defendant by maintenance of status quo.' },
          { key: 'irreparable_injury', label: 'Irreparable injury', type: 'textarea', rows: 2, required: true, default: 'In the absence of an injunction, the Applicant will suffer irreparable injury that cannot be compensated in money as the Defendant has already commenced disposal of its land bank at MIDC Chakan.' },
          { key: 'undertaking', label: 'Undertaking on damages', type: 'text', optional: true, default: 'The Applicant undertakes to compensate the Defendant for any loss occasioned by such injunction should the suit ultimately fail.' },
        ],
      },
      {
        title: 'Prayer',
        fields: [
          {
            key: 'prayer',
            label: 'Specific relief prayed for',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'It is most respectfully prayed that this Hon\'ble Court may be pleased to grant ad-interim ex-parte injunction restraining the Defendant, its officers, agents and assigns from alienating, transferring or creating any third-party rights over its immovable / movable assets situated at Plot 88, MIDC Chakan, pending disposal of the suit, in the interest of justice.',
          },
          { key: 'date_of_filing', label: 'Date of filing', type: 'date', required: true, default: '2026-05-18' },
          { key: 'supporting_affidavit', label: 'Supporting affidavit', type: 'text', optional: true, default: 'Application is supported by the affidavit of the Applicant dated 18.05.2026.' },
        ],
      },
    ],
  },

  'Execution Petition': {
    category: 'Application',
    description:
      'Petition to enforce a decree / order under Order XXI CPC. Permissible modes include arrest, attachment, sale of property, garnishee proceedings and appointment of receiver.',
    sections: [
      {
        title: 'Court & Decree',
        fields: [
          { key: 'court', label: 'Executing court', type: 'text', required: true, default: 'Court of Civil Judge, Senior Division, Bengaluru' },
          { key: 'decree_court', label: "Court that passed the decree (if different)", type: 'text', optional: true, default: 'Same court' },
          { key: 'decree_case_no', label: 'Decree / suit number', type: 'text', required: true, default: 'O.S. No. 1247 of 2025 (decreed on 14.02.2027)' },
          { key: 'ep_no', label: 'Execution Petition number (if assigned)', type: 'text', optional: true, default: 'E.P. No. ____ of 2027' },
          { key: 'decree_date', label: 'Date of decree', type: 'date', required: true, default: '2027-02-14' },
        ],
      },
      {
        title: 'Parties',
        fields: [
          { key: 'decree_holder_name', label: 'Decree-Holder (your client)', type: 'text', required: true, default: 'Rohan Mehta (Plaintiff in O.S. 1247/2025)' },
          { key: 'decree_holder_address', label: 'Decree-Holder address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038' },
          { key: 'judgment_debtor_name', label: 'Judgment-Debtor', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'judgment_debtor_address', label: 'Judgment-Debtor address', type: 'textarea', rows: 2, required: true, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043' },
        ],
      },
      {
        title: 'Decretal Amount',
        fields: [
          { key: 'decretal_principal', label: 'Decretal principal', type: 'currency', required: true, default: '950000' },
          { key: 'interest_accrued', label: 'Interest accrued till date', type: 'currency', optional: true, default: '125000' },
          { key: 'costs', label: 'Costs awarded', type: 'currency', optional: true, default: '35000' },
          { key: 'amount_paid', label: 'Amount paid by JD till date', type: 'currency', optional: true, default: '0' },
          { key: 'amount_due', label: 'Net amount due', type: 'currency', required: true, default: '1110000' },
        ],
      },
      {
        title: 'Mode of Execution',
        fields: [
          {
            key: 'mode_of_execution',
            label: 'Mode of execution sought',
            type: 'select',
            options: ['Attachment & sale of immovable property (Order XXI r. 64)', 'Attachment & sale of movable property', 'Attachment of bank accounts (garnishee)', 'Arrest & detention of JD', 'Appointment of receiver', 'Delivery of immovable property', 'Combined / multiple modes'],
            required: true,
            default: 'Attachment & sale of immovable property (Order XXI r. 64)',
          },
          {
            key: 'assets_targeted',
            label: 'Properties / assets sought to be attached',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'Plot No. 88, Outer Ring Road, HBR Layout, Bengaluru, admeasuring 4,000 sq. ft. owned by the Judgment-Debtor (Khata No. 4421/88) and the JD\'s current account No. 50100123456 with HDFC Bank, Bannerghatta branch.',
          },
          { key: 'limitation_note', label: 'Limitation note', type: 'text', required: true, default: 'EP filed within 12 years from the decree under Article 136 of the Limitation Act, 1963.' },
          { key: 'date_of_filing', label: 'Date of filing', type: 'date', required: true, default: '2027-04-22' },
        ],
      },
    ],
  },

  Caveat: {
    category: 'Application',
    description:
      'Notice lodged with a court by a person apprehending an ex-parte order against him, requiring the court to hear him before granting interim relief. Filed under §148A CPC; valid for 90 days.',
    sections: [
      {
        title: 'Court & Anticipated Matter',
        fields: [
          { key: 'court', label: 'Court before which caveat is lodged', type: 'text', required: true, default: "Hon'ble High Court of Karnataka at Bengaluru" },
          { key: 'caveat_no', label: 'Caveat number (if assigned)', type: 'text', optional: true, default: 'Caveat No. ____ of 2026' },
          { key: 'anticipated_proceeding', label: 'Anticipated proceeding', type: 'textarea', rows: 2, required: true, default: 'Writ Petition / Civil Appeal anticipated to be filed by Mr. Rohan Mehta challenging the order dated 14.02.2026 passed by BBMP in Building Plan Sanction No. BBMP/BPS/2025/4421.' },
        ],
      },
      {
        title: 'Caveator',
        fields: [
          { key: 'caveator_name', label: 'Caveator (your client)', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'caveator_address', label: 'Caveator address', type: 'textarea', rows: 2, required: true, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043' },
          { key: 'caveator_interest', label: 'Caveator\'s interest in matter', type: 'text', required: true, default: 'Caveator is the beneficiary of the impugned sanction and would be adversely affected by any ex-parte order' },
        ],
      },
      {
        title: 'Likely Petitioner',
        fields: [
          { key: 'expected_petitioner', label: 'Expected petitioner / applicant', type: 'text', required: true, default: 'Mr. Rohan Mehta, of No. 32, 5th Cross, Indiranagar 1st Stage, Bengaluru - 560038' },
          { key: 'basis_of_apprehension', label: 'Basis of apprehension', type: 'textarea', rows: 2, optional: true, default: 'Legal notice dated 12.05.2026 issued by Mr. Mehta\'s counsel intimating intention to challenge the building-plan sanction; Mr. Mehta has previously filed similar petitions seeking ex-parte stay.' },
        ],
      },
      {
        title: 'Prayer & Validity',
        fields: [
          {
            key: 'prayer',
            label: 'Prayer',
            type: 'textarea',
            rows: 3,
            required: true,
            default:
              'It is therefore prayed that this Hon\'ble Court may be pleased to direct that no ex-parte order be passed against the Caveator without notice to and hearing of the Caveator, and to furnish the Caveator with a copy of any petition / appeal that may be filed by the said person, in the interest of justice.',
          },
          { key: 'validity_note', label: 'Validity', type: 'text', required: true, default: 'This caveat shall remain in force for 90 days from the date of lodging under §148A(5) CPC.' },
          { key: 'date_of_filing', label: 'Date of lodging', type: 'date', required: true, default: '2026-05-20' },
          { key: 'service_acknowledgment', label: 'Service on expected petitioner', type: 'text', optional: true, default: 'Copy of this caveat is being served on the expected petitioner by registered post / speed post under §148A(2) CPC.' },
        ],
      },
    ],
  },

  'RTI Application': {
    category: 'Application',
    description:
      'Application seeking information from a public authority under §6 of the Right to Information Act, 2005. Response due within 30 days (48 hours if life / liberty is involved).',
    sections: [
      {
        title: 'Applicant',
        fields: [
          { key: 'applicant_name', label: 'Applicant name', type: 'text', required: true, default: 'Shri Rohan Mehta' },
          { key: 'applicant_address', label: 'Applicant address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038, Karnataka' },
          { key: 'applicant_email', label: 'Email', type: 'text', optional: true, default: 'rohan.mehta@example.com' },
          { key: 'applicant_phone', label: 'Phone', type: 'text', optional: true, default: '+91 98450 12345' },
          { key: 'is_indian_citizen', label: 'Indian citizen?', type: 'select', options: ['Yes', 'No'], required: true, default: 'Yes' },
        ],
      },
      {
        title: 'Public Authority Addressed',
        fields: [
          { key: 'pio_name', label: 'Public Information Officer (PIO) - addressee', type: 'text', required: true, default: 'The Public Information Officer' },
          { key: 'public_authority', label: 'Public authority / department', type: 'text', required: true, default: 'Bruhat Bengaluru Mahanagara Palike (BBMP), Town Planning Department - East Zone' },
          { key: 'authority_address', label: 'Authority address', type: 'textarea', rows: 2, required: true, default: 'BBMP East Zonal Office,\nMG Road, Bengaluru - 560001' },
        ],
      },
      {
        title: 'Information Sought',
        fields: [
          {
            key: 'subject',
            label: 'Subject',
            type: 'text',
            required: true,
            default: 'Request for information regarding Building Plan Sanction No. BBMP/BPS/2025/4421',
          },
          {
            key: 'information_requested',
            label: 'Specific information sought (numbered)',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              '1. Certified copy of the building plan sanction order bearing No. BBMP/BPS/2025/4421 dated 14.02.2026 in respect of property bearing No. 88, Outer Ring Road, HBR Layout.\n2. File noting and inter-departmental correspondence relating to the said sanction.\n3. Names and designations of officials who processed and approved the sanction.\n4. Whether any complaint / objection was received in respect of the said sanction, and if so, certified copies of the same.\n5. Status of pending complaints, if any.',
          },
          { key: 'time_period', label: 'Time period covered', type: 'text', optional: true, default: 'From 01.01.2025 till date of this application' },
          { key: 'mode_of_supply', label: 'Mode of supply', type: 'select', options: ['Inspection of records', 'Certified copies (paper)', 'Soft copy by email', 'CD / electronic medium'], required: true, default: 'Certified copies (paper)' },
        ],
      },
      {
        title: 'Fee & Declaration',
        fields: [
          { key: 'application_fee', label: 'Application fee', type: 'currency', required: true, default: '10' },
          { key: 'fee_mode', label: 'Mode of payment', type: 'text', optional: true, default: 'IPO No. 14ABC123456 dated 22.05.2026 in favour of "Accounts Officer, BBMP, Bengaluru"' },
          { key: 'bpl_concession', label: 'BPL fee concession claimed?', type: 'select', options: ['No', 'Yes - BPL certificate enclosed'], required: true, default: 'No' },
          { key: 'date_of_application', label: 'Date of application', type: 'date', required: true, default: '2026-05-22' },
        ],
      },
    ],
  },

  'Settlement Agreement': {
    category: 'Authority',
    description:
      'Records an out-of-court compromise of an existing or potential dispute. Court-recorded compromises are enforceable as decrees under Order XXIII Rule 3 CPC; out-of-court settlements are contractual.',
    sections: [
      {
        title: 'Parties',
        fields: [
          { key: 'party_a_name', label: 'Party A (claimant)', type: 'text', required: true, default: 'Rohan Mehta' },
          { key: 'party_a_address', label: 'Party A address', type: 'textarea', rows: 2, required: true, default: 'No. 32, 5th Cross, Indiranagar 1st Stage,\nBengaluru - 560038' },
          { key: 'party_b_name', label: 'Party B (respondent)', type: 'text', required: true, default: 'M/s Skyline Constructions Pvt. Ltd.' },
          { key: 'party_b_address', label: 'Party B address', type: 'textarea', rows: 2, required: true, default: 'No. 88, Outer Ring Road, HBR Layout,\nBengaluru - 560043' },
        ],
      },
      {
        title: 'Background & Dispute',
        fields: [
          {
            key: 'background',
            label: 'Background / underlying dispute',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Party A had instituted O.S. No. 1247 of 2025 against Party B before the Court of Civil Judge (Senior Division), Bengaluru, seeking recovery of ₹9,50,000 with interest. Party B disputed the claim and filed a counter-claim for ₹2,00,000. After mediation under §89 CPC at the Karnataka State Legal Services Authority, the parties have agreed to settle the dispute amicably on the terms recorded below.',
          },
          { key: 'pending_proceeding', label: 'Pending proceeding (if any)', type: 'text', optional: true, default: 'O.S. No. 1247 of 2025 pending before Court of Civil Judge (Sr. Div.), Bengaluru' },
        ],
      },
      {
        title: 'Settlement Terms',
        fields: [
          {
            key: 'settlement_terms',
            label: 'Terms of settlement (numbered)',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              '1. Party B shall pay Party A a full and final sum of ₹7,50,000 by way of RTGS into the bank account of Party A within 15 days of the date of this Agreement.\n2. On receipt of the said sum, Party A shall withdraw O.S. No. 1247 of 2025 in entirety.\n3. Party B shall simultaneously withdraw its counter-claim in the said suit.\n4. Each party shall bear its own costs.\n5. The parties release each other from all claims, demands and causes of action whatsoever arising out of or related to the subject matter of the said suit.',
          },
          { key: 'consideration_amount', label: 'Settlement consideration', type: 'currency', required: true, default: '750000' },
          { key: 'compliance_period_days', label: 'Compliance period (days)', type: 'number', required: true, default: '15' },
        ],
      },
      {
        title: 'Filing & Boilerplate',
        fields: [
          { key: 'filing_clause', label: 'Court-filing / decree clause', type: 'text', optional: true, default: 'The parties shall file a joint memo before the Hon\'ble Court for recording the compromise under Order XXIII Rule 3 CPC and seeking a consent decree in terms of this Agreement.' },
          { key: 'confidentiality', label: 'Confidentiality', type: 'text', optional: true, default: 'Save and except for enforcement, the terms of this settlement shall remain confidential between the parties and their counsel.' },
          { key: 'governing_law', label: 'Governing law & jurisdiction', type: 'text', required: true, default: 'Indian law; courts at Bengaluru shall have exclusive jurisdiction.' },
          { key: 'date_of_settlement', label: 'Date of execution', type: 'date', required: true, default: '2026-08-12' },
        ],
      },
    ],
  },

  'Engagement Letter': {
    category: 'Letter',
    description:
      'Engagement letter recording the firm–client mandate: scope, fees, retainer, billing cadence, and termination terms. Use the saved template under /app/engagement to lock the firm’s standard language; this schema captures matter-specific overrides for one-off engagements.',
    sections: [
      {
        title: 'Firm',
        fields: [
          { key: 'firm_name', label: 'Firm / chambers name', type: 'text', required: true, default: 'Sharma & Associates, Advocates' },
          { key: 'firm_address', label: 'Firm address', type: 'textarea', rows: 2, required: true, default: 'Chamber No. 27, Saket Court Complex,\nNew Delhi - 110017' },
          { key: 'firm_contact', label: 'Email / phone', type: 'text', optional: true, default: 'contact@sharma-advocates.in · +91-11-4567-8901' },
          { key: 'signatory_name', label: 'Signatory advocate', type: 'text', required: true, default: 'Aarav Sharma, Senior Partner' },
          { key: 'enrolment_no', label: 'Bar enrolment', type: 'text', optional: true, default: 'D/2412/2017' },
        ],
      },
      {
        title: 'Client',
        fields: [
          { key: 'client_name', label: 'Client name', type: 'text', required: true, default: 'Mehta Enterprises Pvt. Ltd.' },
          { key: 'client_address', label: 'Client address', type: 'textarea', rows: 2, required: true, default: 'Plot No. 14, Industrial Area Phase II,\nNaraina, New Delhi - 110028' },
          { key: 'client_representative', label: 'Authorised representative', type: 'text', optional: true, default: 'Shri Rohan Mehta, Director' },
          { key: 'client_email', label: 'Client email', type: 'text', optional: true, default: 'rohan@mehta.in' },
        ],
      },
      {
        title: 'Matter & Scope',
        fields: [
          { key: 'matter_title', label: 'Matter title', type: 'text', required: true, default: 'Mehta Enterprises v. Skyline Constructions — Suit for Recovery' },
          { key: 'matter_type', label: 'Matter type', type: 'select', options: ['Civil litigation', 'Criminal defence', 'Corporate advisory', 'Family law', 'Real estate', 'Employment', 'Intellectual property', 'Tax & regulatory', 'Arbitration', 'Other'], required: true, default: 'Civil litigation' },
          { key: 'forum', label: 'Court / forum', type: 'text', optional: true, default: "Court of Civil Judge (Senior Division), Bengaluru" },
          {
            key: 'scope',
            label: 'Scope of engagement',
            type: 'textarea',
            rows: 6,
            required: true,
            default:
              'a) Draft, file and prosecute a suit for recovery against M/s Skyline Constructions Pvt. Ltd. for the principal sum of ₹9,50,000 together with interest;\nb) Appear before the trial court at all stages, including interlocutory applications, evidence and final arguments;\nc) Advise on settlement negotiations, mediation and execution of any decree obtained.\n\nServices NOT included in this engagement: appearance before appellate forums, separate criminal proceedings, and advisory work outside the recovery suit.',
          },
        ],
      },
      {
        title: 'Fees & Retainer',
        fields: [
          { key: 'retainer_amount', label: 'Retainer (₹)', type: 'currency', required: true, default: '100000' },
          {
            key: 'fee_structure',
            label: 'Professional fees',
            type: 'textarea',
            rows: 4,
            required: true,
            default:
              'Professional fees of ₹2,50,000 (Rupees Two Lakh Fifty Thousand only), payable in three instalments:\n• ₹1,00,000 on signing of this engagement (retainer);\n• ₹75,000 on completion of pleadings (plaint + written statement stage);\n• ₹75,000 on commencement of arguments.\n\nOut-of-pocket expenses (court fees, process fees, paper-book printing, travel) will be billed at actuals against vouchers, supported by a monthly statement.',
          },
          {
            key: 'billing_cadence',
            label: 'Billing cadence',
            type: 'select',
            options: ['Milestone-based (as above)', 'Monthly retainer', 'Quarterly retainer', 'Hourly with monthly invoice', 'Fixed fee — lump sum on signing'],
            required: true,
            default: 'Milestone-based (as above)',
          },
          {
            key: 'payment_terms',
            label: 'Payment terms',
            type: 'textarea',
            rows: 3,
            optional: true,
            default:
              'All invoices are payable within 15 days of receipt. Interest at 12% p.a. is chargeable on amounts unpaid beyond 30 days. Applicable GST will be added to every invoice; TDS deduction (if any) is to be supported by a Form 16A within 30 days of the relevant quarter.',
          },
        ],
      },
      {
        title: 'Termination & Confidentiality',
        fields: [
          {
            key: 'termination',
            label: 'Termination clause',
            type: 'textarea',
            rows: 3,
            optional: true,
            default:
              'Either party may terminate this engagement by giving 30 days’ written notice. On termination, the Client shall pay fees and expenses for work completed up to the date of termination. The firm shall transfer all files and documents within 15 days of termination subject to payment of dues.',
          },
          {
            key: 'confidentiality',
            label: 'Confidentiality note',
            type: 'textarea',
            rows: 3,
            optional: true,
            default:
              'All communications between the Client and the firm are protected by attorney-client privilege under Section 132 of the Bharatiya Sakshya Adhiniyam, 2023. The firm will keep all matter information strictly confidential save where disclosure is required by law or by a court order.',
          },
          { key: 'effective_date', label: 'Engagement effective from', type: 'date', required: true, default: '2026-05-22' },
        ],
      },
    ],
  },

  Correspondence: {
    category: 'Letter',
    description:
      'General business / legal correspondence on behalf of a client - acknowledgment, demand, follow-up, query response. Use Legal Notice when a formal pre-litigation demand is intended.',
    sections: [
      {
        title: 'Sender',
        fields: [
          { key: 'sender_name', label: 'Sender / signatory', type: 'text', required: true, default: 'Aarav Sharma, Advocate' },
          { key: 'sender_designation', label: 'Designation', type: 'text', optional: true, default: 'Senior Partner, Sharma & Associates' },
          { key: 'sender_address', label: 'Sender address', type: 'textarea', rows: 2, required: true, default: 'Sharma & Associates,\nChamber No. 27, Saket Court Complex,\nNew Delhi - 110017' },
          { key: 'reference_no', label: 'Letter / reference number', type: 'text', optional: true, default: 'S&A/2026/0412' },
        ],
      },
      {
        title: 'Recipient',
        fields: [
          { key: 'recipient_name', label: 'Addressee', type: 'text', required: true, default: 'The Branch Manager' },
          { key: 'recipient_organisation', label: 'Organisation', type: 'text', optional: true, default: 'HDFC Bank Ltd., Greater Kailash-I Branch' },
          { key: 'recipient_address', label: 'Recipient address', type: 'textarea', rows: 2, required: true, default: 'HDFC Bank Ltd., M-Block Market,\nGreater Kailash-I, New Delhi - 110048' },
        ],
      },
      {
        title: 'Subject & Body',
        fields: [
          { key: 'subject', label: 'Subject', type: 'text', required: true, default: 'Request for issuance of duplicate Fixed Deposit Receipt - A/c No. 50300/AGJ/04421' },
          {
            key: 'salutation',
            label: 'Salutation',
            type: 'select',
            options: ['Dear Sir', 'Dear Madam', 'Dear Sir / Madam', 'To Whom It May Concern', 'Respected Sir / Madam'],
            required: true,
            default: 'Dear Sir / Madam',
          },
          {
            key: 'body',
            label: 'Body of letter',
            type: 'textarea',
            rows: 8,
            required: true,
            default:
              'We act for and on behalf of Shri Vikram Iyengar, R/o 24, 5th Cross, Jayanagar 4th Block, Bengaluru - 560011 ("our client").\n\nOur client holds a Fixed Deposit with your Bank bearing FDR No. 50300/AGJ/04421 dated 14.02.2024 for a principal amount of ₹15,00,000. The original FDR has been misplaced and despite diligent search cannot be located.\n\nOur client has lodged a complaint at the local police station vide DD Entry No. 4421 dated 18.05.2026 (copy enclosed).\n\nIn the circumstances, we request your Bank to:\na) Mark a lien / stop on the original FDR with immediate effect;\nb) Issue a duplicate FDR in favour of our client against execution of the standard indemnity bond.\n\nWe enclose herewith (i) the duly executed indemnity bond; (ii) copy of the DD entry; and (iii) KYC documents of our client.\n\nKindly do the needful at the earliest. Should you require any further information or document, please do not hesitate to contact us.',
          },
          {
            key: 'closing',
            label: 'Closing',
            type: 'select',
            options: ['Yours faithfully', 'Yours sincerely', 'Yours truly', 'Regards', 'Best regards'],
            required: true,
            default: 'Yours faithfully',
          },
          { key: 'enclosures', label: 'Enclosures', type: 'textarea', rows: 2, optional: true, default: '1. Indemnity bond duly executed by our client.\n2. Copy of DD Entry No. 4421 dated 18.05.2026.\n3. KYC documents of our client (PAN, Aadhaar).' },
          { key: 'date_of_letter', label: 'Date of letter', type: 'date', required: true, default: '2026-05-22' },
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
  { group: 'Letters', items: ['Engagement Letter', 'Correspondence'] },
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
