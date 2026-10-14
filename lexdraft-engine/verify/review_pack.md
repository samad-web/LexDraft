# LexDraft — Advocate Review Pack

Everything in this pack is generated from the engine's code and registries (`verify/tables/`, `verify/averments/`, and the pipelines themselves), so it always reflects the current state. Review each section, correct what is wrong, and sign off by editing the JSON registries.

# Section A — VERIFY Reference Tables

Generated from `verify/tables/` — 13 tables (0 verified, 13 pending). Every document consuming an unverified table renders with the '[figures unverified — pending advocate review]' marker; verifying the table (set `verified: true` with your name and the date in the JSON) removes the marker with no code change.

| Table | Source (Act, section) | Verified |
|---|---|---|
| bail_bars — Statutory bail-bar provenance | NDPS Act; PMLA; UAPA; SC/ST (Prevention of Atrocities) Act, s.37 NDPS; s.45 PMLA; s.43D(5) UAPA; s.18 / 18A SC/ST Act | PENDING |
| code_appointed_day — The appointed day on which BNS / BNSS / BSA came into force | BNS s.358; BNSS s.531; General Clauses Act s.6, commencement notification (S.O. dated 24.02.2024, w.e.f. 01.07.2024) | PENDING |
| consumer_pecuniary_tiers — Consumer forum pecuniary tiers by CONSIDERATION paid (Rs) | Consumer Protection Act 2019, ss.34, 47, 58 (District / State / National Commission pecuniary jurisdiction) and current notifications | PENDING |
| court_fee_ad_valorem_slabs — Ad valorem court-fee slabs for money claims | Tamil Nadu Court Fees and Suits Valuation Act 1955, Schedule I (ad valorem fees) | PENDING |
| court_fee_fixed_fees — Fixed court fees by relief kind (Rs) | Tamil Nadu Court Fees and Suits Valuation Act 1955, Schedule II (fixed fees) | PENDING |
| custody_default_bail_periods — Statutory default-bail (police-custody) periods from first remand | CrPC s.167(2) / BNSS s.187; NDPS Act s.36A(4); UAPA s.43D(2); PMLA, Chaganti Satyanarayana v. State of AP (period runs from first remand) | PENDING |
| limitation_article_periods — Limitation Act Schedule — article number -> period in years | Limitation Act 1963, Schedule (Art. 19 money lent — 3 years; Art. 18; Art. 113 residuary — 3 years) | PENDING |
| mact_conventional_heads — Pranay Sethi conventional heads (Rs) for MACT death compensation, subject to periodic enhancement (by 10% every three years) | Motor Vehicles Act 1988, s.166, National Insurance Co. v. Pranay Sethi (2017) 16 SCC 680 | PENDING |
| mact_future_prospects — Pranay Sethi future-prospects addition by age band and employment kind | Motor Vehicles Act 1988, s.166, National Insurance Co. v. Pranay Sethi (2017) 16 SCC 680 | PENDING |
| mact_multiplier_bands — Sarla Verma age-to-multiplier bands for MACT death compensation | Motor Vehicles Act 1988, s.166, Sarla Verma v. DTC (2009) 6 SCC 121; affirmed National Insurance Co. v. Pranay Sethi (2017) 16 SCC 680 | PENDING |
| mact_personal_expense_deduction — Sarla Verma personal-and-living-expenses deduction fraction by number of dependants | Motor Vehicles Act 1988, s.166, Sarla Verma v. DTC (2009) 6 SCC 121 (2-3 deps -> 1/3; 4-6 -> 1/4; >6 -> 1/5) | PENDING |
| pecuniary_limits — Civil forum pecuniary ceilings (Rs) | Tamil Nadu Civil Courts Act / current TN pecuniary-jurisdiction notifications, pecuniary jurisdiction of the District Munsif / Subordinate Judge / District Court | PENDING |
| section_mappings — BNSS <-> CrPC section equivalences per document remedy | Bharatiya Nagarik Suraksha Sanhita 2023 / Code of Criminal Procedure 1973, s.187(3)/s.167(2) (default bail); s.482/s.438 (anticipatory); s.483/s.439 (regular); s.144/s.125 (maintenance) | PENDING |

# Section B — Mandatory Averments

Generated from `verify/averments/` — 17 documents, 98 averments (0 verified, 98 pending). For each averment, confirm it belongs, correct the text or source if needed, then mark it verified (set `verified: true` with your name and the date in the JSON).

## 2.1 — General demand notice

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | A positive, specific sum is demanded, stated in both figures and words (they must match). | mandatory | Local practice: demand notice practice | PENDING |
| 2 | The act required of the recipient and the compliance period are stated (rule-driven, not model-written). | mandatory | Local practice: demand and compliance period | PENDING |
| 3 | A specific consequence of non-compliance is stated (civil suit and/or criminal proceedings); a vague threat is insufficient. | mandatory | Local practice: specificity of consequence | PENDING |
| 4 | Where a statutory minimum compliance period applies, the period stated is not below it. | mandatory | Statute: applicable statutory minimum (e.g. s.80 CPC) | PENDING |
| 5 | Proof of dispatch is recorded on the notice (dispatch placeholder mandatory). | mandatory | Local practice: proof of service | PENDING |
| 6 | The notice is issued under the advocate's instructions from the client (authority averred). | advisory | Local practice: advocate under instructions | PENDING |

## 2.2 — Statutory notice under s.138 NI Act

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The cheque(s) were issued in discharge of a legally enforceable debt or liability. | mandatory | Statute: s.138 NI Act | PENDING |
| 2 | The dishonour reason is stated verbatim as it appears in the bank return memo. | mandatory | Statute: s.138 NI Act; proof of dishonour | PENDING |
| 3 | The date of receipt of the dishonour memo is pleaded (it is the limitation anchor, not the memo date). | mandatory | Statute: s.138 proviso (b); MSR Leathers v. Palaniappan | PENDING |
| 4 | The notice demands the cheque amount and states it in both figures and words. | mandatory | Statute: s.138 proviso (b) | PENDING |
| 5 | The drawer is allowed exactly 15 days to pay; the statutory period is neither shortened nor extended. | mandatory | Statute: s.138 proviso (c) | PENDING |
| 6 | Proof of dispatch is recorded on the notice (dispatch placeholder mandatory). | mandatory | Local practice: proof of service in s.138 prosecutions | PENDING |
| 7 | The notice is issued under the advocate's instructions from the client (authority averred). | advisory | Local practice: advocate under instructions | PENDING |

## 3.1 — Complaint under s.138 NI Act

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The complainant is the payee or the holder in due course of the cheque(s). | mandatory | Statute: s.142(a) NI Act | PENDING |
| 2 | A company complainant pleads the authorisation of the person representing it (authorised representative / board resolution). | mandatory | Case law: A.C. Narayanan v. State of Maharashtra | PENDING |
| 3 | Where the accused is a company, the persons sought to be made vicariously liable were in charge of and responsible for the conduct of the business at the relevant time. | mandatory | Statute: s.141 NI Act; S.M.S. Pharmaceuticals v. Neeta Bhalla | PENDING |
| 4 | The payee's bank branch falls within this court's territorial jurisdiction. | mandatory | Statute: s.142(2) NI Act | PENDING |
| 5 | Where the notice was returned refused/unclaimed, deemed service is expressly averred and the cause of action is computed from the deemed delivery date. | mandatory | Case law: C.C. Alavi Haji v. Palapetty Muhammed | PENDING |
| 6 | Where the complaint is filed beyond one month of the cause of action, a condonation application under the proviso to s.142(b) is attached. | advisory | Statute: proviso to s.142(b) NI Act | PENDING |

## 3.2 — Regular bail application

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The period of custody is recomputed as on the generation date and pleaded (never stale). | mandatory | Local practice: custody recomputed at filing | PENDING |
| 2 | Where a special statute engages a bail bar, the application addresses the applicable test head-on (twin conditions for NDPS s.37 / PMLA s.45; prima-facie-true for UAPA s.43D(5)). | mandatory | Statute: s.37 NDPS; s.45 PMLA; s.43D(5) UAPA | PENDING |
| 3 | A successive application discloses the prior order and pleads a change of circumstance since the prior refusal. | mandatory | Case law: successive-bail disclosure; Kalyan Chandra Sarkar v. Rajesh Ranjan | PENDING |
| 4 | A parity claim references the order granting bail to the co-accused relied upon. | mandatory | Local practice: parity requires an order reference | PENDING |
| 5 | The petitioner undertakes to abide by the conditions of bail and to cooperate with the investigation/trial. | mandatory | Local practice: bail undertaking | PENDING |

## 3.3 — Anticipatory bail application

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | A reasonable apprehension of arrest is stated with its basis (a bare assertion is insufficient). | mandatory | Case law: Gurbaksh Singh Sibbia v. State of Punjab | PENDING |
| 2 | The petitioner has not been arrested so far. | mandatory | Local practice: anticipatory bail presupposes no arrest | PENDING |
| 3 | The offence is not one barred from anticipatory bail under the SC/ST (Prevention of Atrocities) Act s.18 / 18A. | mandatory | Statute: s.18 / 18A SC/ST Act; Prathvi Raj Chauhan v. UoI | PENDING |
| 4 | For a transit anticipatory bail, the jurisdiction of this court to entertain the petition is pleaded. | advisory | Case law: Priya Indoria v. State of Karnataka (transit anticipatory bail) | PENDING |

## 3.4 — Default bail application

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The petitioner expressly avers readiness and willingness to furnish bail (a precondition to availing the right). | mandatory | Statute: s.167(2) CrPC / s.187 BNSS; Rakesh Kumar Paul v. State of Assam | PENDING |
| 2 | The statutory period is computed from the date of first remand (not arrest) and its expiry is pleaded. | mandatory | Case law: Chaganti Satyanarayana v. State of AP | PENDING |
| 3 | The final report (chargesheet) has not been filed within the statutory period. | mandatory | Statute: s.167(2) CrPC / s.187 BNSS | PENDING |
| 4 | The application was presented before the filing of the final report (the indefeasible right was availed in time). | mandatory | Case law: Uday Mohanlal Acharya; M. Ravindran v. Intelligence Officer, DRI | PENDING |

## 4.1 — Plaint for money recovery (Order VII CPC)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The cause of action is pleaded with both its date and its place. | mandatory | Statute: O7 R1(e) CPC | PENDING |
| 2 | Pecuniary jurisdiction is pleaded: the suit value is within the forum's ceiling. | mandatory | Statute: s.15 CPC; O7 R1(f) | PENDING |
| 3 | Territorial jurisdiction is pleaded on at least one s.20 CPC basis (defendant resides / carries on business, or cause of action arose here). | mandatory | Statute: s.20 CPC | PENDING |
| 4 | The suit is within limitation; where relied upon, a written acknowledgement restarting the period is pleaded. | mandatory | Statute: Limitation Act 1963, Schedule; s.18 | PENDING |
| 5 | The account statement reconciles: principal plus interest equals the total claimed. | mandatory | Local practice: pleaded account must reconcile | PENDING |
| 6 | Against a Government/public officer defendant, a notice under s.80 CPC is pleaded. | mandatory | Statute: s.80 CPC; O27 | PENDING |
| 7 | In a commercial suit, a s.12A pre-institution mediation certificate or a pleaded exemption is present, with a statement of truth. | mandatory | Statute: s.12A Commercial Courts Act 2015; Patil Automation v. Rakheja Engineers | PENDING |
| 8 | The court fee and the valuation basis are both pleaded. | mandatory | Statute: TN Court Fees and Suits Valuation Act 1955 | PENDING |
| 9 | The plaint carries a verification. | mandatory | Statute: O6 R15 CPC | PENDING |
| 10 | Where contractual interest is claimed without a supporting document, interest falls back to the statutory rate and the plaint says so. | advisory | Statute: s.34 CPC | PENDING |

## 4.1-O37 — Summary suit (Order XXXVII CPC)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The claim falls within the scope of Order XXXVII (written contract, bill of exchange, promissory note, or a liquidated demand arising from an enactment). | mandatory | Statute: O37 R1(2) CPC | PENDING |
| 2 | For an instrument-based claim, the instrument (bill/note/written contract) is identified. | mandatory | Statute: O37 R2 CPC | PENDING |
| 3 | The plaint states that it is filed under Order XXXVII. | mandatory | Statute: O37 R2(1) CPC | PENDING |
| 4 | The plaint states that no relief outside the scope of Order XXXVII is claimed. | mandatory | Statute: O37 R2(1) CPC | PENDING |
| 5 | The plaint states that a summons for judgment will follow institution and that the defendant has no right to defend without leave. | mandatory | Statute: O37 R3 CPC | PENDING |
| 6 | Cause of action (date and place), jurisdiction (both limbs), limitation and the reconciled account are pleaded, as in an ordinary plaint. | mandatory | Statute: O7 CPC (shared with the ordinary plaint) | PENDING |

## 4.2 — Application for temporary injunction (O39 R1 & 2 CPC)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | A prima facie case is pleaded as a separately headed paragraph. | mandatory | Case law: Dalpat Kumar v. Prahlad Singh (three-limb test) | PENDING |
| 2 | The balance of convenience is pleaded as a separately headed paragraph. | mandatory | Case law: Dalpat Kumar v. Prahlad Singh | PENDING |
| 3 | Irreparable injury (not compensable in money) is pleaded as a separately headed paragraph. | mandatory | Case law: Dalpat Kumar v. Prahlad Singh | PENDING |
| 4 | The prayer identifies the specific act sought to be restrained (a bare 'restrain the defendant' is insufficient). | mandatory | Statute: O39 R1 & 2 CPC; specificity of relief | PENDING |
| 5 | The applicant gives an undertaking as to damages. | mandatory | Local practice: undertaking as to damages | PENDING |
| 6 | For ex-parte relief, a paragraph under the proviso to O39 R3 states the urgency and why notice would defeat the purpose of the application. | mandatory | Statute: proviso to O39 R3 CPC | PENDING |

## 5.1 — Writ petition under Article 226

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | For mandamus: a legal right in the petitioner, a corresponding public duty on the respondent, and a prior demand for performance and its refusal, are all pleaded. | mandatory | Case law: mandamus requisites; Art. 226 | PENDING |
| 2 | For certiorari: a quasi-judicial order sought to be quashed is identified. | mandatory | Case law: certiorari requisites | PENDING |
| 3 | For quo warranto: a public office in question is identified. | mandatory | Case law: quo warranto requisites | PENDING |
| 4 | At least one respondent is a State / instrumentality (Art. 12) or a public-function body (maintainability). | mandatory | Statute: Art. 12; Art. 226 | PENDING |
| 5 | The impugned order is identified by its number and date and is annexed to the petition. | mandatory | Local practice: identification and annexure of impugned order | PENDING |
| 6 | The availability (or non-availability) of an alternative remedy is addressed. | mandatory | Case law: alternative-remedy rule; Whirlpool Corp. v. Registrar of Trade Marks | PENDING |
| 7 | Where the impugned action is not recent, the delay is explained (laches). | mandatory | Case law: laches in writ jurisdiction | PENDING |
| 8 | The petition carries the no-similar-petition declaration in its verification. | mandatory | Local practice: no-similar-petition declaration | PENDING |
| 9 | Grounds are lettered (A, B, C ...). | advisory | Local practice: writ-practice ground lettering | PENDING |

## 6.1 — Contested divorce petition (HMA s.13)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | For cruelty: at least one dated instance is pleaded (general allegations are insufficient). | mandatory | Statute: s.13(1)(ia) HMA | PENDING |
| 2 | For desertion: separation for a continuous period of not less than two years, animus deserendi, without the petitioner's consent, and without reasonable cause, are all pleaded. | mandatory | Statute: s.13(1)(ib) HMA; Bipinchandra v. Prabhavati | PENDING |
| 3 | For adultery: a specific instance is pleaded, and the co-respondent is joined or a reason for non-joinder is stated. | mandatory | Statute: s.13(1)(i) HMA; O1 R shall-be-joined | PENDING |
| 4 | The petition avers the absence of collusion, connivance and condonation. | mandatory | Statute: s.23(1) HMA | PENDING |
| 5 | Where there are children of the marriage, the custody position and the maintenance position are both addressed. | mandatory | Local practice: children's custody and maintenance | PENDING |
| 6 | Jurisdiction is pleaded on an s.19 HMA basis (not the s.20 CPC limbs). | mandatory | Statute: s.19 HMA | PENDING |
| 7 | Where the petition is presented within one year of the marriage, an application for leave under the proviso to s.14 is attached. | advisory | Statute: proviso to s.14 HMA | PENDING |

## 6.2-first — Mutual-consent divorce — first motion (HMA s.13B)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The parties have been living separately for one year or more before the first motion. | mandatory | Statute: s.13B(1) HMA | PENDING |
| 2 | The settlement addresses maintenance, or expressly records that it does not arise. | mandatory | Local practice: settlement completeness | PENDING |
| 3 | The settlement addresses custody, or expressly records that it does not arise. | mandatory | Local practice: settlement completeness | PENDING |
| 4 | The settlement addresses property, or expressly records that it does not arise. | mandatory | Local practice: settlement completeness | PENDING |
| 5 | Both parties file a joint affidavit. | mandatory | Statute: s.13B(1) HMA | PENDING |

## 6.2-second — Mutual-consent divorce — second motion (HMA s.13B(2))

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The second motion is moved within eighteen months of the first-motion order. | mandatory | Statute: s.13B(2) HMA | PENDING |
| 2 | The second motion is moved after the six-month cooling-off period, or a waiver application is attached. | mandatory | Case law: s.13B(2) HMA; Amardeep Singh v. Harveen Kaur | PENDING |
| 3 | Where a waiver of the cooling-off period is sought, the settlement has already been implemented. | mandatory | Case law: Amardeep Singh v. Harveen Kaur | PENDING |

## 6.3 — Maintenance petition (BNSS 144 / CrPC 125)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | Neglect or refusal to maintain is pleaded expressly (the statutory trigger). | mandatory | Statute: s.144 BNSS / s.125 CrPC | PENDING |
| 2 | The petitioner files an affidavit of assets and liabilities. | mandatory | Case law: Rajnesh v. Neha | PENDING |
| 3 | A divorced-wife petitioner avers that she has not remarried. | mandatory | Statute: s.125(4)-(5) CrPC / s.144 BNSS | PENDING |
| 4 | For a child claimant aged 18 or over, an inability to maintain themselves due to a physical or mental abnormality is pleaded. | mandatory | Statute: proviso to s.125(1) CrPC / s.144 BNSS | PENDING |
| 5 | A positive quantum of maintenance is sought, with a stated computation basis (not a bare figure). | mandatory | Case law: Rajnesh v. Neha (quantum basis) | PENDING |

## 6.4 — Application under s.12 of the Protection of Women from Domestic Violence Act

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The domestic relationship is pleaded expressly with its basis (the jurisdictional fact). | mandatory | Statute: s.2(f) DV Act | PENDING |
| 2 | At least one head of relief is sought. | mandatory | Statute: s.12 DV Act | PENDING |
| 3 | Where a residence order under s.19 is sought, the shared household is pleaded. | mandatory | Statute: s.17, s.19 DV Act; S.R. Batra v. Taruna Batra / Satish Chander Ahuja v. Sneha Ahuja | PENDING |
| 4 | Each head of relief sought (s.18 protection / s.19 residence / s.20 monetary / s.21 custody / s.22 compensation) has a supporting averment. | mandatory | Statute: ss.18-22 DV Act | PENDING |
| 5 | Abuse incidents are dated where possible and categorised (physical / sexual / verbal-emotional / economic). | advisory | Statute: s.3 DV Act (definition of domestic violence) | PENDING |

## 7.1 — Consumer complaint (Consumer Protection Act 2019)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | The complainant is a 'consumer' within s.2(7); goods/services were not obtained for a commercial purpose (self-employment for livelihood is not commercial). | mandatory | Statute: s.2(7) CPA 2019 | PENDING |
| 2 | Where a compensation figure is claimed, it has a stated basis (not a bare figure). | mandatory | Local practice: compensation must be reasoned | PENDING |
| 3 | The complaint is supported by an affidavit. | mandatory | Statute: CPA 2019 / Consumer Protection (Consumer Commission Procedure) Regulations | PENDING |
| 4 | An evidence affidavit is filed. | mandatory | Local practice: evidence affidavit | PENDING |
| 5 | Where filed beyond two years of the cause of action, a condonation application is attached (limitation lapse does not defeat the complaint). | advisory | Statute: s.69 CPA 2019 | PENDING |

## 7.2 — MACT claim petition (MV Act s.166)

| # | Averment | Kind | Source | Verified |
|---|---|---|---|---|
| 1 | Rash and negligent driving of the offending vehicle is pleaded expressly (the jurisdictional averment). | mandatory | Statute: s.166 MV Act 1988 | PENDING |
| 2 | The compensation claimed equals the figure recomputed by the Tribunal-approved multiplier method. | mandatory | Case law: Sarla Verma v. DTC; National Insurance v. Pranay Sethi | PENDING |
| 3 | For an injury claim, the disability percentage and whether it is permanent are pleaded. | mandatory | Case law: Raj Kumar v. Ajay Kumar (assessment of disability) | PENDING |
| 4 | Where the policy was invalid/lapsed on the accident date, the claim addresses it and proceeds against the owner and driver. | mandatory | Statute: ss.147, 149 MV Act (owner/driver liability) | PENDING |
| 5 | Where income is asserted without documentary proof, the computation records that it proceeds on the asserted figure, to be established at trial. | advisory | Local practice: income to be proved at trial | PENDING |

# Section C — Refusal Conditions (typed catalogue)

Every condition under which a pipeline refuses to generate a document, with its stable machine code, severity, the implicated fields, and the exact message the advocate sees. GENERATED by driving each pipeline into the refusal and reading back its structured Refusal — not hand-maintained, so it cannot drift from the code. The `code` column is the contract the frontend branches on.

_43 refusal conditions across 17 documents; all coded._

## 2.1 — General demand notice

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `general_notice_non_positive_demand` | hard | demand_amount | a demand notice must specify a positive sum demanded |
| `general_notice_compliance_below_statutory_minimum` | hard | compliance_days, statutory_minimum_days | compliance period of 7 days is below the statutory minimum of 15 days that applies to this notice |
| `general_notice_no_specific_consequence` | hard | civil_consequence, criminal_consequence | a specific consequence of non-compliance must be stated (civil suit and/or criminal proceedings); a vague threat is not sufficient |
| `general_notice_dispatch_proof_missing` | hard | dispatch_tracking_placeholder | dispatch proof placeholder is mandatory |

## 2.2 — s.138 statutory notice

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `s138_notice_no_cheque_particulars` | hard | cheques | notice has no cheque particulars |
| `s138_notice_memo_receipt_date_missing` | hard | memo_received_date | date of receipt of the dishonour memo is required — the limitation anchor is the receipt date, not the memo date |
| `s138_notice_dishonour_reason_missing` | hard | dishonour_reason | dishonour reason (as stated in the bank memo, verbatim) is required |
| `s138_notice_dispatch_proof_missing` | hard | dispatch_tracking_placeholder | dispatch proof placeholder is mandatory (proof of dispatch must be recorded on the notice) |
| `s138_notice_compliance_period_not_15_days` | hard | compliance_days | compliance period must be exactly 15 days (got 20); the drawer's statutory time to pay cannot be shortened or extended |

## 3.1 — s.138 complaint

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `s138_complaint_complainant_not_payee_or_holder` | hard | is_payee | the complainant must be the payee or holder in due course of the cheque(s); this is a mandatory averment |
| `s138_complaint_company_accused_no_s141_averment` | hard | accused_is_company, s141_averment | company accused without the s.141 averment that the person(s) sought to be made vicariously liable were in charge of and responsible for the conduct of the business at the relevant time; the complaint is defective and will not be generated |
| `s138_complaint_payee_bank_branch_outside_jurisdiction` | hard | payee_bank_branch_in_jurisdiction | the payee's bank branch does not fall within this court's territorial jurisdiction (s.142(2) NI Act); the complaint cannot be filed here |

## 3.2 — Regular bail

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `regular_bail_special_statute_bar_unaddressed` | hard | special_statute, bail_bar_addressed | special statute s.37 NDPS engages a statutory bail bar that must be addressed head-on; the application does not address it |
| `regular_bail_successive_without_prior_order` | hard | is_successive, prior_order_ref | successive bail application requires a reference to the prior order (disclosure is mandatory) |
| `regular_bail_successive_without_change_of_circumstance` | hard | is_successive, change_of_circumstance | successive bail application requires a change-of-circumstance averment since the prior refusal |

## 3.3 — Anticipatory bail

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `anticipatory_bail_already_arrested` | hard | already_arrested | Anticipatory bail unavailable: the applicant is already arrested. Route to a regular bail application. |
| `anticipatory_bail_scst_barred` | hard | is_scst_offence | Anticipatory bail barred: the offence is under the SC/ST (Prevention of Atrocities) Act; section 18 / 18A bars the grant of anticipatory bail. |
| `anticipatory_bail_apprehension_basis_not_stated` | hard | apprehension_basis | a reasonable apprehension of arrest must be stated with its basis; a bare assertion is not sufficient |

## 3.4 — Default bail

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `default_bail_readiness_not_averred` | hard | readiness_to_furnish_bail | Default bail not made out: the application lacks the express averment of readiness to furnish bail, which is required to avail the right under s.167(2)/s.187. |
| `default_bail_right_extinguished` | hard | application_ts, chargesheet_filed_ts | Default bail right extinguished: the final report (chargesheet) was filed before the application was presented, so the indefeasible right under s.167(2)/s.187 was not availed in time. |
| `default_bail_precedence_indeterminate` | hard | application_ts, chargesheet_filed_ts | Default bail precedence indeterminate: the application and the final report cannot be ordered in time from the record (timestamps equal or missing). Establish which was presented first before proceeding. |

## 4.1 — Plaint (money recovery)

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `plaint_cause_of_action_date_missing` | hard | cause_of_action_date | cause of action requires a date; it is missing |
| `plaint_cause_of_action_place_missing` | hard | cause_of_action_place | cause of action requires a place; it is missing |
| `jurisdiction_no_territorial_basis` | hard | territorial_bases | no territorial jurisdiction basis pleaded; s.20 CPC requires that the defendant reside or carry on business within the court's limits, or that the cause of action wholly or in part arose there |
| `plaint_s80_cpc_notice_missing` | hard | is_government_defendant, s80_notice_ref | the defendant is the Government/a public officer; a notice under s.80 CPC is mandatory and its averment is missing |
| `plaint_s12a_mediation_missing` | hard | is_commercial_suit, s12a_ref | commercial suit requires a s.12A pre-institution mediation certificate or a pleaded exemption; it is missing |

## 4.1-O37 — Summary suit (O37)

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `summary_suit_out_of_o37_scope` | hard | claim_basis | the claim does not fall within the scope of Order XXXVII (written contract, bill of exchange, promissory note, or a liquidated demand arising from an enactment); a summary suit is not maintainable |

## 4.2 — Temporary injunction

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `injunction_triad_missing_prima_facie` | hard | prima_facie_case | the prima facie case limb is missing or empty; all three limbs of the injunction triad must be pleaded as separately headed paragraphs, and a missing limb is fatal |
| `injunction_triad_missing_balance_of_convenience` | hard | balance_of_convenience | the balance of convenience limb is missing or empty; all three limbs of the injunction triad must be pleaded as separately headed paragraphs, and a missing limb is fatal |
| `injunction_triad_missing_irreparable_injury` | hard | irreparable_injury | the irreparable injury limb is missing or empty; all three limbs of the injunction triad must be pleaded as separately headed paragraphs, and a missing limb is fatal |

## 5.1 — Writ petition (Art. 226)

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `writ_mandamus_no_legal_right` | hard | legal_right | mandamus requires a legal right in the petitioner; none pleaded |
| `writ_no_state_respondent` | hard | respondents | writ petition not maintainable: the respondent(s) are private parties with no State / instrumentality (Art. 12) or public-function respondent |
| `writ_alternative_remedy_not_addressed` | hard | alternative_remedy_addressed | the availability of an alternative remedy is not addressed; an unaddressed alternative remedy is a maintainability failure, not a stylistic gap |

## 6.1 — Contested divorce (HMA s.13)

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `divorce_contested_cruelty_no_dated_instance` | hard | cruelty_instances | cruelty must be pleaded with at least one dated instance; general allegations are insufficient |

## 6.2-first — Mutual-consent divorce — first motion

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `divorce_mutual_first_separation_under_one_year` | hard | living_separately_since, first_motion_date | the parties must have been living separately for one year or more before the first motion; the period is not made out |

## 6.2-second — Mutual-consent divorce — second motion

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `divorce_mutual_second_after_eighteen_months` | hard | first_motion_order_date, second_motion_date | the second motion must be moved within eighteen months of the first-motion order; the window has closed |

## 6.3 — Maintenance (BNSS 144 / CrPC 125)

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `maintenance_neglect_not_pleaded` | hard | neglect_or_refusal_pleaded | neglect or refusal to maintain is the statutory trigger under s.144 BNSS / s.125 CrPC and must be pleaded expressly; it is absent |
| `maintenance_rajnesh_affidavit_absent` | hard | petitioner_rajnesh_affidavit | the petitioner's affidavit of assets and liabilities (Rajnesh v. Neha) is mandatory and is absent |

## 6.4 — DV Act s.12 application

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `dv_domestic_relationship_not_pleaded` | hard | domestic_relationship_pleaded, domestic_relationship_basis | the domestic relationship is the jurisdictional fact under the DV Act and must be pleaded expressly with its basis; it is absent |

## 7.1 — Consumer complaint

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `consumer_commercial_purpose_not_consumer` | hard | purpose | the goods/services were obtained for a commercial purpose; the complainant is not a 'consumer' under s.2(7) of the Consumer Protection Act 2019. (Note: purchase for self-employment to earn a livelihood is not a commercial purpose.) |
| `consumer_affidavit_absent` | hard | affidavit_present | the complaint must be supported by an affidavit |
| `consumer_evidence_affidavit_absent` | hard | evidence_affidavit_present | an evidence affidavit is required and is absent |

## 7.2 — MACT claim (MV Act s.166)

| Code | Sev | Fields | Message the advocate sees |
|---|---|---|---|
| `mact_claim_rash_negligent_not_pleaded` | hard | rash_negligent_pleaded | rash and negligent driving must be pleaded expressly; it is the jurisdictional averment for a claim under s.166 MV Act |
