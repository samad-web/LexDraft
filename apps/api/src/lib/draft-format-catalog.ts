// Draft format catalog — the structural knowledge the drafting agent uses to
// pick the correct format for a document type and to verify a draft against the
// conventions it must follow.
//
// A "format" describes what a court-ready document of a given type MUST contain:
//   - the ordered sections (parties block, prayer, verification, ...)
//   - the statutory ingredients that have to be pleaded (the "limbs" of the
//     cause of action / relief)
//   - drafting conventions (numbering, verification/jurat rules, ...)
//
// Coverage strategy: the web app defines ~58 doc types, grouped into a handful
// of categories (Notice, Pleading, Deed, Agreement, Application, Affidavit,
// Correspondence). Hand-authoring 58 entries is unmaintainable, so the catalog
// keys off:
//   1. a small set of high-value SPECIFIC overrides (exact doc-type match), then
//   2. a per-CATEGORY format, then
//   3. a generic fallback.
// The agent resolves the most specific format available for a request.

export interface DraftFormat {
  /** Human label used in prompts and stage messages. */
  label: string;
  /** Ordered sections the finished document must contain, top to bottom. */
  requiredSections: string[];
  /** Statutory / substantive ingredients that must be affirmatively pleaded.
   *  Empty for pure transactional documents that have no cause of action. */
  statutoryIngredients: string[];
  /** Drafting conventions specific to this format (numbering, verification,
   *  attestation, stamp/registration notes). */
  conventions: string[];
}

/**
 * Category buckets. These mirror the `category` field the web schemas already
 * carry (see doc-schemas.ts) plus a couple of derived buckets so every doc type
 * resolves to something. The agent never needs the web schema at runtime — it
 * infers the category from the doc-type name via `categoryForDocType`.
 */
export type FormatCategory =
  | 'notice'
  | 'pleading'
  | 'application'
  | 'affidavit'
  | 'deed'
  | 'agreement'
  | 'correspondence'
  | 'generic';

const CATEGORY_FORMATS: Record<FormatCategory, DraftFormat> = {
  notice: {
    label: 'Statutory / legal notice',
    requiredSections: [
      'Advocate / sender letterhead line and reference number',
      'Date and mode of service (Regd. Post AD / email / courier)',
      'Recipient name and address (addressee block)',
      'Subject line naming the notice and the governing provision',
      'Numbered recital of facts giving rise to the claim',
      'The demand / call to action with the statutory period to comply',
      'Consequence of non-compliance (the legal action that will follow)',
      'Signature block: "Advocate for the Noticee" / sender',
    ],
    statutoryIngredients: [
      'The exact statutory provision under which the notice is issued',
      'The obligation breached and the facts constituting the breach',
      'The precise relief/amount demanded and the period to comply',
    ],
    conventions: [
      'Number the factual paragraphs.',
      'State the statutory compliance period explicitly (e.g. 15 days u/s 138 NI Act).',
      'Do not include a verification or prayer — a notice is not a pleading.',
    ],
  },
  pleading: {
    label: 'Court pleading',
    requiredSections: [
      'Cause title: court, case number placeholder, and parties array',
      'Description of parties (name, age, occupation, address)',
      'Jurisdiction clause with the enabling provision',
      'Numbered paragraphs of facts (chronological)',
      'Cause of action and the date it arose',
      'Statement of court-fee / valuation where applicable',
      'Prayer clause enumerating each relief sought',
      'Verification clause with place, date, and para references',
      'Signature block for party and advocate',
    ],
    statutoryIngredients: [
      'The provision of law conferring jurisdiction on the court',
      'Every ingredient of the cause of action, pleaded as a numbered fact',
      'The limitation position (that the claim is within time)',
      'Court-fee / valuation basis where the relief is money or property',
    ],
    conventions: [
      'Number every factual paragraph consecutively.',
      'The prayer must list each relief as a separate lettered sub-clause.',
      'Close with a verification clause: "Verified at <place> on <date> that the contents of paras 1 to N are true to my knowledge..."',
    ],
  },
  application: {
    label: 'Interlocutory application / petition',
    requiredSections: [
      'Cause title referencing the main case number',
      'Title of the application and the enabling provision',
      'Numbered grounds in support',
      'Statement of urgency / balance of convenience where relief is interim',
      'Prayer for the specific interim relief',
      'Verification / supporting-affidavit reference',
      'Signature block for applicant and advocate',
    ],
    statutoryIngredients: [
      'The provision (CPC order/rule, CrPC/BNSS section, or Act) enabling the application',
      'The grounds that satisfy the test for the relief sought',
      'For interim relief: prima facie case, balance of convenience, irreparable injury',
    ],
    conventions: [
      'Number the grounds.',
      'Tie the application to the main matter by case number.',
      'Note that the application is supported by a separate affidavit where the court requires one.',
    ],
  },
  affidavit: {
    label: 'Affidavit',
    requiredSections: [
      'Cause title (where filed in a proceeding)',
      'Deponent identification: "I, <name>, aged <age>, <occupation>, resident of <address>, do solemnly affirm and state as follows"',
      'Numbered paragraphs of averments, each in the first person',
      'Statement distinguishing matters of personal knowledge from information/belief',
      'Verification / jurat: place, date, and para references',
      'Deponent signature line and attestation space for the oath commissioner / notary',
    ],
    statutoryIngredients: [
      'The capacity in which the deponent swears',
      'A clear source-of-knowledge statement for each averment',
    ],
    conventions: [
      'Write every averment in the first person, numbered.',
      'End with a jurat: "Verified at <place> on <date> that the contents of paras 1 to N are true...".',
      'Leave an attestation block for the notary / oath commissioner.',
    ],
  },
  deed: {
    label: 'Deed / instrument',
    requiredSections: [
      'Title of the deed and the date and place of execution',
      'Parties block with full description (executant / claimant and their capacity)',
      'Recitals ("WHEREAS ...") establishing title / background',
      'Operative part ("NOW THIS DEED WITNESSETH ...") with numbered covenants',
      'Consideration and its acknowledgement (where applicable)',
      'Schedule of property / assets (where applicable)',
      'Testimonium and execution block',
      'Attestation by witnesses',
    ],
    statutoryIngredients: [
      'A clear operative granting/transferring clause using words of conveyance',
      'The consideration and its receipt, where the deed is for value',
      'Identification of the subject matter with a schedule where property is involved',
    ],
    conventions: [
      'Use recital ("WHEREAS") and operative ("NOW THIS DEED WITNESSETH") formulae.',
      'Number the operative covenants.',
      'Add a note on stamp duty and registration requirements applicable to the instrument.',
      'Provide an attestation block for at least two witnesses where the law requires attestation.',
    ],
  },
  agreement: {
    label: 'Commercial agreement',
    requiredSections: [
      'Title and the date and place of the agreement',
      'Parties block with full legal names, capacity, and defined short names',
      'Recitals / background ("WHEREAS")',
      'Definitions and interpretation (where the agreement is complex)',
      'Numbered operative clauses (obligations, consideration, term)',
      'Representations and warranties',
      'Boilerplate: term & termination, indemnity, confidentiality, governing law, dispute resolution, notices',
      'Execution block and signature lines for each party',
    ],
    statutoryIngredients: [
      'Lawful consideration and the object of the agreement',
      'Free consent and capacity of the parties (Indian Contract Act, 1872 essentials)',
      'A governing-law and dispute-resolution clause',
    ],
    conventions: [
      'Define capitalised terms on first use or in a definitions clause.',
      'Number clauses and sub-clauses hierarchically (1, 1.1, 1.1.1).',
      'Always include governing law and dispute resolution.',
      'Close with an execution block and signature lines for each party.',
    ],
  },
  correspondence: {
    label: 'Professional correspondence',
    requiredSections: [
      'Date and reference line',
      'Recipient block',
      'Subject line',
      'Salutation',
      'Body paragraphs stating the purpose and any request',
      'Closing and signature block',
    ],
    statutoryIngredients: [],
    conventions: [
      'Keep the register formal and professional.',
      'State the purpose in the opening paragraph.',
    ],
  },
  generic: {
    label: 'Legal document',
    requiredSections: [
      'Title of the document',
      'Parties / addressee block where relevant',
      'Numbered body setting out the substance',
      'Closing / prayer / execution block appropriate to the document',
      'Signature block',
    ],
    statutoryIngredients: [
      'Any statute or provision that governs the document, cited correctly',
    ],
    conventions: [
      'Follow standard Indian drafting conventions for this document.',
      'Number substantive paragraphs where it aids clarity.',
    ],
  },
};

/**
 * Specific overrides keyed by the EXACT doc-type name used in the web schemas.
 * These carry format detail a category-level entry can't — e.g. the three
 * statutory limbs of a §138 notice, or the twin conditions for bail.
 */
const SPECIFIC_FORMATS: Record<string, DraftFormat> = {
  'Notice u/s 138 NI Act': {
    label: 'Demand notice under Section 138 of the Negotiable Instruments Act, 1881',
    requiredSections: [
      'Advocate reference line and date',
      'Addressee block (the drawer of the cheque)',
      'Subject: statutory demand notice u/s 138 NI Act',
      'Recital of the underlying legally enforceable debt or liability',
      'Particulars of the cheque (number, date, amount, drawee bank)',
      'Presentation of the cheque and its dishonour with the return-memo reason and date',
      'The statutory demand to pay the cheque amount within 15 days of receipt',
      'Consequence: prosecution u/s 138 NI Act on failure to pay',
      'Advocate signature block',
    ],
    statutoryIngredients: [
      'A legally enforceable debt or other liability the cheque discharged',
      'Drawing of the cheque on an account maintained by the drawer',
      'Return of the cheque unpaid for insufficiency of funds / the stated reason',
      'Presentation of the cheque within its validity period',
      'A written demand for the cheque amount made within 30 days of the drawer receiving intimation of dishonour',
      'The mandatory 15-day period given to the drawer to make payment',
    ],
    conventions: [
      'State the exact cheque number, amount, date, and drawee bank.',
      'State the return-memo reason and the date of the return memo verbatim.',
      'Demand payment within 15 days of receipt of the notice — this period is mandatory.',
      'Do not add a verification or prayer; this is a notice, not a pleading.',
    ],
  },
  'Bail Application': {
    label: 'Application for bail',
    requiredSections: [
      'Cause title: court, bail application number placeholder, State vs. accused',
      'FIR / crime number, police station, and the sections invoked',
      'Brief facts of the prosecution case',
      'Numbered grounds for grant of bail',
      'Undertaking of the accused (cooperation, availability, non-tampering)',
      'Prayer for release on bail',
      'Supporting affidavit reference and signature block',
    ],
    statutoryIngredients: [
      'The enabling provision — forum-dependent: commonly Section 483 BNSS, 2023 before the Court of Session/High Court, or Section 480 BNSS, 2023 before a Magistrate (counsel to confirm the applicable section and forum against the bare Act)',
      'Custody particulars: date of arrest, the period already spent in custody, and the investigation/charge-sheet status (charge-sheet filed or investigation pending)',
      'Grounds negating flight risk, tampering with evidence, and influencing witnesses',
      'The gravity of the offence weighed against the triple test for bail',
      'Whether this is the first or a successive bail application (and, if successive, the change in circumstances)',
    ],
    conventions: [
      'Number the grounds for bail.',
      'Determine the enabling BNSS provision from the forum (Sessions/HC vs Magistrate) rather than asserting a single fixed section; map any legacy CrPC section the brief supplies, and flag the section for counsel confirmation rather than presenting it as self-certified.',
      'Include an undertaking that the accused will not abscond or tamper with evidence.',
      'State whether this is the first or a successive bail application.',
    ],
  },

  'Anticipatory Bail Application': {
    label: 'Application for anticipatory (pre-arrest) bail',
    requiredSections: [
      'Cause title: court, application number placeholder, State vs. applicant',
      'FIR / crime number, police station, and the sections invoked (if registered)',
      'The applicant’s apprehension of arrest and its basis',
      'Brief facts and the applicant’s version',
      'Numbered grounds for anticipatory bail',
      'Undertaking to cooperate with the investigation',
      'Prayer for pre-arrest bail / directions u/s 482 BNSS',
      'Supporting affidavit reference and signature block',
    ],
    statutoryIngredients: [
      'The enabling provision — commonly Section 482 BNSS, 2023 for anticipatory bail (corresponding to the former Section 438 CrPC); counsel to confirm the applicable section and forum against the bare Act',
      'A reasonable apprehension of arrest for a non-bailable offence',
      'Grounds negating the need for custodial interrogation and showing cooperation',
      'The triple test (flight risk, tampering, influencing witnesses) addressed',
    ],
    conventions: [
      'State the enabling provision (commonly Section 482 BNSS, 2023; map any legacy CrPC 438 the brief supplies) and flag it for counsel confirmation rather than presenting it as self-certified.',
      'Establish the apprehension of arrest before the grounds.',
      'Number the grounds; include an undertaking to join and cooperate with the investigation.',
    ],
  },

  // Keyed to the EXACT docType the web sends (doc-schemas.ts) so resolveFormat's
  // exact-match lookup hits this grounded entry instead of falling back to the
  // generic 'application' format. The label still carries the old CrPC 317 for
  // familiarity; the grounding below drives counsel to the current BNSS 355.
  'Exemption from Personal Appearance (Section 317 CrPC)': {
    label: 'Application for exemption from personal appearance (Section 317 CrPC → BNSS 355)',
    requiredSections: [
      'Cause title: court, case/crime number placeholder, State vs. accused/applicant',
      'Description of the applicant-accused and the advocate representing them',
      'The hearing date(s) for which exemption from personal attendance is sought',
      'Numbered grounds for exemption (e.g. illness, distance, hardship, presence not necessary in the interests of justice)',
      'Averment that the accused is represented by an advocate and will not dispute identity',
      'Undertaking to appear whenever the court directs personal attendance',
      'Prayer to dispense with personal attendance under Section 355 BNSS for the stated date(s)',
      'Supporting affidavit reference and signature block',
    ],
    statutoryIngredients: [
      'The enabling provision — Section 355 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (corresponding to the former Section 317 CrPC); counsel to confirm against the bare Act',
      'That the accused is represented by an advocate (a precondition BNSS 355 requires for the court to dispense with attendance)',
      'Reasons why personal attendance is not necessary in the interests of justice, or the specific hardship relied on',
      'An undertaking to appear on any date the court subsequently directs personal presence',
    ],
    conventions: [
      'Cite Section 355 BNSS, 2023 as the enabling provision; if the brief supplies the legacy CrPC 317, map it and flag the section for counsel confirmation rather than presenting it as self-certified.',
      'State expressly that the accused is represented by an advocate — the exemption is unavailable otherwise.',
      'Number the grounds for exemption.',
      'Include an undertaking that the applicant will appear whenever the court directs, and that identity is not disputed.',
      'Confine the prayer to the specific hearing date(s); do not seek a blanket, open-ended exemption.',
    ],
  },

  Plaint: {
    label: 'Plaint in a civil suit (Order VII CPC)',
    requiredSections: [
      'Cause title: name of the court and the suit number placeholder',
      'Description of the parties (name, age, occupation, address) — plaintiff and defendant',
      'Statement that the plaint is filed under the relevant provision, with jurisdiction pleaded',
      'Numbered paragraphs of facts constituting the cause of action, in chronological order',
      'The date on which the cause of action arose',
      'Averment on jurisdiction (pecuniary and territorial) and limitation',
      'Statement of the value of the subject matter for jurisdiction and court fees',
      'Prayer clause enumerating each relief sought as separate sub-clauses',
      'Verification clause with place, date, and paragraph references, and signatures',
    ],
    statutoryIngredients: [
      'The provision conferring jurisdiction and the facts showing the court has it',
      'Every ingredient of the cause of action, pleaded as a numbered fact',
      'That the suit is within limitation',
      'The valuation basis for court-fee and jurisdiction (Order VII Rule 1 CPC)',
    ],
    conventions: [
      'Number every factual paragraph consecutively.',
      'The prayer must list each relief as a separate lettered/numbered sub-clause.',
      'Close with a verification: “Verified at <place> on <date> that the contents of paras 1 to N are true to my knowledge and belief.”',
      'Plead jurisdiction, valuation, and limitation expressly.',
    ],
  },

  'Written Statement': {
    label: 'Written statement in defence (Order VIII CPC)',
    requiredSections: [
      'Cause title referencing the suit number and the parties',
      'Preliminary objections (maintainability, limitation, jurisdiction, non-joinder)',
      'Paragraph-wise reply to the plaint (admit / deny / not admitted), following the plaint’s numbering',
      'Additional pleas and the defendant’s own version of facts',
      'Set-off or counter-claim where applicable',
      'Prayer for dismissal of the suit',
      'Verification clause with place, date, and paragraph references, and signatures',
    ],
    statutoryIngredients: [
      'A specific response to every material averment of the plaint (Order VIII Rules 3–5 — evasive denial is deemed admission)',
      'Any preliminary/legal objection that defeats the suit (limitation, jurisdiction, maintainability)',
      'The factual basis for any set-off or counter-claim',
    ],
    conventions: [
      'Reply paragraph-by-paragraph, mirroring the plaint’s paragraph numbers.',
      'Deny specifically — a vague or evasive denial is treated as an admission.',
      'Raise all preliminary objections at the outset.',
      'Close with a verification clause and signatures.',
    ],
  },

  // ---- Commercial long-tail: per-type detail so REVIEW audits ingredients ----
  // These share the AGREEMENT/DEED block STRUCTURE (set in draft-triage), but a
  // category-level format cannot tell whether the type-specific operative clauses
  // were pleaded. Each entry below gives the ingredients + conventions the review
  // stage checks — e.g. a loan without a default clause, an NDA without a term.

  'Loan Agreement': {
    label: 'Loan agreement',
    requiredSections: [
      'Title, date and place, and the parties block (Lender and Borrower, defined short names)',
      'Recitals (WHEREAS) establishing the lending arrangement',
      'The principal amount and the mode/date of disbursement',
      'Interest: rate, basis (simple/compound), and rests',
      'Repayment schedule — tenure, instalments, and due dates',
      'Security / collateral clause (or an express statement that the loan is unsecured)',
      'Events of default and the consequences (acceleration, enforcement)',
      'Boilerplate: governing law, dispute resolution, notices',
      'Execution block and signatures of both parties',
    ],
    statutoryIngredients: [
      'Lawful consideration and capacity (Indian Contract Act, 1872 essentials)',
      'A certain principal sum and the interest rate (or that the loan is interest-free)',
      'A defined repayment obligation — tenure and instalments',
      'Events of default and the lender’s remedy on default',
    ],
    conventions: [
      'State the principal figure in both numerals and words.',
      'Do NOT leave interest, tenure, or the default clause unstated — these are the operative heart of the loan.',
      'Number clauses hierarchically and close with governing law + dispute resolution.',
    ],
  },

  'Lease / Rent / Tenancy Agreement': {
    label: 'Lease / rent / tenancy agreement',
    requiredSections: [
      'Title, date and place, and the parties block (Lessor and Lessee)',
      'Description of the demised premises (with a schedule where apt)',
      'Term of the lease and the commencement date',
      'Rent amount, due date, mode of payment, and escalation',
      'Security deposit — amount and refund conditions',
      'Permitted use of the premises',
      'Maintenance, repair, and outgoings responsibility (lessor vs lessee)',
      'Termination, lock-in, and notice period; renewal',
      'Execution block and signatures (and witnesses / registration note where required)',
    ],
    statutoryIngredients: [
      'Identification of the demised premises',
      'A certain term and a certain rent',
      'The security deposit and its refund terms',
      'Termination and notice provisions',
    ],
    conventions: [
      'State the term, rent, deposit, and notice period explicitly — an omitted term or notice clause is the commonest lease defect.',
      'Note stamp duty and (for leases over the statutory period) compulsory registration.',
      'Close with an execution block and, where required, witness/registration provisions.',
    ],
  },

  'Employment Contract': {
    label: 'Employment contract',
    requiredSections: [
      'Title, date, and the parties block (Employer and Employee)',
      'Position, reporting, and a statement of duties',
      'Date of commencement and the nature/term of employment (permanent/fixed-term/probation)',
      'Remuneration: salary, allowances, and payment cycle',
      'Working hours, leave, and benefits',
      'Confidentiality and intellectual-property assignment',
      'Notice period and grounds/procedure for termination',
      'Post-employment restraints (non-solicit / non-compete, to the extent enforceable)',
      'Governing law and dispute resolution; execution block',
    ],
    statutoryIngredients: [
      'Lawful consideration and capacity (Indian Contract Act, 1872)',
      'Defined role, remuneration, and term',
      'A notice/termination provision',
      'Confidentiality and IP assignment where the role warrants it',
    ],
    conventions: [
      'State remuneration, notice period, and termination grounds explicitly.',
      'A post-employment non-compete must be reasonable in scope/time — an unqualified restraint of trade is void under Section 27 of the Indian Contract Act.',
      'Number clauses and close with governing law + dispute resolution.',
    ],
  },

  'Non-Disclosure Agreement (NDA)': {
    label: 'Non-disclosure agreement',
    requiredSections: [
      'Title, date, and the parties block (Disclosing and Receiving Party, or mutual)',
      'Recital of the purpose for which information is shared',
      'Definition of Confidential Information (and express exclusions)',
      'The confidentiality obligation and permitted use',
      'Permitted disclosures (e.g. to advisers, or under law)',
      'Term of confidentiality and the survival period',
      'Return or destruction of information on termination',
      'Remedies (including injunctive relief) and governing law; execution block',
    ],
    statutoryIngredients: [
      'A clear definition of what constitutes Confidential Information, with exclusions',
      'The obligation of confidence and the permitted purpose/use',
      'A defined term / survival period for the obligation',
      'Return-or-destruction of information on termination',
    ],
    conventions: [
      'Do NOT leave the definition of Confidential Information, the term, or the return clause unstated — these are the operative heart of an NDA.',
      'State whether the NDA is one-way or mutual.',
      'Include a remedies clause (confidentiality breaches often warrant injunctive relief).',
    ],
  },

  'Sale Agreement / Sale Deed': {
    label: 'Sale deed / agreement to sell (immovable property)',
    requiredSections: [
      'Title of the deed, date and place of execution',
      'Parties block: Vendor and Vendee with full descriptions and capacity',
      'Recitals (WHEREAS) establishing the Vendor’s title',
      'The operative conveyance — words of transfer of the property',
      'Consideration and acknowledgement of its receipt',
      'Schedule of the property with boundaries and identification',
      'Covenants for title, delivery of possession, and indemnity',
      'Testimonium, execution, and attestation by witnesses',
      'Stamp duty and registration particulars',
    ],
    statutoryIngredients: [
      'An operative granting/transferring clause with clear words of conveyance',
      'The consideration and acknowledgement of its receipt',
      'Identification of the property in a schedule with boundaries',
      'A covenant of title by the Vendor',
    ],
    conventions: [
      'Use "NOW THIS DEED WITNESSETH" and clear words of conveyance.',
      'A sale deed of immovable property (value ≥ the statutory threshold) is compulsorily registrable — add the stamp-duty and registration note.',
      'Provide the property schedule with boundaries and an attestation block for witnesses.',
    ],
  },

  'Mortgage Deed': {
    label: 'Mortgage deed (immovable property as security)',
    requiredSections: [
      'Title, date and place, and the parties block (Mortgagor and Mortgagee)',
      'Recital of the debt or obligation secured and its amount',
      'The type of mortgage created (e.g. simple, English, by conditional sale)',
      'The operative charge/transfer of interest over the mortgaged property',
      'Schedule of the mortgaged property with boundaries',
      'Repayment terms and the redemption/foreclosure clause',
      'Covenants (to insure, to pay taxes, not to further encumber)',
      'Testimonium, execution, and attestation',
      'Stamp duty and registration note',
    ],
    statutoryIngredients: [
      'The debt or obligation secured, stated with certainty',
      'An operative clause creating the mortgage over identified property',
      'The type of mortgage and the mortgagee’s remedy (sale/foreclosure)',
      'The mortgagor’s right of redemption',
    ],
    conventions: [
      'State the secured debt and the type of mortgage expressly (the remedies differ by type).',
      'Preserve the mortgagor’s equity of redemption; a clause that clogs it is unenforceable.',
      'Identify the property in a schedule; note stamp duty and compulsory registration.',
    ],
  },

  'Gift Deed': {
    label: 'Gift deed (transfer without consideration)',
    requiredSections: [
      'Title, date and place, and the parties block (Donor and Donee)',
      'Recital of the Donor’s title and the natural love/affection or motive',
      'The operative clause of gift — voluntary transfer WITHOUT consideration',
      'Acceptance of the gift by the Donee during the Donor’s lifetime',
      'Schedule of the gifted property with boundaries',
      'Delivery of possession',
      'Testimonium, execution, and attestation by two witnesses',
      'Stamp duty and registration note',
    ],
    statutoryIngredients: [
      'A voluntary transfer made WITHOUT consideration (the defining feature of a gift)',
      'Acceptance by the donee during the lifetime of the donor',
      'Identification of the gifted property in a schedule',
    ],
    conventions: [
      'State expressly that the transfer is without consideration and out of natural love and affection (or the stated motive).',
      'Record the donee’s acceptance during the donor’s lifetime — a gift not accepted in the donor’s lifetime is void.',
      'A gift of immovable property must be by a registered instrument attested by two witnesses; add the stamp-duty and registration note.',
    ],
  },

  // ---- Instruments & applications previously falling to the generic format ----

  Will: {
    label: 'Will (testamentary disposition)',
    requiredSections: [
      'Testator declaration — name, age, occupation, address, and a statement of sound mind made free of coercion',
      'Revocation of all earlier wills and codicils',
      'Appointment of the executor(s) — as a distinct clause, not buried in the bequests',
      'Bequests in numbered clauses — each asset and the beneficiary',
      'Residuary clause disposing of anything not specifically bequeathed',
      'Testator’s signature',
      'Attestation clause with TWO witnesses signing in the presence of the testator and of each other',
    ],
    statutoryIngredients: [
      'A clear testamentary intention and a declaration of sound mind, free of coercion',
      'Appointment of an executor',
      'Attestation by two witnesses (an essential of a valid will)',
    ],
    conventions: [
      'Appoint the executor as its own clause.',
      'The will must be signed by the testator and attested by two witnesses who sign in the testator’s presence — this is the validity essential; do not omit it.',
      'Do not invent beneficiaries or assets — use bracketed placeholders for particulars absent from the brief.',
    ],
  },

  'Power of Attorney (General)': {
    label: 'General power of attorney',
    requiredSections: [
      'Appointment clause: "KNOW ALL MEN BY THESE PRESENTS that I, [Principal] … appoint [Attorney]"',
      'The reason/occasion for the appointment',
      'The broad powers granted, in numbered clauses',
      'A ratification clause confirming acts done by the Attorney',
      'Revocation / duration / termination clause',
      'Testimonium, execution, attestation by two witnesses, and a notarisation/registration note',
    ],
    statutoryIngredients: [
      'A clear grant of authority from the principal to the attorney',
      'The scope of the powers granted',
      'A ratification clause',
    ],
    conventions: [
      'A General PoA grants broad authority — enumerate the powers even so.',
      'State the duration and how the PoA may be revoked; do not leave termination unaddressed.',
      'A PoA authorising dealings with immovable property generally requires registration — add the note.',
    ],
  },

  'Power of Attorney (Specific)': {
    label: 'Specific power of attorney',
    requiredSections: [
      'Appointment clause naming the Principal and Attorney',
      'The specific, limited purpose/occasion of the appointment',
      'The specific power(s) granted — enumerated and confined to the defined act',
      'A ratification clause',
      'Revocation / duration clause',
      'Testimonium, execution, attestation by two witnesses, and a notarisation/registration note',
    ],
    statutoryIngredients: [
      'A grant of authority confined to a defined, specific act',
      'The exact scope of the specific power',
      'A ratification clause',
    ],
    conventions: [
      'A Specific PoA must enumerate the exact act(s) authorised and go no wider — do not draft it as a general authority.',
      'State duration/revocation.',
      'Note registration where the act concerns immovable property.',
    ],
  },

  'Indemnity Bond': {
    label: 'Indemnity bond',
    requiredSections: [
      'Obligation clause: "KNOW ALL MEN … I/We, [Obligor], am/are held and firmly bound to [Obligee] in the sum of [penal sum]"',
      'Recital of the transaction/liability the bond secures',
      'The condition of the bond (the indemnity — if the obligor makes good the loss, the bond is void)',
      'The indemnity terms in numbered clauses',
      'Execution, date and place, and attestation by witnesses',
    ],
    statutoryIngredients: [
      'The penal sum for which the obligor is bound',
      'The obligation/loss indemnified against',
      'The condition that discharges the bond',
    ],
    conventions: [
      'State the penal sum explicitly — a bond without its penal sum is incomplete.',
      'An indemnity promises to make good a loss; state the precise event that discharges the bond.',
      'Close with execution, date, place, and witness attestation — do not reuse an agreement-style execution block.',
    ],
  },

  'Guarantee Bond': {
    label: 'Guarantee bond',
    requiredSections: [
      'Obligation clause binding the surety to the obligee in the penal sum',
      'Recital of the principal debt/performance guaranteed and the principal debtor',
      'The condition of the bond (guarantee of the principal’s performance/payment)',
      'The guarantee terms — extent and duration of the surety’s liability',
      'Execution, date and place, and attestation by witnesses',
    ],
    statutoryIngredients: [
      'The penal sum and the principal obligation guaranteed',
      'The identity of the principal debtor and the creditor/obligee',
      'The extent and duration of the surety’s liability',
    ],
    conventions: [
      'State the penal sum and the principal obligation guaranteed.',
      'A guarantee answers for another’s default — identify the principal debtor and the extent of the surety’s liability.',
      'Close with execution, date, place, and witness attestation.',
    ],
  },

  'RTI Application': {
    label: 'Application under the Right to Information Act, 2005',
    requiredSections: [
      'Addressee: "To, The Public Information Officer, [office and address]"',
      'Subject line naming it an application under the Right to Information Act, 2005',
      'Applicant’s name and address',
      'The information sought, in numbered, specific, answerable points',
      'A note on the prescribed application fee (and BPL exemption if claimed)',
      'Declaration that the information is sought for the applicant’s own use, signature, and date',
    ],
    statutoryIngredients: [
      'A clear description of the information sought, point by point',
      'The applicant’s identity and address for the reply',
      'The prescribed fee / exemption note',
    ],
    conventions: [
      'This is an APPLICATION/letter, not a pleading — no cause title, no verification, no prayer.',
      'Keep each point of information specific and answerable.',
      'Do not invent the office/PIO details — use bracketed placeholders where absent.',
    ],
  },

  'Written Arguments': {
    label: 'Written arguments / written submissions',
    requiredSections: [
      'Cause title referencing the court, case/appeal number, and the parties AS ALREADY ON RECORD (not a fresh party memo)',
      'A one-line note of the stage (e.g. post-evidence / after conclusion of hearing)',
      'The points/issues for determination, itemised and numbered',
      'Issue-wise submissions: for each point, the facts and evidence on record relied on, and the legal submission with authorities',
      'A concluding summary of the relief pressed',
    ],
    statutoryIngredients: [
      'Each point for determination that arises on the pleadings/issues',
      'The evidence on record relied on for each submission',
      'The legal authority supporting each submission',
    ],
    conventions: [
      'Do not draft a fresh party memo — the parties are already on record; use the existing cause title.',
      'Argue issue-wise, anchoring every submission to a point for determination and the evidence on record.',
      'Argue for the party, not neutrally.',
    ],
  },

  Vakalatnama: {
    label: 'Vakalatnama (appointment of advocate)',
    requiredSections: [
      'Cause title — court, case-number placeholder, and parties',
      'The executant/client’s appointment of the advocate to appear, act and plead',
      'The standard authorities (to file/receive documents, compromise with consent, receive money, engage other counsel)',
      'The advocate’s acceptance endorsement, including the Bar Council enrolment / Sanad No. line',
      'Date and place of execution, and signatures of the client and the advocate',
    ],
    statutoryIngredients: [
      'The client’s grant of authority to the named advocate',
      'The advocate’s acceptance with the Bar Council enrolment number',
      'The date and place of execution',
    ],
    conventions: [
      'Include the advocate’s acceptance endorsement with the enrolment/Sanad number — do not omit it.',
      'State the date and place of execution.',
      'Draw court, case number, party names, and the advocate’s enrolment ONLY from the brief; use bracketed placeholders for any absent particular — never invent them.',
    ],
  },

  'Partition Deed': {
    label: 'Partition deed',
    requiredSections: [
      'Title, date and place, and the parties block (the co-sharers, with capacity and shares)',
      'Recitals establishing the joint ownership and the source of title',
      'The operative partition — the metes-and-bounds allotment to each sharer',
      'Schedule(s) describing each allotted portion with boundaries',
      'Mutual covenants (each sharer holds their allotment absolutely; owelty where shares are unequal)',
      'Testimonium, execution, attestation, and the stamp-duty/registration note',
    ],
    statutoryIngredients: [
      'Identification of the joint property and the co-sharers’ existing shares',
      'A definite allotment of a specific portion to each sharer (metes and bounds)',
      'Mutual release of claims over the portions allotted to the others',
    ],
    conventions: [
      'Allot each sharer a defined portion by metes and bounds, described in a schedule with boundaries.',
      'Include the mutual release of claims and any owelty for unequal shares.',
      'A partition deed of immovable property is compulsorily registrable — add the stamp-duty/registration note.',
    ],
  },

  'Relinquishment Deed': {
    label: 'Relinquishment deed',
    requiredSections: [
      'Title, date and place, and the parties block (Releasor and Releasee(s))',
      'Recital of the releasor’s existing co-ownership share and the source of title',
      'The operative relinquishment — the releasor’s voluntary release of their undivided share in favour of the other co-owner(s)',
      'Whether the release is with or without consideration',
      'Schedule of the property',
      'Testimonium, execution, attestation, and the stamp-duty/registration note',
    ],
    statutoryIngredients: [
      'The releasor’s existing undivided share in the co-owned property',
      'A voluntary release of that share in favour of the other co-owner(s)',
      'Whether the relinquishment is for consideration or gratuitous',
    ],
    conventions: [
      'A relinquishment operates only between co-owners and only over an undivided share — state both.',
      'State whether it is with or without consideration.',
      'Compulsorily registrable for immovable property — add the note.',
    ],
  },

  'Trust Deed': {
    label: 'Trust deed',
    requiredSections: [
      'Title, date and place, and the parties block (Settlor/Author and Trustees)',
      'Recital of the settlor’s intention to create the trust',
      'Declaration of trust and transfer of the trust property to the trustees',
      'The objects/purposes of the trust',
      'Identification of the beneficiaries (or the charitable object)',
      'Powers, duties, and management provisions for the trustees',
      'Schedule of the trust property; execution, attestation, and registration note',
    ],
    statutoryIngredients: [
      'A clear intention to create a trust (the certainty of intention)',
      'Identified trust property (certainty of subject matter)',
      'Identified beneficiaries or a valid charitable object (certainty of objects)',
    ],
    conventions: [
      'Satisfy the three certainties — intention, subject matter, and objects.',
      'Identify the trustees, the beneficiaries/objects, and the trust property in a schedule.',
      'Note registration where the trust concerns immovable property.',
    ],
  },

  'Adoption Deed': {
    label: 'Adoption deed',
    requiredSections: [
      'Title, date and place, and the parties block (adoptive parent(s) and the natural parent(s)/guardian giving in adoption)',
      'Recital of the capacity to adopt and to give in adoption',
      'The operative giving-and-taking of the child in adoption',
      'Statement that the ceremony/requirements of a valid adoption were observed',
      'Execution, attestation, and registration note',
    ],
    statutoryIngredients: [
      'The capacity of the person adopting and of the person giving in adoption',
      'The actual giving and taking of the child in adoption',
      'Compliance with the conditions for a valid adoption',
    ],
    conventions: [
      'Record the giving and taking in adoption and that the conditions for a valid adoption were satisfied.',
      'Do NOT assert the governing statutory conditions as settled where the brief does not establish them — flag for the advocate to confirm the applicable law and that its conditions are met.',
      'Note registration where applicable.',
    ],
  },

  'Hypothecation Deed': {
    label: 'Hypothecation deed (movable assets as security)',
    requiredSections: [
      'Title, date and place, and the parties block (Hypothecator and the secured party/lender)',
      'Recital of the debt/facility secured and its amount',
      'The operative clause creating the charge over the identified movable assets (without transfer of possession)',
      'Schedule/description of the hypothecated movables',
      'The lender’s rights on default (to take possession and sell)',
      'Covenants (to insure, to maintain, not to further encumber); execution and attestation',
    ],
    statutoryIngredients: [
      'The debt or facility secured, stated with certainty',
      'A charge created over identified movable property without transfer of possession',
      'The secured party’s remedy on default',
    ],
    conventions: [
      'Hypothecation is a charge on movables WITHOUT transfer of possession — state this expressly (contrast with a pledge).',
      'Identify the hypothecated assets in a schedule.',
      'State the events of default and the lender’s enforcement rights.',
    ],
  },
};

/** Normalise a doc-type name into a coarse category using keyword heuristics on
 *  the name. This lets every one of the ~58 web doc types resolve to a format
 *  without the catalog having to enumerate them all. */
export function categoryForDocType(docType: string): FormatCategory {
  const t = docType.toLowerCase();
  if (/notice/.test(t)) return 'notice';
  if (/affidavit/.test(t)) return 'affidavit';
  if (/\b(plaint|written statement|replication|rejoinder|appeal|petition|written arguments)\b/.test(t)) {
    return 'pleading';
  }
  if (/\b(application|caveat|execution|rti|stay|interim|ia\b)\b/.test(t)) return 'application';
  if (/\b(deed|will|power of attorney|bond)\b/.test(t)) return 'deed';
  if (/\b(agreement|contract|mou|memorandum|loi|letter of intent|nda|term sheet|settlement)\b/.test(t)) {
    return 'agreement';
  }
  if (/\b(correspondence|letter|engagement)\b/.test(t)) return 'correspondence';
  return 'generic';
}

/**
 * Resolve the most specific format for a doc type: an exact override if one
 * exists, otherwise the category format, otherwise the generic fallback.
 */
export function resolveFormat(docType: string): DraftFormat {
  const specific = SPECIFIC_FORMATS[docType];
  if (specific) return specific;
  const category = categoryForDocType(docType);
  return CATEGORY_FORMATS[category] ?? CATEGORY_FORMATS.generic;
}

/** Render a format as a compact instruction block for an LLM system prompt. */
export function renderFormatBlock(docType: string): string {
  const fmt = resolveFormat(docType);
  const sections = fmt.requiredSections.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  const limbs =
    fmt.statutoryIngredients.length > 0
      ? fmt.statutoryIngredients.map((s) => `  - ${s}`).join('\n')
      : '  (none — this document has no cause of action to plead)';
  const conventions = fmt.conventions.map((s) => `  - ${s}`).join('\n');
  return [
    `Document format: ${fmt.label}`,
    '',
    'Required structure (in order):',
    sections,
    '',
    'Statutory ingredients that MUST be established:',
    limbs,
    '',
    'Drafting conventions:',
    conventions,
  ].join('\n');
}

export const draftFormatCatalog = {
  resolveFormat,
  renderFormatBlock,
  categoryForDocType,
};
