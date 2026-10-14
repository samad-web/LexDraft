# LexDraft — Drafting Format Specifications (DPC Book)

Formats extracted verbatim from **Faculty of Law, University of Delhi — LB-502
"Drafting, Pleadings and Conveyance" (July 2020)**, pages v–133. This is the
canonical, advocate-supplied format source for the engine (CLAUDE.md rule: document
formats are supplied, never guessed). Placeholder syntax is Jinja-style
(`{{ field }}`, `{% if %}`) for docxtpl, matching `format-specs-p0.md`.

**Jurisdiction is PARAMETERIZED** (decision, this build): the book prints Delhi
courts (Rohini / Tis Hazari / Delhi HC), but court name, place, and jurisdiction
are fact-sheet fields so the same skeleton serves Tamil Nadu or any forum. Only
the STRUCTURE and boilerplate WORDING are fixed by the book.

## The shared pleading skeleton (this book's consistent structure)

Every court pleading in the book follows one skeleton. Templates build from it;
per-document specs below record only what differs.

```
                    {{ TITLE }}                          [underlined, centred]
        IN THE COURT OF {{ court }} (DISTRICT {{ district }}), {{ city }}
              {{ case_type }} NO. ______ OF {{ year }}

IN THE MATTER OF:
{{ party_block_1 }}                                 ... {{ role_1 }}
                        VERSUS
{{ party_block_2 }}                                 ... {{ role_2 }}

              {{ DOCUMENT HEADING — repeats title + governing section }}

MOST RESPECTFULLY SHOWETH:
  1. That {{ ... }}
  2. That {{ ... }}
  ...                                               [numbered material facts]

PRAYER:
It is, therefore, most respectfully prayed that this Hon'ble Court may be pleased to:
  (a) {{ ... }};
  (b) {{ ... }};
  ...

                                                    {{ role }}
Place: {{ place }}                                  Through
Date:  {{ date }}                                   Advocate

VERIFICATION:
Verified at {{ city }} on this {{ day }} that the contents of paras {{ a }} to {{ b }}
are true to my knowledge and paras {{ c }} to {{ d }} are true on information
received and believed to be true, and the last para is the humble prayer.
                                                    {{ role }}
[NOTE: {{ note }}]                                  [e.g. "supported by an affidavit"]
```

Party-block form (book convention, p.10, p.14, etc.):
```
{{ name }}
{{ parentage_type }} {{ parentage_name }}          [S/o · W/o · D/o]
R/o {{ address }}
```
For a company (p.10): `M/s {{ name }} / A Company Incorporated Under the Companies
Act, Having Its Registered Office At {{ address }} / Through its Director {{ rep }}`.

---

# NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881
*(DPC Book pp. 130–131 — advocate's demand notice; distinct from the s.138
COMPLAINT at pp. 79–80.)*

This is the PILOT document (`s138_notice`). Unlike the court pleadings above, a
s.138 notice is an **advocate's letter** — it has a letterhead block and salutation,
NOT a cause-title / SHOWETH / verification. The skeleton below is the book's exact
structure.

### Schema (fact-sheet fields; maps to the engine's existing s138_notice adapter)
```
advocate:      { name, chamber_address_lines[], phone }        [letterhead]
notice_date:   date
recipient:     { name, address_lines[], also_at_address_lines[] }   [To + "And also at"]
client:        { name, address }                              [payee, "my client"]
debt_nature:   text            [what the cheque was issued for — e.g. goods sold]
cheque:        { number, date, amount, bank, branch }
presentation:  { bank, branch, date }                         [payee's bank + when deposited]
dishonour:     { memo_date, reason_verbatim, received_date }  [received_date = clock start]
demand_amount: int             [MUST equal cheque amount — engine hard stop]
compliance_days: 15            [statutory; engine hard stop if != 15]
dispatch:      { mode, tracking_placeholder }                 [REGD A/D / U.P.C.]
```

### Skeleton (verbatim structure, DPC pp.130–131)
```
{{ advocate.name }}
Advocate
Ch. No. {{ advocate.chamber }}, {{ court_of_enrolment }}
{{ advocate.city }}
Ph. {{ advocate.phone }}

REGD A/D / U.P.C.
Dated: {{ notice_date }}

To,
{{ recipient.name }},
{{ recipient.address }}
{% if recipient.also_at %}And also at:
{{ recipient.also_at }}{% endif %}

SUB: LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881

Dear Sir,

Under the instructions from and on behalf of my client {{ client.name }},
{{ client.address }} (hereinafter referred to as 'my client'), I serve you with
the following notice:

1. That my client {{ debt_nature }}. During the ordinary course of business you
   addressee {{ transaction }}, for which you issued a cheque bearing
   no. {{ cheque.number }} dated {{ cheque.date }} of {{ cheque.bank }},
   {{ cheque.branch }} for a sum of Rs. {{ cheque.amount }}/-, as part payment
   towards discharge of your liability.

2. That the above-mentioned cheque was deposited by my client with his banker
   {{ presentation.bank }}, {{ presentation.branch }} for encashment on
   {{ presentation.date }}.

3. That the said cheque was returned to my client with an endorsement
   "{{ dishonour.reason_verbatim }}". That the dishonoured cheque along with the
   cheque returning memo of bank dated {{ dishonour.memo_date }} was returned to
   my client.

4. That for the first time my client came to know about the dishonouring of the
   said cheque on {{ dishonour.received_date }}.

5. That on account of the dishonouring of the cheque you addressee are guilty of
   committing offences punishable u/s 138 of the Negotiable Instruments Act, 1881
   (as amended up to date).

Now through this legal notice I hereby call upon you addressee to make the payment
of Rs. {{ demand_amount }}/-, amount of the said dishonoured cheque, within
{{ compliance_days }} days of the receipt of this notice, failing which my client
shall be constrained to take legal action against you by way of civil as well as
criminal proceedings, at your risk as to cost and consequences resulting therefrom.

Yours Sincerely,
{{ advocate.name }}
Advocate

Copy kept in my office for future reference and use.
```

### Mandatory averments (omit → defective; the engine already enforces the hard stops)
- Cheque particulars (no., date, amount, drawee bank+branch) — para 1.
- Presentation within validity — para 2 (engine: 3-month validity check).
- Dishonour reason **verbatim** from the bank memo — para 3.
- **Receipt date** of the memo — para 4 (limitation anchor; engine hard stop if missing).
- Demand == cheque amount (engine hard stop `s138_notice_demand_not_equal_cheque_amount`).
- 15-day compliance window, unshortened (engine hard stop if != 15).
- Notice within 30 days of memo receipt (engine hard stop `s138_notice_out_of_30_day_window`).
- Dispatch proof / REGD A/D reference recorded.

### What the book format ADDS vs. the engine's current s138_notice template
1. **Advocate letterhead block** at the very top (name, chamber, court, phone) —
   the current template jumps straight to the date. ADD.
2. **"REGD A/D / U.P.C." line** above the date. ADD (the engine tracks dispatch_mode
   but the book prints this exact line).
3. **"To," + recipient block + optional "And also at:"** second-address block. The
   book serves the notice at two addresses (business + residence). ADD `also_at`.
4. **Salutation "Dear Sir,"** and sign-off **"Yours Sincerely, / Advocate"**. ADD.
5. **"Copy kept in my office for future reference and use."** footer line. ADD.
6. Numbered paras 1–6 wording as above (the engine's current paras are close but
   the book's phrasing is the canonical one — align wording).

### LLM scope
- Para 1's `{{ transaction }}` / `{{ debt_nature }}` narrative = LLM slot (the
  factual description of what the cheque was for). Everything else is template.

---

# SHARED PLEADING SKELETON — verified against the engine's existing components

The engine already has shared components (`build_cause_title`, `build_prayer`,
`build_verification`, `build_affidavit`). This section records where the DPC book's
canonical wording DIFFERS from those components, so Batch 2/3 templates use the
book's phrasing. These are wording deltas, not new components.

### Body opener
- **Book:** every pleading body opens `MOST RESPECTFULLY SHOWETH:` then numbered
  `1. That …` paragraphs (pp.10, 14, 25, 27, 75…).
- **Action:** ensure each pleading template emits this exact opener before the
  numbered material-facts paragraphs.

### Prayer (book pp.12, 16, 25 — supersede `build_prayer` wording)
- **Book opener:** `It is, therefore, most respectfully prayed that this Hon'ble
  Court may be pleased to:` (note "most respectfully" — the engine's current
  `build_prayer` omits it).
- **Book clause labels:** lettered `(a) … ; (b) … ; (c) … ;` (engine uses numbered).
- **Book standard closer (always last clause):** `pass such other and further
  order(s) as may be deemed fit and proper on the facts and in the circumstances
  of this case.`
- **Signature block below prayer (book, every pleading):**
  ```
                                                    {{ role }}
  Place: {{ place }}                                Through
  Date:  {{ date }}                                 Advocate
  ```

### Verification (book pp.12, 16, 29 — supersede `build_verification` civil wording)
- **Book wording (the canonical filed form):**
  ```
  VERIFICATION:
  Verified at {{ city }} on this {{ day }} day of {{ month }}, {{ year }} that the
  contents of paras {{ knowledge_paras }} of the {{ document_kind }} are true to my
  knowledge {{ derived_source }} and those of paras {{ belief_paras }} are true on
  information received and believed to be true, and the last para is the humble
  prayer to this Hon'ble Court.
                                                    {{ role }}
  ```
- **Key deltas vs. engine:** the book (1) names the **last para as the prayer**
  explicitly, and (2) attributes knowledge paras to "records… maintained in the
  ordinary course of business" for companies (p.10) — the engine's `derived_source`
  slot should carry this. Matrimonial verification (p.41) uses "states on solemn
  affirmation" — a variant.

### NOTE line (book, most pleadings)
- Book ends many pleadings with `[NOTE: The above plaint must be supported by an
  Affidavit]` / `[NOTE: To be supported by an affidavit]`. The engine should carry
  a `filing_note` slot rendered in this bracketed form.

---

# === BATCH 2 — formats mapping to existing pipelines ===

# COMPLAINT UNDER SECTION 138 NI ACT
*(DPC Book pp. 79–80 — the criminal complaint filed in the Magistrate's court;
distinct from the demand NOTICE at pp.130-131.)* Pipeline: `s138_complaint`.

### Book skeleton (pp.79–80) — standard court-pleading skeleton (see shared skeleton)
```
        COMPLAINT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT   [title, centred]
IN THE COURT OF CHIEF METROPOLITAN MAGISTRATE, {{ court_location }} (DISTRICT {{ district }}), {{ city }}
              CRIMINAL COMPLAINT NO. ______ OF {{ year }}

{{ complainant_block }}                             ... COMPLAINANT
                        VERSUS
{{ accused_block }}                                 ... ACCUSED
                                                    JURISDICTION: P.S. {{ police_station }}

        COMPLAINT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881   [heading repeats]

MOST RESPECTFULLY SHOWETH:
  1. That the Complainant {{ complainant_identity }}.
  2. That the accused {{ accused_relationship }} [+ lease/transaction recital].
  3. That on {{ date }} the accused handed over cheque(s) {{ cheque particulars }}
     towards {{ liability }}.
  4. That the Complainant deposited the cheque on {{ presentation_date }} but it
     was dishonoured with the remark "{{ dishonour_reason }}"; returning memo dated
     {{ memo_date }} annexed.
  5. That vide notice dated {{ notice_date }} the Complainant called upon the
     accused to pay; sent by Regd. A.D. + U.P.C.
  6. That the cheque was returned for insufficiency of funds; accused liable u/s 138.
  7. That the Complainant complied with ALL s.138 requirements: cheque presented
     within validity; demand within 30 days of dishonour info; accused failed to
     pay within 15 days; complaint filed within one month of cause of action.
  8. That this Hon'ble Court has jurisdiction {{ jurisdiction_basis }}.

PRAYER:
It is, therefore, most respectfully prayed … summon the accused u/s 138 … tried
and punished in accordance with law.
                                                    COMPLAINANT
Place:                                              Through
Date:                                               Advocate

LIST OF WITNESSES:                                  [book's distinctive tail]
  1. Complainant;
  2. Banker(s) of the complainant with record of the cheque;
  3. Banker(s) of the accused with record of the cheque;
  4. Any other witness as per facts.
```

### What the book format ADDS vs. the engine's current s138_complaint template
The engine's complaint is LEGALLY complete (13 strong paras) but STRUCTURALLY
diverges from the book. To align:
1. **Cause-title header** — `IN THE COURT OF … NO. __ OF __ / complainant VERSUS
   accused / JURISDICTION: P.S. __`. The engine jumps straight to para 1. ADD
   (reuse the shared cause-title component, criminal variant).
2. **`MOST RESPECTFULLY SHOWETH:`** opener before the numbered paras. ADD.
3. **Separate `PRAYER:`** block (reuse shared prayer component) instead of folding
   it into "13.". ALIGN.
4. **Signature block** (Complainant / Through / Advocate, Place, Date). ADD.
5. **`LIST OF WITNESSES:`** tail (the book's four standard witnesses). ADD — this
   is distinctive to the s.138 complaint and currently absent.
KEEP the engine's rigorous s.138 compliance averments (validity, 30-day, 15-day,
one-month, s.141 for companies) — they're stronger than the book's prose and the
hard stops depend on them. The alignment is STRUCTURAL (add the skeleton wrapper +
witness list), not a rewrite of the legal content.

### LLM scope: `debt_slot` (para 3 liability narrative) only. Rest is template.

---

*(Batch 2 continues: bail x2, WS, writ, maintenance, consumer, DV, divorce,
injunction, summary suit — each extracted here then template-aligned + golden-
tested. Then Batch 3 new pipelines, Batch 4 conveyancing. Completed: s.138 notice,
shared skeleton (prayer+verification), s.138 complaint spec.)*
