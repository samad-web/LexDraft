// =============================================================================
// draft-triage.service — STAGE 0 of the auto-drafting flow.
//
// The advocate gives ONE free-form input (typed or dictated) and nothing else —
// no document type, no forum, no field form. This stage reads that raw brief and
// decides WHAT to produce:
//   • docType  — which document, chosen ONLY from a grounded catalog (never
//                invented), so downstream stages get a real, known type.
//   • forum    — the court/authority the document is addressed to.
//   • blocks   — the AI-writable sections the document needs (facts/grounds/…).
//   • confidence + reasoning — surfaced so the advocate can override.
//
// Grounding: the model must return a docType from TRIAGE_DOC_TYPES. If it returns
// anything else we snap to the closest known type (or a safe default) so the
// pipeline never receives a bogus type. Never throws on AI failure — returns a
// low-confidence default the caller can still run or ask the advocate about.
// =============================================================================

import { logger } from '../logger';
import {
  resolveProvider,
  providerModel,
  complete,
  parseJsonLoose,
  type Provider,
} from '../lib/llm-drafting';
import type { DraftBlockSpec } from '../lib/drafting-prompts';
import type { NormalizedUsage } from '../lib/llm-usage';

/** The grounded catalog TRIAGE may choose from. Kept compact and criminal/civil
 *  balanced — mirrors the high-use subset of the web doc-schemas. Each entry
 *  carries the default forum and block set so the downstream pipeline is fully
 *  parameterised the moment a type is chosen. */
interface TriageDocType {
  docType: string;
  /** One-line description to help the model disambiguate. */
  hint: string;
  defaultForum: string;
  blocks: DraftBlockSpec[];
}

const B = {
  facts: { block: 'facts', instruction: 'Narrate the facts chronologically in formal legal English, drawn only from the brief.' },
  grounds: {
    block: 'grounds',
    instruction:
      'State the legal grounds in numbered paragraphs, each opening with "That". Write each ground as ONE self-standing proposition the court could accept on its own — do not bundle two points into one ground, and do NOT waste a ground on a bare section reference (e.g. "the offence is punishable under BNS X"); every ground must advance a REASON for the relief. ORDER the grounds strongest-and-most-objective first: (1) lead with grounds resting on the court record or facts the opponent cannot dispute — charge-sheet filed so custodial interrogation is complete, period already in custody; (2) then the triple-test grounds, each as its OWN ground: no flight risk (roots, permanent residence, family), no risk of tampering with evidence (evidence already collected / documentary in nature), and no risk of influencing witnesses; (3) then antecedents and personal circumstances (clean record, age, health); (4) close with a genuine CAPSTONE ground that ties the case together — that on a holistic view of the settled bail principles the continued detention serves no purpose and bail ought to follow. Where a resolved section or a settled principle supports a ground, tie it to that ground; cite ONLY the resolved sections and do not invent case law. Argue for the client, not neutrally.',
  },
  prayer: { block: 'prayer', instruction: 'State the precise relief sought.' },
  // GENERIC application grounds — NOT bail-specific. The bail `grounds` block
  // hard-codes the triple-test (flight risk, tampering, antecedents), which is
  // wrong for any non-bail application (exemption, interim relief, condonation,
  // etc.). This block states grounds tied to whatever relief the application
  // actually seeks, drawn only from the brief.
  applicationGrounds: {
    block: 'grounds',
    instruction:
      'State the legal grounds for the application in numbered paragraphs, each opening with "That" and each a single self-standing proposition that advances a REASON for the relief sought — never a bare section reference. The grounds must be tied to THIS application\'s relief and drawn ONLY from the brief; do NOT import bail reasoning (flight risk, tampering with evidence, influencing witnesses, antecedents, custodial interrogation) unless the application is actually for bail. Where the relief is interim, plead the applicable test (for a stay/injunction: prima facie case, balance of convenience, irreparable injury). Where a resolved section or settled principle supports a ground, tie it to that ground; do not invent case law. Argue for the applicant, not neutrally.',
  },
  // Section 317 CrPC / §355 BNSS — exemption from personal appearance of the
  // accused. Its own facts + grounds so it never inherits bail/stay reasoning.
  exemptionFacts: {
    block: 'facts',
    instruction:
      'Narrate, in numbered paragraphs drawn ONLY from the brief: (1) the pending case number and the court, and that the applicant is the accused therein; (2) the stage of the case and the next date of hearing; (3) the specific, genuine reason the accused cannot appear in person on that date (illness, being at a distant place, old age/infirmity, a woman under purdah where pleaded, or other sufficient cause) — with particulars if the brief supplies them, else a clearly bracketed placeholder; (4) that the accused is represented by a duly appointed pleader who is present and instructed to answer on the accused\'s behalf. Do not invent the reason if the brief does not supply one.',
  },
  exemptionGrounds: {
    block: 'grounds',
    instruction:
      'State the grounds in numbered paragraphs, each opening with "That": (1) that under Section 317 of the Code of Criminal Procedure, 1973 (corresponding to Section 355 of the Bharatiya Nagarik Suraksha Sanhita, 2023), a Magistrate/Judge may dispense with the personal attendance of the accused where satisfied of sufficient cause, provided the accused is represented by a pleader; (2) that the applicant\'s personal presence is not necessary for the proceeding fixed on the next date and the case will not be prejudiced by his absence; (3) that the applicant undertakes to appear in person whenever specifically directed by the Court and not to take advantage of the exemption to delay the trial; (4) that the pleader is duly instructed to admit/deny facts and to answer on the applicant\'s behalf, so no prejudice is caused to the prosecution. Draw only from the brief and do not invent particulars.',
  },
  recital: { block: 'recital', instruction: 'State the parties, the background (WHEREAS), and the purpose of the document.' },
  operative: { block: 'operative', instruction: 'Set out the operative clauses / demand / terms, numbered.' },
  parties: { block: 'parties', instruction: 'Identify the parties with full legal descriptions and defined short names.' },
  terms: { block: 'terms', instruction: 'Set out the substantive terms, obligations, consideration, and covenants, numbered.' },
  boilerplate: { block: 'boilerplate', instruction: 'Standard clauses: term & termination, governing law, dispute resolution, notices, indemnity, confidentiality where relevant.' },
  schedule: { block: 'schedule', instruction: 'Describe the subject property/assets in a schedule with sufficient particulars.' },

  // ---- Notice / letter framing blocks -------------------------------------
  // A legal notice is a LETTER, not a bare recital. These produce the wrapper
  // an advocate's notice must carry: reference/date, addressee, subject,
  // opening, and a signature block — so the output reads as a real notice.
  noticeHeader: {
    block: 'header',
    instruction:
      'Produce the notice header: a reference-number placeholder line "Ref: [Ref No.]" and the date; then the addressee block starting with "To," followed by the recipient (Respondent/Noticee) name and full address on separate lines; then a "Subject:" line naming the notice (e.g. "Legal notice under Section 138 of the Negotiable Instruments Act, 1881"). Use bracketed placeholders like [Ref No.] only where a fact is genuinely absent.',
  },
  noticeOpening: {
    block: 'opening',
    instruction:
      'Write the opening paragraph: "Under instructions from and on behalf of my client, <client name and address>, I hereby serve upon you the following legal notice:" — naming the client (the Complainant/sender) with their address from the brief.',
  },
  noticeRecital: {
    block: 'recital',
    instruction:
      'State the facts giving rise to the notice in numbered paragraphs: the underlying transaction/liability, and (for a cheque matter) the exact particulars of each cheque — number, amount, date, drawee bank. Then aver: (a) the date the cheque was presented and that it was presented within the period of its validity (proviso (a) to Section 138 NI Act); (b) its dishonour, with the return-memo reason and the date of the return memo, so that the 30-day window for this demand notice (proviso (b)) is computed from that date. Draw ONLY from the brief; use bracketed placeholders (e.g. "[date of return memo to be confirmed]") for any particular absent from the brief — do not invent particulars.',
  },
  noticeDemand: {
    block: 'demand',
    instruction:
      'State the statutory demand: call upon the Noticee to pay the exact amount of the DISHONOURED cheque(s) (make the demanded sum consistent with the cheque particulars above) within 15 days of receipt of this notice, failing which the client shall be constrained to initiate prosecution under Section 138 of the Negotiable Instruments Act, 1881, and/or other appropriate legal proceedings, at the Noticee’s risk as to cost and consequences.',
  },
  noticeSignature: {
    block: 'signature',
    instruction:
      'Close with the advocate signature block: "Yours faithfully," then "[Advocate Name]", "Advocate for the Complainant", and a contact/address placeholder line. Note that a copy is retained in the office.',
  },
  demandGeneric: {
    block: 'demand',
    instruction:
      'State the demand/relief called for and a reasonable period to comply (typically 15 days), failing which the client will be constrained to initiate appropriate civil/criminal proceedings at the Noticee’s risk as to costs and consequences.',
  },
  // A GENERIC legal notice must NOT inherit the cheque/§138 recital. This block
  // states the underlying facts without assuming any particular cause of action,
  // and never invents a statute or particulars not present in the brief.
  noticeRecitalGeneric: {
    block: 'recital',
    instruction:
      'State the facts giving rise to the notice in numbered paragraphs, drawing ONLY from the brief: the relationship/transaction between the parties, the obligation or right relied upon, and the specific breach or grievance. Do NOT assume a cheque, a loan, or any particular cause of action unless the brief supplies it. If the brief names the statutory provision the notice is issued under, state it; if it does not, do NOT invent one — frame the demand on the facts. Use bracketed placeholders like [amount to be confirmed] for any particular the brief does not supply.',
  },
  // Anticipatory bail's jurisdictional foundation: the apprehension of arrest.
  // Distinct from regular bail (which pleads custody). Never invents an FIR.
  apprehension: {
    block: 'apprehension',
    instruction:
      "State the applicant's reasonable apprehension of arrest in a non-bailable offence and its basis — the registered FIR/crime number and sections (if any), or the specific threat or circumstance giving rise to the apprehension — drawn ONLY from the brief. Where the basis is not in the brief, leave a clearly bracketed placeholder such as \"[basis of apprehension — FIR No. / threat to be confirmed]\" rather than inventing an FIR, a complainant, or an event. Place this before the grounds.",
  },
  // Caveat's defining averment: the apprehended proceeding + the service undertaking.
  caveatBody: {
    block: 'facts',
    instruction:
      'State the caveat’s essentials in numbered paragraphs, drawn ONLY from the brief: (1) that the caveator apprehends the filing of a suit/application/appeal by the named prospective party, describing the matter apprehended; (2) the caveator’s interest in being heard; (3) the caveator’s undertaking to serve a copy of this caveat by registered post on the prospective applicant. Use bracketed placeholders for any particular the brief does not supply; do not invent case numbers or parties.',
  },
  // A neutral professional-letter opening — NOT the "I hereby serve upon you the
  // following legal notice" wrapper. Used by engagement letters, LoIs, general
  // correspondence, which are letters, not notices.
  letterOpening: {
    block: 'opening',
    instruction:
      'Write the opening of a professional letter appropriate to its purpose (engagement of services, a letter of intent, or general correspondence) — a courteous salutation and an opening paragraph stating the purpose of the letter. Do NOT use notice language such as "I hereby serve upon you the following legal notice". Draw the parties and subject only from the brief.',
  },
  // A rejoinder/replication is written in the PLAINTIFF's voice, replying only to
  // the NEW matter in the written statement — not a fresh defence pleading.
  rejoinderReply: {
    block: 'paraWiseReply',
    instruction:
      'Writing in the PLAINTIFF’s voice, reply paragraph by paragraph ONLY to the ADDITIONAL PLEAS, new facts, and any counter-claim or set-off raised in the defendant’s written statement — do NOT re-plead the plaint. For each new averment state whether it is admitted or denied and reaffirm the plaint where the written statement contradicts it. Draw only from the brief; where the written statement’s contents are not supplied, leave a clearly bracketed placeholder rather than inventing the defendant’s pleas.',
  },
  loiBindingClause: {
    block: 'binding',
    instruction:
      'Add a clause expressly distinguishing which parts of this Letter of Intent are BINDING (typically confidentiality, exclusivity, costs, and governing law) from those that are NON-BINDING statements of intent, so the LoI is not mistaken for a concluded contract.',
  },

  // ---- Pleading / court-document framing -----------------------------------
  causeTitle: {
    block: 'causeTitle',
    instruction:
      'Produce the cause title: the full name of the court/forum, the case/application number placeholder (e.g. "___ of 20__"), and — immediately under the case number — the ENABLING PROVISION line for this document where one applies, in the form "(Under Section ___ of the ___)". For a bail application this is Section 483 BNSS, 2023 (or Section 480 before a Magistrate); for anticipatory bail, Section 482 BNSS, 2023; for a private complaint, Section 223 BNSS, 2023; for an application to dispense with the personal appearance of the accused, Section 317 of the Code of Criminal Procedure, 1973 (corresponding to Section 355 BNSS, 2023); for a plaint, the CPC order/provision invoked. Do NOT cite a repealed CrPC/IPC section. Then set out the array of parties (Petitioner/Applicant/Plaintiff vs. Respondent/Defendant/State) with a one-line description (name, and where relevant s/o, age, occupation, address) of each.',
  },
  verification: {
    block: 'verification',
    instruction:
      'Add the verification/affirmation clause, splitting the source of knowledge correctly: the FACTUAL paragraphs are verified as "true to my personal knowledge", while the GROUNDS/legal submissions are verified as "based on legal advice believed to be true" — do not swear the grounds as personal knowledge. Use the form: "Verified at [place] on [date] that the contents of paragraphs [fact paras] are true to my personal knowledge and the grounds are based on legal advice believed to be true, and nothing material has been concealed." Follow with signature lines for the party and "Advocate for the [Applicant/Petitioner/Plaintiff]".',
  },
  undertaking: {
    block: 'undertaking',
    instruction:
      'Add the undertaking of the applicant: to cooperate with the investigation/trial, to remain available and attend as and when required, and not to abscond, tamper with evidence, or influence witnesses.',
  },
  // Written-statement-specific blocks (Order VIII CPC): a WS is a paragraph-wise
  // reply, not a fresh facts/grounds pleading.
  preliminaryObjections: {
    block: 'preliminaryObjections',
    instruction:
      'State the preliminary objections in numbered paragraphs: maintainability, limitation, jurisdiction, cause of action, non-joinder/mis-joinder of parties, and any bar to the suit — each as a distinct legal objection that defeats or answers the plaint.',
  },
  paraWiseReply: {
    block: 'paraWiseReply',
    instruction:
      'Reply to the plaint paragraph by paragraph, mirroring the plaint’s paragraph numbers. For each averment state expressly whether it is ADMITTED, DENIED, or NOT ADMITTED and put the plaintiff to strict proof. Deny specifically — a vague or evasive denial is treated in law as an admission. Then set out the defendant’s own version of the facts.',
  },

  // ---- Deed / instrument framing -------------------------------------------
  deedTitle: {
    block: 'title',
    instruction:
      'Produce the deed title (e.g. "THIS DEED OF SALE"), the date and place of execution, and the parties block: each party with full description (name, s/o, age, occupation, address) and their capacity (Executant/Vendor/Donor vs. Claimant/Vendee/Donee), with defined short names.',
  },
  deedRecitals: {
    block: 'recitals',
    instruction:
      'Write the recitals as "WHEREAS ..." paragraphs establishing title/ownership and the background leading to this deed.',
  },
  deedOperative: {
    block: 'operative',
    instruction:
      'Write the operative part opening with "NOW THIS DEED WITNESSETH AS FOLLOWS:" and numbered covenants effecting the transfer/grant, including the consideration and its acknowledgement where the deed is for value, and words of conveyance.',
  },
  testimonium: {
    block: 'testimonium',
    instruction:
      'Add the testimonium ("IN WITNESS WHEREOF the parties have set their hands...") with execution/signature lines for the parties, an attestation block for at least two witnesses, and a note on the applicable stamp duty and registration requirement.',
  },

  // ---- Agreement framing ---------------------------------------------------
  agreementTitle: {
    block: 'title',
    instruction:
      'Produce the agreement title, the date and place, and the parties block: full legal names, capacity, and defined short names (e.g. "the Company", "the Consultant").',
  },
  execution: {
    block: 'execution',
    instruction:
      'Close with the execution block: "IN WITNESS WHEREOF the parties have executed this Agreement on the date first written above," followed by signature lines for each party and witness lines.',
  },

  // ---- Affidavit framing ---------------------------------------------------
  deponent: {
    block: 'deponent',
    instruction:
      'Open with the deponent identification: "I, [name], aged about [age] years, [occupation], resident of [address], do solemnly affirm and state on oath as follows:" — drawn from the brief.',
  },
  jurat: {
    block: 'jurat',
    instruction:
      'Close with the verification/jurat, SPLITTING the source of knowledge (do not swear everything as personal knowledge): state which paragraphs are true to the deponent’s own personal knowledge and which are based on information received and believed to be true, in the form "Verified at [place] on [date] that the contents of paragraphs [__] are true to my personal knowledge and paragraphs [__] are based on information received and believed to be true, and nothing material has been concealed." Add a "DEPONENT" signature line and an attestation block for the Oath Commissioner / Notary.',
  },

  // ---- Will framing --------------------------------------------------------
  willDeclaration: {
    block: 'declaration',
    instruction:
      'Open with the testator declaration: "I, [name], aged about [age] years, [occupation], resident of [address], being of sound mind and memory and making this Will of my own free will without any coercion, declare this to be my last Will and Testament," and REVOKE all earlier wills and codicils.',
  },
  willBequests: {
    block: 'bequests',
    instruction:
      'Set out the bequests in numbered clauses: appoint the executor(s); describe each property/asset and to whom it is bequeathed; residuary clause. Draw only from the brief; use bracketed placeholders for absent particulars.',
  },
  willAttestation: {
    block: 'attestation',
    instruction:
      'Close with the testator signature line and the attestation clause: "Signed by the above-named testator as his/her last Will in our presence, who have subscribed as witnesses in the presence of the testator and of each other," with two witness signature/address blocks.',
  },

  // ---- Power of attorney framing -------------------------------------------
  poaAppointment: {
    block: 'appointment',
    instruction:
      'Open: "KNOW ALL MEN BY THESE PRESENTS that I, [Principal name, description, address] (the Principal), do hereby nominate, constitute and appoint [Attorney name, description, address] (the Attorney) to be my true and lawful attorney." State the reason/occasion for the appointment.',
  },
  poaPowers: {
    block: 'powers',
    instruction:
      'Enumerate the powers granted, in numbered clauses (specific and limited for a Specific PoA; broad for a General PoA), and a ratification clause confirming acts done by the Attorney. Draw the scope from the brief.',
  },
  poaExecution: {
    block: 'execution',
    instruction:
      'Close with the testimonium ("IN WITNESS WHEREOF..."), the Principal’s signature line, an attestation block for two witnesses, and a note that the instrument is to be notarised/registered as required.',
  },

  // ---- Bond framing --------------------------------------------------------
  bondObligation: {
    block: 'obligation',
    instruction:
      'Open with the bond obligation: "KNOW ALL MEN BY THESE PRESENTS that I/We, [Obligor], am/are held and firmly bound to [Obligee] in the sum of [amount] (the penalty)," and the recital of the transaction/liability the bond secures.',
  },
  bondCondition: {
    block: 'condition',
    instruction:
      'State the condition of the bond: "The condition of the above obligation is such that if [the obligor indemnifies/performs as required], then this obligation shall be void, otherwise it shall remain in full force." Set out the indemnity/guarantee terms in numbered clauses.',
  },

  // ---- Application (RTI / Caveat / non-court application) framing -----------
  applicationHeader: {
    block: 'header',
    instruction:
      'Produce the addressee/header: "To, The [Public Information Officer / authority], [office and address]" and a "Subject:" line naming the application (e.g. "Application seeking information under the Right to Information Act, 2005").',
  },
  infoSought: {
    block: 'infoSought',
    instruction:
      'State the applicant’s details and the information/relief sought in numbered points, specific and answerable. For RTI, note the prescribed fee and (if claimed) BPL exemption.',
  },
  applicationClose: {
    block: 'close',
    instruction:
      'Close with a declaration that the information is sought for the applicant’s own use, the applicant’s signature line, name, address, and date.',
  },

  // ---- Written arguments framing -------------------------------------------
  submissions: {
    block: 'submissions',
    instruction:
      'Set out the written submissions issue-wise / point-wise in numbered paragraphs: the point for determination, the facts and evidence relied on, and the legal submission with authorities where available. Argue for the party, not neutrally.',
  },

  // ---- Vakalatnama framing -------------------------------------------------
  vakalatBody: {
    block: 'appointment',
    instruction:
      'Produce the vakalatnama: cause title (court, case number placeholder, parties); the executant’s appointment of the advocate ("I/We, [client], do hereby appoint and retain [Advocate] to appear, act and plead on my/our behalf in the above case"); the standard authorities (to file/receive documents, compromise with consent, receive money, engage other counsel); and the acceptance and signature blocks for the client and the advocate.',
  },
} as const;

// ---- Block presets: each document FAMILY in its own correct court format ----
// The agent understands each document and emits the structure that belongs to
// it — a pleading is not drafted like a deed, a notice not like an agreement.
const PLEADING = [B.causeTitle, B.facts, B.grounds, B.prayer, B.verification];
const BAIL = [B.causeTitle, B.facts, B.grounds, B.undertaking, B.prayer, B.verification];
// A generic interlocutory application (stay/interim/miscellaneous) uses GENERIC
// application grounds — NOT the bail triple-test that B.grounds hard-codes.
const APPLICATION = [B.causeTitle, B.facts, B.applicationGrounds, B.prayer, B.verification];
// §317 CrPC / §355 BNSS exemption from personal appearance: its own facts +
// grounds so it never comes out as a bail or stay pleading.
const EXEMPTION_APPLICATION = [B.causeTitle, B.exemptionFacts, B.exemptionGrounds, B.prayer, B.verification];
// Anticipatory bail pleads APPREHENSION of arrest (its jurisdictional basis),
// not custody — so it gets its own preset with the apprehension block first.
const ANTICIPATORY_BAIL = [B.causeTitle, B.apprehension, B.facts, B.grounds, B.undertaking, B.prayer, B.verification];
// A written statement / reply is a paragraph-wise DEFENCE, not a fresh pleading.
const WRITTEN_STATEMENT = [B.causeTitle, B.preliminaryObjections, B.paraWiseReply, B.prayer, B.verification];
// A replication/rejoinder is the PLAINTIFF replying to the NEW matter in the WS.
const REPLICATION = [B.causeTitle, B.rejoinderReply, B.prayer, B.verification];
// A §138 notice: full letter framing + statutory 15-day demand + signature.
const NOTICE_138 = [B.noticeHeader, B.noticeOpening, B.noticeRecital, B.noticeDemand, B.noticeSignature];
// A generic legal notice: same framing but a NON-cheque recital (must not inherit
// the §138 particulars) and a demand without the §138-specific limb.
const NOTICE_GENERIC = [B.noticeHeader, B.noticeOpening, B.noticeRecitalGeneric, B.demandGeneric, B.noticeSignature];
const DEED = [B.deedTitle, B.deedRecitals, B.deedOperative, B.schedule, B.testimonium];
const AGREEMENT = [B.agreementTitle, B.recital, B.terms, B.boilerplate, B.execution];
// Letters (engagement, correspondence) — a professional letter, NOT a notice.
const LETTER = [B.noticeHeader, B.letterOpening, B.operative, B.noticeSignature];
// A Letter of Intent additionally needs the binding/non-binding distinction.
const LOI = [B.noticeHeader, B.letterOpening, B.operative, B.loiBindingClause, B.noticeSignature];
const AFFIDAVIT = [B.deponent, B.facts, B.jurat];
// A sworn affidavit filed in a proceeding also carries a cause title on top.
const AFFIDAVIT_IN_CASE = [B.causeTitle, B.deponent, B.facts, B.jurat];
// Instruments / applications with their own correct structure.
const WILL = [B.willDeclaration, B.willBequests, B.willAttestation];
const POA = [B.poaAppointment, B.poaPowers, B.poaExecution];
const BOND = [B.bondObligation, B.bondCondition, B.execution];
const RTI = [B.applicationHeader, B.infoSought, B.applicationClose];
const WRITTEN_ARGUMENTS = [B.causeTitle, B.submissions];
// A caveat pleads the apprehended proceeding + service undertaking, not generic facts.
const CAVEAT = [B.causeTitle, B.caveatBody, B.prayer];
const VAKALATNAMA = [B.vakalatBody];

// Every document type in the web schema (doc-schemas.ts) is routable. Litigation
// docs use fact/ground/prayer; instruments use parties/recital/terms; notices use
// recital/operative. The hint disambiguates plain-language briefs for TRIAGE.
export const TRIAGE_DOC_TYPES: TriageDocType[] = [
  // ---- Criminal & bail ----
  { docType: 'Bail Application', hint: 'accused arrested/in custody, seeking regular bail', defaultForum: 'Court of Session', blocks: BAIL },
  { docType: 'Anticipatory Bail Application', hint: 'apprehending arrest, seeking pre-arrest bail', defaultForum: 'High Court / Court of Session', blocks: ANTICIPATORY_BAIL },
  { docType: 'Complaint', hint: 'a criminal complaint to set the criminal law in motion', defaultForum: 'Court of Judicial Magistrate', blocks: PLEADING },
  // ---- Notices ----
  { docType: 'Notice u/s 138 NI Act', hint: 'a cheque was dishonoured / bounced', defaultForum: 'By Regd. Post / Advocate notice', blocks: NOTICE_138 },
  { docType: 'Legal Notice', hint: 'a demand or grievance served before litigation', defaultForum: 'By Regd. Post / Advocate notice', blocks: NOTICE_GENERIC },
  // ---- Civil pleadings ----
  { docType: 'Plaint', hint: 'a civil suit to be filed (recovery, declaration, injunction, specific performance, partition)', defaultForum: 'Court of Civil Judge', blocks: PLEADING },
  { docType: 'Written Statement', hint: 'a defendant replying to a plaint/suit', defaultForum: 'Court of Civil Judge', blocks: WRITTEN_STATEMENT },
  { docType: 'Replication / Rejoinder', hint: 'plaintiff replying to a written statement', defaultForum: 'Court of Civil Judge', blocks: REPLICATION },
  { docType: 'Written Arguments', hint: 'written submissions after evidence/hearing', defaultForum: 'Court where the case is pending', blocks: WRITTEN_ARGUMENTS },
  { docType: 'Appeal', hint: 'challenging an order/judgment before a higher court', defaultForum: 'Appellate Court', blocks: PLEADING },
  { docType: 'Execution Petition', hint: 'enforcing a decree/order already obtained', defaultForum: 'Executing Court', blocks: PLEADING },
  // ---- Applications ----
  { docType: 'IA / Stay Application', hint: 'an interlocutory/interim application within a pending case (stay, interim relief, condonation, etc.) — NOT bail and NOT exemption from appearance', defaultForum: 'Court where the main case is pending', blocks: APPLICATION },
  { docType: 'Exemption from Personal Appearance (Section 317 CrPC)', hint: 'accused seeking to dispense with personal attendance on a hearing date via his pleader — Section 317 CrPC / Section 355 BNSS; also "317 application", "exemption application", "misl. exemption"', defaultForum: 'Court where the criminal case is pending', blocks: EXEMPTION_APPLICATION },
  { docType: 'Caveat', hint: 'pre-empting an ex-parte order; caveat u/s 148A CPC', defaultForum: 'Court/Tribunal expected to be moved', blocks: CAVEAT },
  { docType: 'RTI Application', hint: 'seeking information under the RTI Act', defaultForum: 'Public Information Officer', blocks: RTI },
  // ---- Affidavits ----
  { docType: 'Affidavit', hint: 'a sworn statement of facts', defaultForum: 'Before the Oath Commissioner / Court', blocks: AFFIDAVIT },
  { docType: 'Evidence Affidavit', hint: 'examination-in-chief on affidavit (Order XVIII CPC)', defaultForum: 'Court where the case is pending', blocks: AFFIDAVIT_IN_CASE },
  // ---- Authority / engagement ----
  { docType: 'Vakalatnama', hint: 'appointing an advocate to appear in a case', defaultForum: 'Court where the case is pending', blocks: VAKALATNAMA },
  { docType: 'Engagement Letter', hint: 'engaging professional/legal services, terms of retainer', defaultForum: 'Between the parties', blocks: LETTER },
  { docType: 'Correspondence', hint: 'general professional letter/correspondence', defaultForum: 'Between the parties', blocks: LETTER },
  { docType: 'Settlement Agreement', hint: 'parties settling a dispute', defaultForum: 'Between the parties', blocks: AGREEMENT },
  // ---- Commercial agreements ----
  { docType: 'Sale Agreement / Sale Deed', hint: 'sale/transfer of immovable property', defaultForum: 'Between the parties (for registration)', blocks: DEED },
  { docType: 'Lease / Rent / Tenancy Agreement', hint: 'leasing/renting property', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Loan Agreement', hint: 'lending/borrowing money on terms', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Mortgage Deed', hint: 'mortgaging immovable property as security', defaultForum: 'Between the parties (for registration)', blocks: DEED },
  { docType: 'Hypothecation Deed', hint: 'hypothecating movable assets as security', defaultForum: 'Between the parties', blocks: DEED },
  { docType: 'Service Agreement', hint: 'provision of services on terms', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Consultancy Agreement', hint: 'engaging a consultant', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Employment Contract', hint: 'employer-employee terms of employment', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Non-Compete Agreement', hint: 'restraint on competing/soliciting', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Memorandum of Understanding (MoU)', hint: 'recording an understanding/intent between parties', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Letter of Intent (LoI)', hint: 'intent to proceed with a transaction', defaultForum: 'Between the parties', blocks: LOI },
  { docType: 'Non-Disclosure Agreement (NDA)', hint: 'confidentiality between parties', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Distribution Agreement', hint: 'appointing a distributor', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Franchise Agreement', hint: 'granting a franchise', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Licensing Agreement', hint: 'licensing IP/rights', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Construction / Works Contract', hint: 'construction/works to be executed', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Joint Venture Agreement', hint: 'two+ parties forming a joint venture', defaultForum: 'Between the parties', blocks: AGREEMENT },
  // ---- Corporate agreements ----
  { docType: "Shareholders' Agreement (SHA)", hint: 'governing shareholder rights and company affairs', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Share Purchase Agreement (SPA)', hint: 'buying/selling shares of a company', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Share Subscription Agreement (SSA)', hint: 'subscribing to newly issued shares', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Asset Purchase Agreement', hint: 'buying/selling business assets', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Founder / Co-founder Agreement', hint: 'terms among startup founders', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'ESOP Grant Agreement', hint: 'granting employee stock options', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Term Sheet', hint: 'high-level deal terms before definitive docs', defaultForum: 'Between the parties', blocks: [B.parties, B.terms] },
  { docType: 'Slump Sale Agreement', hint: 'transfer of a business undertaking as a going concern', defaultForum: 'Between the parties', blocks: AGREEMENT },
  // ---- Property & family ----
  { docType: 'Gift Deed', hint: 'gifting property without consideration', defaultForum: 'Between the parties (for registration)', blocks: DEED },
  { docType: 'Partition Deed', hint: 'partitioning joint/family property', defaultForum: 'Between the parties (for registration)', blocks: DEED },
  { docType: 'Relinquishment Deed', hint: 'relinquishing a share in property', defaultForum: 'Between the parties (for registration)', blocks: DEED },
  { docType: 'Power of Attorney (General)', hint: 'general authority to act on one’s behalf', defaultForum: 'Before a notary/registrar', blocks: POA },
  { docType: 'Power of Attorney (Specific)', hint: 'specific/limited authority for a defined act', defaultForum: 'Before a notary/registrar', blocks: POA },
  { docType: 'Trust Deed', hint: 'creating a trust', defaultForum: 'Between settlor and trustees (for registration)', blocks: DEED },
  { docType: 'Will', hint: 'testamentary disposition of property', defaultForum: 'Executed before witnesses', blocks: WILL },
  { docType: 'Family Settlement Agreement', hint: 'settling family disputes/property amicably', defaultForum: 'Between family members', blocks: AGREEMENT },
  { docType: 'Adoption Deed', hint: 'recording an adoption', defaultForum: 'Between the parties (for registration)', blocks: DEED },
  { docType: 'Pre-nuptial Agreement', hint: 'terms agreed before marriage', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Post-nuptial Agreement', hint: 'terms agreed after marriage', defaultForum: 'Between the parties', blocks: AGREEMENT },
  // ---- Specialised ----
  { docType: 'Arbitration Agreement', hint: 'agreeing to arbitrate disputes', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Indemnity Bond', hint: 'indemnifying against loss', defaultForum: 'Executed as a bond', blocks: BOND },
  { docType: 'Guarantee Bond', hint: 'guaranteeing performance/payment', defaultForum: 'Executed as a bond', blocks: BOND },
  { docType: 'Pledge Agreement', hint: 'pledging movable goods as security', defaultForum: 'Between the parties', blocks: AGREEMENT },
  { docType: 'Insurance Contract', hint: 'insurance cover on terms', defaultForum: 'Between insurer and insured', blocks: AGREEMENT },
];

const DOC_TYPE_SET = new Set(TRIAGE_DOC_TYPES.map((t) => t.docType));
const DEFAULT_TYPE = TRIAGE_DOC_TYPES[0]!; // Bail Application — safe criminal default

export interface TriageResult {
  docType: string;
  forum: string;
  blocks: DraftBlockSpec[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  /** True when the model's raw pick had to be snapped to a known type. */
  snapped: boolean;
  /** Populated when the pipeline should confirm with the advocate first. */
  usage?: NormalizedUsage;
  modelUsed: string;
}

function buildTriagePrompt(brief: string): { system: string; user: string } {
  const catalog = TRIAGE_DOC_TYPES.map((t) => `- "${t.docType}": ${t.hint}`).join('\n');
  const system = `You are an experienced Indian advocate's drafting assistant. The advocate has described a matter in plain language (typed or dictated). Decide WHICH single legal document should be drafted.

You MUST choose docType from EXACTLY this list — never invent one:
${catalog}

Output ONLY a JSON object, no prose, no markdown fence, of this shape:
{
  "docType": "<one value copied verbatim from the list above>",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<one sentence: why this document fits the matter>"
}

Rules:
- Pick the document the advocate most likely needs given the matter.
- If the brief mentions arrest/custody and seeking release -> a bail document.
- If a cheque bounced/dishonoured -> "Notice u/s 138 NI Act".
- If unsure between two, pick the more specific one and set confidence "medium" or "low".
- docType MUST be copied verbatim from the list. Do not add sections, forums, or extra keys.`;
  const user = `# Advocate's matter\n${brief.slice(0, 8000)}`;
  return { system, user };
}

/** Snap a model-returned docType to a known catalog entry. Exact match wins;
 *  otherwise a loose contains-match; otherwise the safe default. */
function resolveDocType(raw: string | undefined): { entry: TriageDocType; snapped: boolean } {
  if (raw && DOC_TYPE_SET.has(raw)) {
    return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === raw)!, snapped: false };
  }
  if (raw) {
    const low = raw.toLowerCase();
    const hit = TRIAGE_DOC_TYPES.find(
      (t) => low.includes(t.docType.toLowerCase()) || t.docType.toLowerCase().includes(low),
    );
    if (hit) return { entry: hit, snapped: true };
    // Keyword fallbacks for common phrasings the model might return.
    // §317 exemption FIRST — it must beat the generic "application" fallbacks,
    // and "317 application" won't contains-match the long docType name above.
    if (/\b317\b|\b355\b|exempt.*appear|appear.*exempt|dispens.*(attend|appear)|personal appearance/.test(low)) {
      return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Exemption from Personal Appearance (Section 317 CrPC)')!, snapped: true };
    }
    if (/bail/.test(low) && /anticipat|pre.?arrest/.test(low)) {
      return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Anticipatory Bail Application')!, snapped: true };
    }
    if (/bail/.test(low)) return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Bail Application')!, snapped: true };
    if (/138|cheque|dishonou?r/.test(low)) return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Notice u/s 138 NI Act')!, snapped: true };
    if (/notice/.test(low)) return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Legal Notice')!, snapped: true };
    if (/plaint|suit/.test(low)) return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Plaint')!, snapped: true };
    if (/affidavit/.test(low)) return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Affidavit')!, snapped: true };
    if (/appeal/.test(low)) return { entry: TRIAGE_DOC_TYPES.find((t) => t.docType === 'Appeal')!, snapped: true };
  }
  return { entry: DEFAULT_TYPE, snapped: true };
}

export const draftTriageService = {
  /**
   * Read the raw brief and decide what document to draft. Never throws on AI
   * failure — degrades to a keyword-based guess (or the default) at low
   * confidence so the caller can still proceed or ask the advocate.
   */
  async triage(brief: string, providerOverride?: 'xai' | 'anthropic'): Promise<TriageResult> {
    const provider: Provider = resolveProvider(providerOverride);

    // No provider / empty brief: keyword-only triage, low confidence.
    if (provider === 'none' || !brief.trim()) {
      const { entry, snapped } = resolveDocType(keywordGuess(brief));
      return {
        docType: entry.docType,
        forum: entry.defaultForum,
        blocks: entry.blocks,
        confidence: 'low',
        reasoning: 'AI is unavailable — document inferred from keywords; please confirm.',
        snapped,
        modelUsed: 'fallback:none',
      };
    }

    try {
      const { system, user } = buildTriagePrompt(brief);
      const r = await complete(provider, system, user, 400);
      const parsed = parseJsonLoose<{ docType?: string; confidence?: string; reasoning?: string }>(r.text);
      const { entry, snapped } = resolveDocType(parsed?.docType);
      const confidence: TriageResult['confidence'] =
        snapped ? 'low' : parsed?.confidence === 'high' || parsed?.confidence === 'medium' || parsed?.confidence === 'low'
          ? parsed.confidence
          : 'medium';
      return {
        docType: entry.docType,
        forum: entry.defaultForum,
        blocks: entry.blocks,
        confidence,
        reasoning: parsed?.reasoning?.trim() || `Selected ${entry.docType} for this matter.`,
        snapped,
        usage: { tokensIn: r.tokensIn, tokensOut: r.tokensOut },
        modelUsed: `${provider}:${providerModel(provider)}`,
      };
    } catch (err) {
      logger.warn({ err }, 'draft-triage: LLM failed, using keyword guess');
      const { entry, snapped } = resolveDocType(keywordGuess(brief));
      return {
        docType: entry.docType,
        forum: entry.defaultForum,
        blocks: entry.blocks,
        confidence: 'low',
        reasoning: 'AI triage failed — document inferred from keywords; please confirm.',
        snapped,
        modelUsed: `${provider}:degraded`,
      };
    }
  },
};

/** Cheap keyword classifier used when the LLM is off or fails. */
function keywordGuess(brief: string): string {
  const t = brief.toLowerCase();
  if (/\b317\b|\b355\b|exempt.*appear|appear.*exempt|dispens.*(attend|appear)|personal appearance/.test(t)) {
    return 'Exemption from Personal Appearance (Section 317 CrPC)';
  }
  if (/anticipat|pre.?arrest|apprehend/.test(t)) return 'Anticipatory Bail Application';
  if (/bail|arrest|custody|remand/.test(t)) return 'Bail Application';
  if (/cheque|138|dishonou?r|bounce/.test(t)) return 'Notice u/s 138 NI Act';
  if (/written statement|defendant.*repl/.test(t)) return 'Written Statement';
  if (/plaint|civil suit|recovery of/.test(t)) return 'Plaint';
  if (/affidavit|solemnly affirm/.test(t)) return 'Affidavit';
  if (/appeal|challenge.*order|impugned/.test(t)) return 'Appeal';
  if (/notice/.test(t)) return 'Legal Notice';
  if (/complaint/.test(t)) return 'Complaint';
  return 'Bail Application';
}
