# LexDraft — Drafting Format Specifications (P0 Set)

Placeholder syntax is Jinja-style (`{{ field }}`, `{% if %}`) for docxtpl.

## How to read a spec

| Section | What it is |
|---|---|
| **Schema** | Fields the Matter Fact Sheet must supply |
| **Skeleton** | Paragraph-by-paragraph structure, in filing order |
| **Mandatory averments** | Omit these and the document is defective |
| **Variants** | Structural forks — different skeletons, not styling |
| **Validation** | Deterministic checks before output |
| **LLM scope** | Which paragraphs the model writes. Everything else is template. |

---

# PART 1 — SHARED COMPONENTS

## 1.1 Cause title

### Schema
```
court: { name, level, side, place, bench }
case: { type, number, year, is_fresh }
parties: [ { role, serial, name, age, parentage_type, parentage_name,
             occupation, address_lines[], pin, is_minor, guardian,
             is_company, cin, rep_by, rep_designation } ]
```

### Format — District Court (civil)
```
        IN THE COURT OF THE {{ court.name }}
                AT {{ court.place }}

              {{ case.type }} No. ______ of {{ case.year }}

{{ p.name }}, aged {{ p.age }} years,
{{ p.parentage_type }} {{ p.parentage_name }},
{{ p.occupation }},
residing at {{ p.address }}                        ... Plaintiff

                        Versus

{{ d.name }}, aged {{ d.age }} years,
{{ d.parentage_type }} {{ d.parentage_name }},
{{ d.occupation }},
residing at {{ d.address }}                        ... Defendant
```

### Format — High Court, writ
```
      IN THE HIGH COURT OF JUDICATURE AT {{ court.place }}
              ({{ court.side }} JURISDICTION)

              W.P. No. ______ of {{ case.year }}

{{ petitioner_block }}                             ... Petitioner
                        Versus
{{ respondent_block }}                             ... Respondents

PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA
praying for a Writ of {{ writ_type }} {{ prayer_short }}
```

### Format — Criminal, Sessions
```
   IN THE COURT OF THE SESSIONS JUDGE, {{ court.place }}

           Crl.M.P. No. ______ of {{ case.year }}
                     in
           {{ crime_ref }}

{{ accused.name }}, aged {{ age }},
{{ parentage }}, {{ address }}
{% if in_custody %}(now confined in {{ prison }}){% endif %}   ... Petitioner/Accused
                        Versus
State represented by
The Inspector of Police,
{{ police_station }},
{{ district }}
(Crime No. {{ crime_no }} of {{ crime_year }})     ... Respondent
```

### Variants
Original side vs appellate side · single judge vs division bench · company petition (NCLT) · family court · tribunal (no "versus", uses Applicant/Respondent) · execution (Decree Holder / Judgment Debtor) · appeal (Appellant / Respondent, with lower court reference line).

### Validation
- Party serial numbers continuous, no gaps
- Minor party has guardian/next friend block
- Company party has CIN and authorised representative
- Respondent order in writs: authority first, private parties last
- Custody line present if `in_custody` true
- Lower court case reference present for all appeals/revisions

---

## 1.2 Verification clause

**Civil (Order VI Rule 15)**
```
I, {{ name }}, the {{ role }} above named, do hereby verify that the
contents of paragraphs {{ knowledge_paras }} are true to my personal
knowledge and those of paragraphs {{ belief_paras }} are believed to be
true on legal advice / information received, and that I have not
suppressed any material fact.

Verified at {{ place }} on this {{ day }} day of {{ month }}, {{ year }}.

                                              {{ role }}
```

**Writ**
```
I, {{ name }}, ... do hereby declare that the facts stated above are
true to the best of my knowledge, information and belief, and that no
other petition on the same cause of action has been filed by me before
this Hon'ble Court or the Hon'ble Supreme Court.
```

**Commercial Courts Act — Statement of Truth (additional)**
```
I, {{ name }}, ... state that the statements made in this {{ doc }} are
true to my knowledge, and that I understand that a false statement may
render me liable for prosecution.
```

### Validation
- `knowledge_paras ∪ belief_paras` must equal the full paragraph range — no unverified paragraphs
- No paragraph appears in both sets
- Writ verification must carry the no-similar-petition declaration
- Commercial suits carry both verification **and** statement of truth

---

## 1.3 Affidavit block

```
                    AFFIDAVIT

I, {{ deponent.name }}, aged {{ age }} years,
{{ parentage_type }} {{ parentage_name }},
{{ occupation }}, residing at {{ address }},
do hereby solemnly affirm and sincerely state as follows:

1. I am the {{ role }} in the above {{ proceeding }} and am well
   acquainted with the facts of the case. {% if authorised %}I am duly
   authorised to swear this affidavit vide {{ authority_ref }}.{% endif %}

2. {{ body }}

{{ n }}. It is therefore prayed that this Hon'ble Court may be pleased
   to {{ prayer }}.

Solemnly affirmed at {{ place }}          }
on this {{ date }}                        }        DEPONENT
and signed his/her name in my presence.   }

                                    BEFORE ME

                              Advocate / Notary / Oath Commissioner
```

### Validation
- Deponent competence stated in para 1
- Corporate deponent has authority reference (board resolution / POA)
- Third-party deponent has explicit source-of-knowledge averment
- Attestation block present; unfilled fields flagged

---

## 1.4 Vakalatnama

### Schema
```
advocate: { name, enrolment_no, bar_council, address, phone, email }
client: { name, role, address }
court, case_ref, engagement_date
```

### Skeleton
1. Appointment clause — client appoints advocate in the named matter
2. Authority clause — to appear, plead, act, file, receive, compromise (with compromise flag)
3. Fee and lien clause
4. Client signature with date and place
5. Advocate acceptance with enrolment number
6. Welfare stamp affixation block

### Validation
- Enrolment number format matches State Bar Council pattern
- Welfare stamp required flag by court
- Multiple clients → separate signature lines, all present
- Compromise authority explicitly on or off, never blank

---

## 1.5 Prayer clause engine

Not free text. Prayer is generated from the relief set; each relief must trace to a pleaded cause of action.

```
relief[] = { type, description, against_party, is_interim, is_alternative }
```

**Rule:** every `relief.type` must have a matching `cause_of_action` in the fact sheet. Unmatched relief is refused, not printed.

**Standard closers**
- Civil: `...and pass such other and further orders as this Hon'ble Court may deem fit and proper in the circumstances of the case and thus render justice.`
- Writ: `...and pass such other order or direction as this Hon'ble Court may deem fit and proper in the facts and circumstances of the case.`
- Criminal: `...and thus render justice.`

---

# PART 2 — PRE-LITIGATION

## 2.1 Legal notice (general demand)

### Schema
```
sender: { client, advocate }
recipient[]: { name, address, mode_of_service }
transaction: { nature, date, documents[], amount, currency }
breach: { description, date, prior_communications[] }
demand: { amount, act_required, compliance_days }
consequence: { civil, criminal_if_any }
```

### Skeleton
```
1.  Advocate letterhead, notice date, mode of dispatch
2.  "Under instructions from and on behalf of my client {{ client }},
    I issue this notice to you as follows:"
3.  Party introduction — who the client is, who the addressee is
4.  Transaction narrative                          [LLM]
5.  Obligation of the addressee — what was owed / to be done
6.  Breach — what was not done, when                [LLM]
7.  Prior demands and addressee's response          [LLM]
8.  Loss and consequences                           [LLM]
9.  DEMAND — specific act + specific sum + compliance period
10. Consequence of non-compliance — civil suit, criminal proceedings,
    costs, interest
11. Reservation of rights
12. "A copy of this notice is retained in my office for record."
13. Advocate signature, enrolment no.
```

### Mandatory averments
- Client's authority to instruct
- Precise sum with computation basis
- Precise compliance period, with start point defined
- Specific consequence — not vague threat

### Validation
- Compliance period ≥ statutory minimum where a statute applies
- Amount in figures and words, matching
- Recipient address matches address in the underlying document
- Dispatch proof placeholder present

### LLM scope
Paragraphs 4, 6, 7, 8 only. Demand and consequence are rule-driven.

---

## 2.2 Section 138 NI Act — statutory notice

> Highest-risk template in the P0 set. A defect here is fatal to the complaint and limitation cannot be revived.

### Schema
```
cheque[]: { number, date, amount, bank, branch, drawer, payee }
presentation: { date, bank, mode }
dishonour: { memo_date, reason, memo_received_date }
debt: { nature, existence_basis, documents[] }
notice: { date, dispatch_mode, tracking }
```

### Skeleton
```
1.  Introduction and client authority
2.  Legally enforceable debt or liability — origin, amount, documents
3.  Issuance of cheque — number, date, amount, bank, drawn in
    discharge of that liability
4.  Presentation — date, bank, within validity
5.  Dishonour — memo date, reason as stated in the memo
6.  Date of receipt of dishonour memo               [limitation anchor]
7.  DEMAND — payment of the cheque amount within 15 days of receipt
8.  Consequence — prosecution u/s 138 NI Act
9.  Signature and dispatch particulars
```

### Mandatory averments — each is a defect if missing
- Cheque drawn **in discharge of a legally enforceable debt or liability**
- Presentation **within validity period**
- Dishonour reason **as stated in the memo**, verbatim
- **Date of receipt** of the memo, not merely memo date
- Demand for **the cheque amount** — not more
- **15 days** for compliance

### Validation (hard stops)
| Check | Rule |
|---|---|
| Presentation window | presentation_date ≤ cheque_date + 3 months |
| Notice window | notice_date ≤ memo_received_date + 30 days |
| Demand amount | demand == cheque amount exactly |
| Compliance period | exactly 15 days |
| Multiple cheques | each cheque itemised separately; consolidated demand permitted |
| Dispatch | proof placeholder mandatory |

> If the notice window has lapsed, do not generate. Show the computation and stop.

---

# PART 3 — CRIMINAL (extract: s.138 complaint)

## 3.1 Section 138 complaint

### Schema
Inherits 2.2, plus:
```
notice_service: { dispatch_date, delivery_date, refused, unclaimed }
cause_of_action_date   # notice_delivery + 15 days + 1
complainant: { is_company, authorised_rep, resolution_ref }
```

### Skeleton
```
1.  Complainant description; if company, authorisation averment
2.  Accused description; if company, s.141 averment for directors
3.  Legally enforceable debt — full narrative           [LLM]
4.  Cheque particulars — tabulated
5.  Presentation and dishonour
6.  Statutory notice — date, mode, service
7.  Failure to pay within 15 days
8.  CAUSE OF ACTION — arose on {{ date }}
9.  Offence u/s 138 made out — ingredients recited
10. Jurisdiction — s.142(2) NI Act, payee's bank branch
11. Limitation — within 1 month of cause of action
12. Court fee and list of documents
13. Prayer — cognizance, summons, trial, punishment, compensation
14. Sworn statement of complainant
15. Verification
```

### Mandatory averments
- Complainant is the payee or holder in due course
- For company accused: who was **in charge of and responsible for the conduct of the business** at the relevant time (s.141)
- Cause of action date computed and stated explicitly
- Jurisdiction basis stated

### Validation
| Check | Rule |
|---|---|
| Filing window | filing_date ≤ cause_of_action_date + 1 calendar month |
| Delay | if exceeded → auto-attach condonation application u/s 142(b) proviso |
| Service | refused/unclaimed → deemed service averment required |
| s.141 | company accused without s.141 averment → block |
| Jurisdiction | payee bank branch must fall within court's territory |

### Variants
Individual accused · company + directors · partnership firm + partners · cheque issued by third party for another's liability · multiple cheques · post-dated cheque · security cheque defence anticipation.

### LLM scope
Paragraph 3 only. Everything else is template or rule-driven.

---

## 3.2 Regular bail

### Schema
```
accused: { name, age, occupation, address, custody_since, prison }
crime: { fir_no, ps, district, date_of_offence, sections[], code_framework }
arrest: { date, place, manner }
investigation: { stage, chargesheet_filed, chargesheet_date }
custody: { days, judicial_or_police }
role: { attribution, recovery, weapon, injury }
antecedents: { prior_cases[], convictions[] }
parity: { co_accused_released[], order_refs[] }
health, dependants, roots
```

### Skeleton
```
1.  Petitioner description; custody particulars
2.  Prosecution case in brief — as per FIR             [LLM, neutral]
3.  Sections invoked; maximum punishment
4.  Arrest date; period in custody as on date of filing
5.  Investigation stage; chargesheet status
6.  GROUNDS                                            [LLM, structured]
    (a) No specific overt act / role attribution
    (b) Investigation complete; custody no longer required
    (c) Offence not punishable with death or life / triable by Magistrate
    (d) Parity with released co-accused, with order references
    (e) No antecedents
    (f) Roots in society; no flight risk
    (g) No possibility of tampering or influencing witnesses
    (h) Delay in trial
    (i) Health / age / dependants
    (j) Presumption of innocence; bail is the rule
7.  Undertaking — cooperate, attend, not tamper, not leave
    jurisdiction without leave
8.  Prayer — enlarge on bail on such conditions
9.  Affidavit
```

### Mandatory averments
- Exact custody duration as on filing date
- Chargesheet status
- Full and truthful disclosure of prior applications and antecedents
- Undertaking paragraph

### Variants — different skeletons, not styling
| Variant | Structural change |
|---|---|
| First vs successive | Successive requires **change of circumstance** paragraph and disclosure of prior order |
| Magistrate vs Sessions vs High Court | Different maintainability paragraph |
| Special statute | Insert bail-bar paragraph addressing s.37 NDPS / s.45 PMLA / s.43D(5) UAPA head-on |
| Chargesheet filed vs not | Different custody-necessity argument |
| Undertrial > 1/3 sentence | Add BNSS 479 (formerly CrPC 436A) ground |

### Validation
- Custody days recomputed from `custody_since` at generation time, never stale
- Special statute detected → bail-bar paragraph mandatory, block if absent
- Successive application → prior order reference mandatory
- Code framework resolved via the three-input dual-code router
- Parity claims require an order reference; unreferenced parity is refused

---

## 3.3 Anticipatory bail

Structurally different from regular bail — apprehension replaces custody.

### Skeleton
```
1.  Petitioner description; no arrest so far
2.  Prosecution case / apprehension of arrest          [LLM]
3.  Reasonable apprehension — basis stated
4.  Sections; maximum punishment
5.  GROUNDS
    (a) False implication / civil dispute given criminal colour
    (b) No custodial interrogation necessary
    (c) Cooperation with investigation offered
    (d) No antecedents
    (e) Roots in society
    (f) Delay in FIR registration
    (g) Malice / counterblast
6.  Undertaking — cooperate, attend, not tamper, not leave jurisdiction
7.  Prayer — direction to release on bail in the event of arrest
8.  Affidavit
```

### Validation
- Must state a **reasonable apprehension** — bare assertion refused
- Anticipatory bail bar detection: SC/ST Act s.18 / 18A → refuse with explanation
- If already arrested → route to regular bail, do not generate
- Transit anticipatory bail → add jurisdiction paragraph

---

## 3.4 Default bail

Purely computational. Least LLM involvement of the three.

### Skeleton
```
1.  Petitioner; arrest date; custody
2.  Sections; maximum punishment; applicable period (60 or 90 days)
3.  Custody period completed as on {{ date }}
4.  Chargesheet not filed within statutory period
5.  Indefeasible right accrued; readiness to furnish bail
6.  Prayer
```

### Validation
| Check | Rule |
|---|---|
| Period | 90 days if punishable with death/life/≥10 yrs; else 60 days |
| Special statute | NDPS 180 extendable (s.36A(4) procedure); UAPA 90+90; PMLA 60 |
| Computation | from date of **first remand**, not arrest |
| Sequence | application before chargesheet survives; chargesheet before application extinguishes — timestamps, not dates |
| Indeterminate | equal or missing timestamps → refuse as *indeterminate*, distinct reason code from *extinguished* |
| Readiness | express averment of willingness to furnish bail is a precondition |

> VERIFY with advocate: special-statute periods, the 60/90 buckets, and the sequence rule.

---

# PART 4 — CIVIL

## 4.1 Plaint — money recovery

### Schema
```
plaintiff, defendant[] (full party blocks)
transaction: { nature, date, agreement_ref, documents[] }
performance: { by_plaintiff, dates, proof[] }
default: { amount_due, since_date, part_payments[] }
interest: { rate, basis, from_date, contractual_or_statutory }
notice: { issued, date, reply, reply_date }
jurisdiction: { territorial_basis, pecuniary_value }
limitation: { article, trigger_date, acknowledgements[] }
```

### Skeleton
```
1.  Plaintiff description and capacity
2.  Defendant description and capacity
3.  Transaction narrative — how the relationship arose      [LLM]
4.  Terms — agreed consideration, timelines, obligations
5.  Performance by the plaintiff                            [LLM]
6.  Default by the defendant                                [LLM]
7.  Part payments and acknowledgements, if any
8.  Account statement — principal, interest, total
9.  Legal notice and reply                                  [LLM]
10. CAUSE OF ACTION — arose on {{ date }} at {{ place }}
11. JURISDICTION — territorial (s.20 CPC) and pecuniary
12. LIMITATION — Article {{ n }}, within time because {{ basis }}
13. COURT FEE — valuation and fee paid
14. Relief / prayer
15. Verification
16. List of documents
```

### Mandatory averments
- Cause of action with **date and place**
- Jurisdiction — both limbs, expressly
- Limitation — article and computation
- Valuation and court fee correspondence
- Notice compliance where statutorily required

### Validation
| Check | Rule |
|---|---|
| Limitation | trigger + article period >= filing date; s.18 acknowledgements restart |
| Court fee | recomputed from relief value per TN Act |
| Pecuniary | value within court's limit, else route to correct forum |
| Interest | contractual rate needs a document reference; else statutory |
| Arithmetic | principal + interest = claimed total, recomputed |
| s.80 CPC | Government defendant -> notice averment mandatory |
| s.12A | commercial suit -> mediation certificate or exemption |

### Variants
Individual, partnership firm (O30), company, Government (O27 + s.80), minor (O32), summary suit (O37 — separate skeleton), commercial suit (adds statement of truth, s.12A).

---

## 4.2 Application — temporary injunction (O39 R1 & 2)

### Skeleton
```
1.  Reference to the suit and its subject matter
2.  Brief facts                                             [LLM]
3.  PRIMA FACIE CASE — the triable issue                    [LLM]
4.  BALANCE OF CONVENIENCE — comparative injury             [LLM]
5.  IRREPARABLE INJURY — why damages are inadequate         [LLM]
6.  Urgency; conduct of the applicant; no delay or laches
7.  Undertaking as to damages
8.  Prayer — specific, precise injunction sought
9.  Affidavit in support
```

### Mandatory averments — the classic triad
Prima facie case, balance of convenience and irreparable injury must each appear as **separately headed paragraphs**. Missing any one -> refuse.

### Validation
- All three limbs present and non-empty -> hard requirement
- Prayer must be specific — "restrain the defendant" without specifying the act is refused
- Ex-parte relief sought -> additional urgency and notice-futility paragraph required (O39 R3 proviso)
- Undertaking as to damages present

---

## 4.3 Written statement — the C3 pipeline

> Not a template. An alignment pipeline. Structure comes from the plaint.

### Pipeline
```
1. Ingest plaint -> parse paragraph numbering
2. Extract averments: one row per plaint paragraph, sub-split where a
   paragraph contains multiple distinct assertions
3. Classify each averment -> admitted / denied / not admitted for want
   of knowledge / matter of record / legal contention
4. Draft reply per averment                                 [LLM]
5. Assemble preliminary objections
6. Assemble additional pleas
7. Emit with paragraph numbering that mirrors the plaint
```

### Averment map — core data structure
```
{ plaint_para: 7,
  averment: "...",
  stance: "denied",
  reply_basis: "...",
  requires_document: true,
  document_ref: "..." }
```

### Skeleton
```
PRELIMINARY OBJECTIONS
  1. Suit not maintainable — grounds
  2. Barred by limitation
  3. Non-joinder / misjoinder of parties
  4. Want of jurisdiction — territorial / pecuniary / subject matter
  5. Suit undervalued; court fee insufficient
  6. No cause of action
  7. Barred by res judicata / s.10 CPC
  8. Bar under a specific statute
  9. Suppression of material facts

PARA-WISE REPLY
  Para {{ n }} of the plaint: {{ stance }}. {{ reply }}
  ... one entry for every plaint paragraph, in order

ADDITIONAL PLEAS
  {{ defendant's own version of facts }}                    [LLM]

PRAYER — dismissal with costs

VERIFICATION
```

### Mandatory rules
- **Every** plaint paragraph must have a reply. Silence is deemed admission (O8 R5).
- General denials insufficient — each material averment needs specific denial.
- Facts within the defendant's knowledge cannot be met with "not admitted for want of knowledge."
- Documents relied on must be listed and filed with the WS (O8 R1A).

### Validation
| Check | Rule |
|---|---|
| Coverage | plaint paragraph count == reply paragraph count. Gap -> refuse |
| Numbering | reply references match plaint numbering exactly |
| Stance | no paragraph left unclassified |
| Knowledge | "want of knowledge" on a within-knowledge fact -> warn |
| Limitation | 30/90/120 days; commercial suits 120 days, non-extendable |
| Counterclaim | if pleaded, court fee computed separately |

---

# PART 5 — WRIT

## 5.1 Writ petition under Article 226

### Skeleton
```
1.  Petitioner description and locus standi
2.  Respondent description — authority, statutory character
3.  Facts, chronologically                                  [LLM]
4.  Impugned action / order / inaction — precisely identified
5.  Representation made and response, if any
6.  GROUNDS (lettered A, B, C...)                           [LLM]
7.  Alternative remedy — absence, or why inefficacious
8.  Delay and laches — explanation
9.  No similar petition filed
10. Interim prayer
11. Main prayer — the specific writ
12. Affidavit
```

### Mandatory averments
- Locus standi
- Respondent is State or instrumentality under Art. 12, or performs a public function
- Alternative remedy addressed — silence here is the most common defect
- Delay explained where the impugned action is not recent
- No-similar-petition declaration

### Validation
- Writ type matches relief: mandamus needs a legal right + duty + prior demand and refusal; certiorari needs a quasi-judicial order; quo warranto needs a public office
- Private respondent alone with no State party -> refuse on maintainability
- Impugned order identified by number and date, and annexed
- Respondent order: authority first, private parties last

---

# PART 6 — FAMILY

## 6.1 Divorce — HMA s.13 (contested)
Grounds s.13(1); specific dated instances for cruelty/desertion; no
collusion/connivance/condonation; jurisdiction s.19; s.14 one-year bar
(leave if within); desertion >= 2 years computed.

## 6.2 Mutual consent divorce — HMA s.13B
First + second motion. Separation >= 1 year at first motion (hard check);
second-motion window 6-18 months; waiver cites Amardeep Singh v. Harveen Kaur;
settlement covers maintenance/custody/property or records absence.

## 6.3 Maintenance — BNSS 144 (formerly CrPC 125)
Neglect/refusal pleaded; respondent means; petitioner inability; Rajnesh
affidavit (refuse without); divorced wife not-remarried; child >=18 only if
unable due to abnormality; quantum basis; code framework via dual-code router.

## 6.4 DV Act s.12 application
Domestic relationship expressly pleaded (jurisdictional, refuse without); each
relief head (s.18-22) supported or refused; shared household pleaded if
residence order sought.

---

# PART 7 — CONSUMER AND MACT

## 7.1 Consumer complaint
Consumer status (commercial purpose -> refuse); pecuniary by consideration
(District/State/National); limitation 2 years (delay -> condonation); relief
compensation basis.

## 7.2 MACT claim petition (MV Act s.166)
Rash and negligent driving expressly averred (jurisdictional); multiplier from
Sarla Verma age band; future prospects per Pranay Sethi slab; deduction for
personal expenses per dependants; arithmetic recomputed = claimed total; policy
validity on accident date.

> VERIFY: multiplier bands, future-prospects slabs, conventional-head figures —
> same review batch as the court fee slabs.
