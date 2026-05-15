/**
 * Pre-filled scenarios users can drop into a brief instead of typing from
 * scratch. Each template targets a specific doc type and supplies a set of
 * field values. Schemas already ship with sensible defaults - these templates
 * exist to give realistic alternative scenarios for common doc types.
 *
 * Adding a new template: pick the doc type, give it a clear label and a
 * one-line summary, and provide field values keyed by the schema's field keys.
 */

export interface DocTemplate {
  id: string;
  docType: string;
  label: string;
  summary: string;
  fields: Record<string, string>;
}

export const DOC_TEMPLATES: ReadonlyArray<DocTemplate> = [
  {
    id: 'ni-138-trade-payable',
    docType: 'Notice u/s 138 NI Act',
    label: 'Trade payable cheque dishonour',
    summary: 'Goods supplied; cheque issued in part-payment dishonoured for "insufficient funds".',
    fields: {
      sender_name: 'Mehta Enterprises Pvt. Ltd.',
      sender_pan: '07AABCM4561K1ZP',
      recipient_name: 'Sandeep Verma',
      cheque_no: '000456789',
      cheque_amount: '475000',
      drawee_bank: 'HDFC Bank, Connaught Place Branch, New Delhi',
      reason_for_cheque: 'Outstanding dues against tax invoices for the supply of industrial valves and fittings under purchase order PO/2025/0931 dated 12.12.2025.',
      invoice_reference: 'Invoices INV/2025/1142, INV/2025/1188 dated 14.02.2026 and 02.03.2026.',
    },
  },
  {
    id: 'ni-138-loan-repayment',
    docType: 'Notice u/s 138 NI Act',
    label: 'Loan repayment cheque dishonour',
    summary: 'Personal loan; repayment cheque returned for "stop payment".',
    fields: {
      sender_name: 'Anil Kapoor',
      recipient_name: 'Rajesh Bhandari',
      cheque_no: '120034',
      cheque_amount: '250000',
      drawee_bank: 'ICICI Bank, Andheri West Branch, Mumbai',
      reason_for_cheque: 'Repayment of friendly loan of ₹2,50,000 advanced on 04.07.2025 vide bank transfer (UTR ICICR52030985).',
      invoice_reference: 'Loan acknowledgement letter dated 04.07.2025 signed by the drawer.',
    },
  },
  {
    id: 'vakalatnama-civil',
    docType: 'Vakalatnama',
    label: 'Civil suit - petitioner',
    summary: 'Vakalatnama for a civil suit, executed by the petitioner authorising counsel.',
    fields: {
      court: 'Court of the Civil Judge, Senior Division, Bengaluru',
      case_title: 'Aarti Mehta v. Skyline Constructions Pvt. Ltd.',
      case_no: 'O.S. No. 421/2026',
      client_name: 'Aarti Mehta',
      counsel_name: 'Adv. Rohan Iyer',
      enrolment_no: 'KAR/4419/2018',
    },
  },
  {
    id: 'legal-notice-recovery',
    docType: 'Legal Notice',
    label: 'Money recovery - services rendered',
    summary: 'Demand notice for unpaid professional fees following completion of services.',
    fields: {
      sender_name: 'Iyer & Iyer Consultants LLP',
      recipient_name: 'Westwind Hospitality Pvt. Ltd.',
      claim_amount: '385000',
      matter: 'Unpaid professional fees for management consultancy services rendered between October 2025 and February 2026, invoiced under engagement letter dated 18.09.2025.',
      parties: 'Sender: Iyer & Iyer Consultants LLP (service provider); Recipient: Westwind Hospitality Pvt. Ltd. (client).',
    },
  },
];

export function getTemplatesForDocType(docType: string): ReadonlyArray<DocTemplate> {
  return DOC_TEMPLATES.filter((t) => t.docType === docType);
}
