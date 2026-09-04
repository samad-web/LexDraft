// Presentation metadata for the s.138 NI Act statutory notice — the advocate-readable
// layer over the engine's s138_notice contract. Field KEYS are engine keys. The
// `cheques` LIST renders as a repeatable sub-record (Cheque 1..N), with row 2..N
// prefilling bank/branch/drawer/payee from row 1 (the common single-bank case) while
// still allowing per-cheque override for cheques drawn on different banks.

import type { DocPresentation } from '../types';

export const s138NoticePresentation: DocPresentation = {
  category: 'Notice',
  description:
    'Statutory demand notice under Section 138 of the Negotiable Instruments Act, 1881 ' +
    'for one or more dishonoured cheques. All limitation dates are load-bearing.',
  sectionOrder: ['Parties', 'Cheques', 'The Debt', 'Presentation & Dishonour', 'Notice & Service'],
  defaultSection: 'Other',
  fields: {
    // --- Parties ---
    client: { label: 'Client (payee / holder in due course)', section: 'Parties', order: 1 },
    recipient_name: { label: 'Recipient (drawer of the cheque)', section: 'Parties', order: 2 },
    recipient_address: { label: 'Recipient address', section: 'Parties', order: 3, rows: 2 },
    advocate: { label: 'Advocate name', section: 'Parties', order: 4 },
    advocate_enrolment: { label: 'Advocate enrolment number', section: 'Parties', order: 5 },

    // --- Cheques (repeatable sub-record) ---
    cheques: {
      label: 'Cheques dishonoured',
      section: 'Cheques',
      order: 1,
      itemNoun: 'Cheque',
      help: 'Add a row per dishonoured cheque. Bank, branch, drawer and payee prefill '
        + 'from the first cheque — override them for a cheque drawn on a different bank.',
      // The single-bank, same-parties case: fill these on cheque 1 and they carry down.
      prefillFromFirst: ['bank', 'branch', 'drawer', 'payee'],
      itemFields: {
        number: { label: 'Cheque number', order: 1 },
        date: { label: 'Cheque date', order: 2 },
        amount: { label: 'Amount (₹)', order: 3 },
        bank: { label: 'Drawee bank', order: 4 },
        branch: { label: 'Branch', order: 5 },
        drawer: { label: 'Drawer (who issued the cheque)', order: 6 },
        payee: { label: 'Payee (in whose favour)', order: 7 },
      },
    },

    // --- The Debt ---
    debt_nature: { label: 'Nature of the legally enforceable debt/liability',
      section: 'The Debt', order: 1, rows: 2,
      help: 'The debt the cheque was issued to discharge — the s.138 ingredient.' },
    debt_documents: { label: 'Supporting documents (one per line)', section: 'The Debt', order: 2,
      placeholder: 'e.g.\npromissory note dated 10-06-2024\nacknowledgement of debt' },

    // --- Presentation & Dishonour ---
    presentation_date: { label: 'Date the cheque was presented', section: 'Presentation & Dishonour', order: 1 },
    presentation_bank: { label: "Bank where presented (payee's bank)", section: 'Presentation & Dishonour', order: 2 },
    memo_date: { label: 'Date on the return/dishonour memo', section: 'Presentation & Dishonour', order: 3 },
    memo_received_date: { label: 'Date the memo was received', section: 'Presentation & Dishonour', order: 4,
      help: 'Starts the 30-day clock to issue this notice — a load-bearing date.' },
    dishonour_reason: { label: 'Reason for return (verbatim from the memo)', section: 'Presentation & Dishonour', order: 5 },

    // --- Notice & Service ---
    notice_date: { label: 'Date of this notice', section: 'Notice & Service', order: 1 },
    dispatch_mode: { label: 'How the notice is sent', section: 'Notice & Service', order: 2,
      placeholder: 'e.g. Registered Post Acknowledgement Due' },
    dispatch_tracking_placeholder: { label: 'Dispatch / tracking reference', section: 'Notice & Service', order: 3,
      help: 'Proof-of-service reference; a placeholder token is fine if not yet dispatched.' },
    place: { label: 'Place (from where the notice issues)', section: 'Notice & Service', order: 4 },
    compliance_days: { label: 'Compliance period (days)', section: 'Notice & Service', order: 5,
      help: 'Defaults to the statutory 15 days if left blank.' },
    override_demand_amount: { label: 'Override total demand amount (₹)', section: 'Notice & Service', order: 6,
      help: 'Leave blank to sum the cheque amounts. Set only to demand a different figure.' },
  },
};
