// Which engine doc types the intake COMPOSE pass enriches, and which drafting guide
// (intake-compose GUIDES) each uses. Kept apart from intake-compose.service so the
// intake loop can ask "does compose apply?" without loading the compose module.
// Affidavits, court forms, memos and other formal instruments are deliberately
// absent: their wording IS the format.

export type ComposeFamily =
  | 's138_notice' | 'bail' | 'complaint' | 'suit' | 'writ' | 'family' | 'notice' | 'consumer' | 'mact' | 'generic';

export const COMPOSE_FAMILY: Record<string, ComposeFamily> = {
  s138_notice: 's138_notice',
  regular_bail: 'bail', anticipatory_bail: 'bail', default_bail: 'bail',
  s138_complaint: 'complaint',
  plaint: 'suit', summary_suit: 'suit', permanent_injunction: 'suit', injunction: 'suit',
  specific_performance: 'suit', ejectment: 'suit',
  writ_petition: 'writ', writ_criminal: 'writ', contempt_petition: 'writ', special_leave_petition: 'writ',
  maintenance: 'family', dv_application: 'family', divorce_contested: 'family',
  restitution_conjugal_rights: 'family', judicial_separation: 'family',
  general_notice: 'notice', s106_notice: 'notice', s80_notice: 'notice', s138_reply: 'notice',
  consumer_complaint: 'consumer',
  mact_claim: 'mact',
  transfer_petition: 'generic',
};

export const COMPOSE_DOC_TYPES = new Set(Object.keys(COMPOSE_FAMILY));
