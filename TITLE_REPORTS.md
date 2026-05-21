# Title Reports — LexDraft

Implementation reference for the **Title Investigation Report (TIR)** feature
introduced in migration 0050. Read this alongside
[APPLICATION_ARCHITECTURE.md §11.14](./APPLICATION_ARCHITECTURE.md#1114-title-reports-workflow).

---

## 1. Domain primer

A Title Search Report / Title Investigation Report (TIR) is the document an
advocate prepares for a bank, NBFC, or buyer **certifying the marketability of
title to immovable property in India**. It is the single highest-stakes
drafting deliverable in property practice — lenders refuse to disburse without
one.

A complete Indian TIR contains, at minimum:

1. **Property identification** — address, survey/sub-division numbers,
   extent (sq.ft / acres / cents / guntas), boundaries (N/S/E/W),
   Schedule A/B legal description.
2. **Owner / applicant details** — current owner, applicant if different
   (e.g. buyer applying for a loan), bank/NBFC name and branch.
3. **Chain of title** — typically 30 years for marketable title under Indian
   conveyancing practice (some banks accept 13). A timeline of every transfer
   (sale, gift, partition, settlement, will, inheritance, decree) with
   document number, date, Sub-Registrar Office, book / volume / pages, stamp
   duty paid, transferor → transferee, consideration.
4. **Documents examined** — list with type, parties, date, registration
   details, copy type (original / certified / photocopy / notarised).
5. **Public-records search trail** — SRO search for the relevant period;
   Encumbrance Certificate (Form 15 / Form 16); revenue records:
   - Tamil Nadu: Patta, Chitta, Adangal, A-Register, FMB sketch, TSLR
   - Karnataka: Khata (A/B), RTC (Pahani), Mutation Register, Tippani, Akarbandh
   - Maharashtra: 7/12 extract, 8A, Mutation entries
   - Telangana / Andhra: Dharani / 1-B / Pahani / ROR-1B
   - Generic India fallback: Record of Rights (RoR), Mutation, Khasra / Khatauni
   Plus municipal records (property tax, Khata certificate, assessment register).
6. **Statutory approvals** — RERA registration, building plan sanction,
   layout approval (DTCP / CMDA / BDA / HMDA / BBMP / MCGM), occupancy /
   completion certificate, NOCs (fire, pollution, AAI height, environment),
   DC / land conversion.
7. **Litigation search** — High Court, District Court, DRT, NCLT, consumer
   fora, lok adalat — by party name and by property. Attachment orders.
   Lis pendens (CPC §52).
8. **Tax & dues status** — property tax, water tax, electricity dues,
   society dues, maintenance.
9. **Genealogy / family tree** — mandatory where any link in the chain is
   by inheritance / intestate succession; heirs listed per the applicable
   personal law (Hindu Succession Act / Muslim personal law / Indian
   Succession Act).
10. **Defects / observations** — gaps in the chain, missing documents,
    irregularities in stamp duty, unregistered transfers, mismatches in
    extent, encumbrances subsisting.
11. **Opinion on marketability** — clear / clear subject to conditions /
    not clear, with reasoned basis.
12. **List of original documents to be deposited** (for equitable mortgage).
13. **Advocate certification block** — name, Bar Council enrolment number,
    seal, signature, date, place.

---

## 2. Schema (migration 0050)

The schema mirrors the domain 1:1 — 13 tables under `title_report_*`, plus a
`title_report_counters` row that atomically allocates firm-year sequence
numbers (`TR/2026/00041`) and a `plan_title_report_caps` row that holds the
Solo monthly quota.

| Table | Purpose |
|-------|---------|
| `title_reports` | Header + state machine + opinion verdict + summary |
| `title_report_properties` | Schedule of property (1:1 with header). Jurisdiction-specific revenue fields in jsonb |
| `title_report_chain_links` | Ordered chain (sequenced) |
| `title_report_documents` | Documents examined + extraction payload + extraction status |
| `title_report_encumbrances` | EC transaction rows (subsisting / discharged) |
| `title_report_searches` | SRO / revenue / municipal / litigation searches |
| `title_report_litigation` | Litigation hits with relevance |
| `title_report_statutory_approvals` | RERA / OC / CC / NOCs etc. |
| `title_report_heirs` | Family tree for inheritance-based links |
| `title_report_defects` | AI- or advocate-flagged defects, ack/dismiss workflow |
| `title_report_ai_runs` | Replay log for every Claude / xAI call |
| `title_report_exports` | PDF / DOCX generation history |
| `title_report_counters` | Per-(firm, year) sequence allocator |
| `plan_title_report_caps` | Solo: 2 reports/cycle; Practice: 200; Firm: 1000 |

Every tenant-scoped table carries `firm_id` (FK + indexed). Enforcement is
in **service code**, not RLS — see `cases.service.ts` / `mock-arguments.service.ts`
for the parallel pattern.

State enum: `draft → in_review → finalised → issued → withdrawn`. Transitions
are validated in `title-reports.service.ts::assertCanTransition` with
**completeness gates**:

- `draft → in_review` requires property, ≥ 1 chain link, ≥ 1 EC row, ≥ 1 search log, and a non-pending verdict.
- `in_review → finalised` requires every blocker defect to be acknowledged or dismissed + a non-empty opinion summary.
- `finalised → issued` requires a PDF export row.

---

## 3. AI prompts (excerpts)

Two distinct Claude / xAI calls, both persisted in `title_report_ai_runs` and
both with deterministic template fallbacks so the feature works end-to-end
without an API key. See [`title-reports.ai.service.ts`](./apps/api/src/services/title-reports.ai.service.ts) for the full prompt
strings.

### 3.1 Defects analysis (`run_type = 'defects_analysis'`)

System role (excerpt):

> You are a senior Indian conveyancing advocate with twenty-five years of
> experience preparing Title Investigation Reports (TIR) for nationalised
> and private-sector banks. […]
>
> Indian conveyancing standards apply:
> - Marketable title typically requires an unbroken 30-year chain.
> - Every transfer of immovable property worth more than ₹100 must be
>   registered (§17 Registration Act 1908). Unregistered transfers are blockers.
> - Stamp duty deficiencies are governed by the relevant state Stamp Act.
> - Inheritance links require a legal heir certificate / succession certificate
>   / probate where applicable.
> - Subsisting mortgages in the EC require a registered release.
> - Pending litigation marked relevance=direct triggers a lis pendens flag (§52 CPC).
> - Projects > 500 sqm or > 8 units must be RERA-registered (§3 RERA 2016).
>
> Output ONLY the JSON object.

Output schema (typed in `packages/types`):

```ts
interface TitleReportDefectsAnalysis {
  defects: Array<{
    category: 'chain_gap' | 'unregistered_link' | 'stamp_duty'
            | 'extent_mismatch' | 'subsisting_encumbrance'
            | 'pending_litigation' | 'missing_noc' | 'approval_lapsed'
            | 'inheritance_gap' | 'other';
    severity: 'info' | 'warning' | 'blocker';
    description: string;
    recommendation: string;
    refs: Array<{ kind: 'chain_link' | 'document' | 'encumbrance' | 'litigation' | 'approval' | 'heir'; id: string }>;
  }>;
  chainGapYears: number;
  completenessScore: number; // 0-100
  notes: string;
}
```

### 3.2 Opinion synthesis (`run_type = 'opinion_synthesis'`)

System role (excerpt):

> You are a senior Indian conveyancing advocate. Given the hydrated
> title-report tree and the latest defects analysis, you synthesise the
> marketability opinion as it will appear in the TIR.
>
> The verdict must be derivable from the defects:
> - No blocker defects, no warnings → `clear`.
> - No blocker defects, one or more warnings → `clear_with_conditions`.
> - One or more blockers → `not_clear`.
>
> The reasoning is 3-6 paragraphs of formal advocate's voice in third person:
> "On a perusal of the documents furnished and the searches conducted at
> the office of the Sub-Registrar of <office>, ..."
>
> Cite Indian statutes where relevant — Transfer of Property Act 1882 §54 / §58,
> Registration Act 1908, Indian Stamp Act 1899 or the applicable state amendment,
> Hindu Succession Act 1956 §6, RERA 2016. Never quote a statute by more than
> 15 words. Reflect the jurisdiction in the language.

Output schema:

```ts
interface TitleReportOpinionSynthesis {
  verdict: 'clear' | 'clear_with_conditions' | 'not_clear';
  conditions: string[];
  reasoning: string;
  listOfOriginals: string[];
  certifications: string[];
}
```

### 3.3 Template fallback

When neither `ANTHROPIC_API_KEY` nor `XAI_API_KEY` is set, both prompts return
a deterministic shape (`templateDefects` / `templateOpinion`). The defects
template runs the following heuristic passes:

- Chain gap: gaps of ≥ 5 years between consecutive `documentDate` values are
  warnings; ≥ 7 years are blockers.
- Subsisting encumbrance with no discharge ref → blocker.
- Inheritance / will-based link without an heir / probate / death-certificate
  document on record → warning.
- Direct-relevance litigation → blocker (lis pendens).
- Expired or not-obtained statutory approvals → warning (RERA/OC) or info.

The opinion template derives the verdict purely from the defect counts —
identical rule to what the LLM is instructed to apply.

---

## 4. Jurisdiction matrix

`JurisdictionFields` in [`TitleReportDetailView.tsx`](./apps/web/src/views/TitleReportDetailView.tsx) renders the right revenue-record vocabulary per state:

| State (code) | Revenue-record fields surfaced |
|--------------|--------------------------------|
| TN | Patta no, Chitta no, Adangal, A-Register, FMB sketch, TSLR |
| KA | Khata (A/B), RTC (Pahani), Mutation Register (MR), Tippani, Akarbandh |
| MH | 7/12 extract, 8A, Mutation entries |
| TG / AP | Dharani, 1-B, Pahani, ROR-1B |
| KL | Thandaper / BTR |
| PB / HR | Fard / Jamabandi |
| WB / OR | Record of Rights (RoR) |
| AS | Jamabandi |
| GJ | 7/12 extract |
| DL / UP / MP / CG / JH / BR / RJ | Khasra / Khatauni |
| OTHER | Record of Rights (generic) |

The selected jurisdiction also shapes the **AI opinion voice** — the prompt
instructs Claude / xAI to refer to Patta and Chitta in TN reports, to Khata
and RTC in KA reports, etc.

---

## 5. Defect taxonomy

| Category | Severity range | Typical recommendation |
|----------|----------------|------------------------|
| `chain_gap` | warning–blocker | Obtain intermediate conveyance / mutation entries |
| `unregistered_link` | warning–blocker | Procure a registered deed; do not rely on a family arrangement alone |
| `stamp_duty` | warning | Pay deficient duty + penalty under the state Stamp Act |
| `extent_mismatch` | info–warning | Reconcile via measurement survey, file mutation if needed |
| `subsisting_encumbrance` | blocker | Procure registered release / no-dues certificate from the lender |
| `pending_litigation` | warning–blocker | Disclose lis pendens; defer disbursement until decided |
| `missing_noc` | info–warning | Obtain the approval from the relevant authority |
| `approval_lapsed` | warning | Procure a fresh approval before disbursement |
| `inheritance_gap` | warning | Obtain death certificate + legal heir / succession certificate |
| `other` | varies | (free-form recommendation) |

---

## 6. RBAC matrix

The feature key `title_report.use` (migration 0050) is broad — every role with
`drafting.basic` inherits it. Per-action gating runs in
`title-reports.service.ts::ROLE_DENY`:

| Role | Create | Edit | AI run | Finalise | Issue | Withdraw |
|------|--------|------|--------|----------|-------|----------|
| Firm Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Partner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Practice Group Lead | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Senior Associate | ✓ | ✓ | ✓ | ✓ | — | — |
| Associate | ✓ | ✓ | ✓ | — | — | — |
| Paralegal | ✓ | ✓ | — | — | — | — |
| Legal Secretary / Intern | — | — | — | — | — | — |

Solo plan: 2 reports / billing cycle. Enforced in
`title-reports.service.ts::assertQuotaOk` before sequence-number allocation,
so a 429 doesn't burn a number. The list view's quota chip surfaces the
"X of Y used this month" meter.

---

## 7. Running the eval harness

The six golden cases (`apps/api/eval/title-reports/cases.ts`) exercise the
deterministic template path and assert defect categories + verdict.

```bash
pnpm --filter @lexdraft/api eval:title-reports
pnpm --filter @lexdraft/api eval:title-reports --filter mortgage
pnpm --filter @lexdraft/api eval:title-reports --json
```

The runner currently runs only the template path — LLM evaluation is run
ad-hoc from the unit suite by re-issuing the same prompts. To extend the
runner to a real provider, add a `--provider <anthropic|xai>` branch in
`apps/api/eval/title-reports/runner.ts::runCase` that calls
`titleReportsAiService.runDefectsAnalysis` against a stub `firmId / userId`
(in-memory mode, so no DB).

---

## 8. Known limitations (v1)

- **No e-Sign integration.** The existing e-sign seam isn't wired; tracked
  for a follow-up.
- **No direct integration with eCourts / Bhulekh / Dharani APIs.** These
  remain manual searches recorded via the searches step.
- **Bank-specific report templates not implemented.** HDFC / SBI / ICICI all
  use the same generic template; bank skins are planned for a follow-up.
- **English-only PDF output.** Marathi / Tamil / Hindi rendering needs a
  bilingual letterhead and font-embedding pass that the html2canvas pipeline
  doesn't do today.
- **Mobile-first wizard polish deferred.** The wizard is responsive but the
  multi-column form rails are tuned for desktop.
