# eCourts Official API Access — Application Pack

**Purpose:** Obtain sanctioned, programmatic access to eCourts case-data services
so LexDraft can offer fully-automated case search (party / advocate / FIR / case
number / cause list) — the one capability that cannot be done by scraping the
public site or reusing the mobile-app endpoints (both are deliberately blocked
by eCourts against automation; verified).

This is the **durable, compliant** path. It is a submission/liaison process,
not a coding task. Below is everything needed to submit.

---

## 1. Where to apply (three legitimate channels)

| Channel | What it gives | Best for |
|---|---|---|
| **API Setu** (`apisetu.gov.in`) | Government API gateway; some eCourts/court services are published here with documented, key-based access | First choice — self-serve registration, standard onboarding |
| **eCommittee, Supreme Court of India** (`ecommitteesci.gov.in`) | The body that governs eCourts. Direct requests for bulk/API data access to case information | When the specific dataset isn't on API Setu |
| **NJDG Open Data** (`njdg.ecourts.gov.in`) | National Judicial Data Grid — aggregate/statistical case data via open APIs | Analytics/statistics, not per-case lookup |

**Recommended order:** register on **API Setu** first → if the exact case-search
API isn't listed, submit the formal request to the **eCommittee** (template in §4).

---

## 2. What to ask for (be specific — this speeds approval)

Request programmatic access to the following case-information services
(the same data the official eCourts Services app consumes):

- Case status by **CNR** (already working for us via the open endpoint — list it
  so access is consolidated and future-proof)
- Case search by **party name**, **advocate name**, **FIR number**,
  **case number**, **filing number**, **act**
- **Cause lists** by court establishment
- Court-location directory: **states → districts → court establishments**
  *(this `courtEstWebService` directory is the specific piece blocked to us today)*
- **Orders / judgments** metadata and PDF retrieval

Scope: **District & Sessions Courts** (and **High Courts** if the plan covers HC
practice). Geography: pan-India, or name your states if you want faster approval.

---

## 3. Documents you'll typically need ready

- **Organisation identity:** legal entity name, registration/incorporation
  certificate, GSTIN, address.
- **Authorised signatory:** name, designation, ID.
- **Purpose statement:** that LexDraft is a practice-management product for
  advocates that surfaces *their own* matters' public case data (see §4 body).
- **Technical contact:** email/phone for API credential delivery
  (`support@sirahdigital.in`).
- **Data-handling / privacy commitment:** you already have `PRIVACY_POLICY.md`
  and `DATA_PROCESSING_AGREEMENT.md` in the repo — attach these; they demonstrate
  DPDP-aligned handling, which strengthens the request.
- **Expected call volume:** a rough number (e.g. "up to N lookups/day across M
  advocates") — helps them size rate limits.

---

## 4. Ready-to-send request letter (fill the brackets, submit to eCommittee)

> **To:** The eCommittee, Supreme Court of India
> **Subject:** Request for sanctioned API access to eCourts case-information
> services for a legal practice-management application
>
> Respected Sir/Madam,
>
> We, **[Legal entity name]** (operating the product **LexDraft**, a
> practice-management platform for advocates in India), request sanctioned,
> programmatic (API) access to eCourts case-information services.
>
> **About us & purpose.** LexDraft helps individual advocates and small firms
> manage their matters — drafting, hearings, deadlines, and case tracking. Our
> users are enrolled advocates who need to view and track the public status of
> **their own cases**. Today we retrieve case status by CNR through the public
> service, but the court-establishment directory and search-by-party/advocate
> services are not available to us programmatically. Official API access would
> let us serve advocates reliably and within your terms, rather than depending
> on the public web interface.
>
> **Access requested.** Case status (CNR, party, advocate, FIR, case number,
> filing number, act), cause lists, the court-establishment directory
> (state → district → establishment), and order/judgment retrieval, for
> **[District Courts / and High Courts]** across **[states / pan-India]**.
>
> **Expected usage.** Approximately **[N]** lookups/day, growing with our advocate
> user base of **[M]** users. We will honour any rate limits and access terms you
> specify.
>
> **Data handling.** We process case data solely to display it to the advocate to
> whom the matter belongs, in line with the DPDP Act, 2023. Our privacy policy
> and data-processing agreement are attached.
>
> We are happy to complete any onboarding, sign any usage agreement, and provide
> further documentation. Please advise the process and requirements.
>
> Sincerely,
> **[Authorised signatory, designation]**
> **[Organisation]** · **[email]** · **[phone]**

---

## 5. While you wait — what LexDraft already does (no gap for users)

Approval takes time (weeks). In the meantime the product is **not** blocked:

- **CNR lookup** is live and pulls full case data, hearings, orders, PDFs.
- **Court search** works via the human-in-the-loop flow: the advocate searches on
  eCourts (solving the CAPTCHA themselves — legitimate and never blocked) and
  imports the case into LexDraft by CNR in one step.
- All imported cases feed the calendar and matters.

When official API access lands, the client is **already wired** with the correct
establishment parameters (verified from the eCourts APK) — flipping to the
official endpoint is a small, contained change.

---

## 5a. Pre-filled request letter (Sirah Digital / LexDraft)

Known details are filled in; **`⟨…⟩` marks the few things only you can supply**
(legal-entity name as registered, registration/GST number, address, signatory).

> **To:** The eCommittee, Supreme Court of India
> **Subject:** Request for sanctioned API access to eCourts case-information
> services for LexDraft, a legal practice-management application
>
> Respected Sir/Madam,
>
> We, **⟨registered legal entity name — e.g. Sirah Digital / _____⟩**, the operator
> of **LexDraft** (`https://⟨your-domain⟩`), a practice-management platform for
> advocates in India, request sanctioned programmatic (API) access to eCourts
> case-information services.
>
> **About us & purpose.** LexDraft helps individual advocates and small firms in
> India manage their matters — drafting, hearings, deadlines and case tracking.
> Our users are enrolled advocates who need to view and track the public status of
> **their own cases**. We currently retrieve case status by CNR through the public
> service, but the court-establishment directory and search-by-party/advocate
> services are not available to us programmatically. Official API access would let
> us serve advocates reliably and within your terms.
>
> **Access requested.** Case status (CNR, party name, advocate name, FIR, case
> number, filing number, act), cause lists, the court-establishment directory
> (state → district → establishment), and order/judgment retrieval, for
> **District & Sessions Courts ⟨and High Courts, if applicable⟩** across
> **⟨pan-India / list your states⟩**.
>
> **Expected usage.** Approximately **⟨N⟩** lookups/day, growing with our advocate
> user base of **⟨M⟩** users. We will honour all rate limits and access terms.
>
> **Data handling.** We process case data solely to display it to the advocate to
> whom the matter belongs, consistent with the Digital Personal Data Protection
> Act, 2023. Our Privacy Policy and Data Processing Agreement are attached.
>
> We will complete any onboarding, sign any usage agreement, and provide further
> documentation as required. Kindly advise the process and requirements.
>
> Sincerely,
> **⟨Authorised signatory name⟩**, **⟨designation⟩**
> ⟨Registered entity name⟩
> Registration/GSTIN: **⟨number⟩** · Address: **⟨registered address⟩**
> Email: **support@sirahdigital.in** · Phone: **⟨phone⟩**
>
> *Attachments: PRIVACY_POLICY.pdf, DATA_PROCESSING_AGREEMENT.pdf*

---

## 5b. Short API Setu cover email / portal message

Use this when registering on API Setu (`apisetu.gov.in`) or emailing their
support to ask which eCourts services are available:

> **Subject:** API access request — eCourts case-status services (LexDraft, legal-tech)
>
> Hello,
>
> We operate **LexDraft**, a practice-management application for advocates in
> India (contact: support@sirahdigital.in). We would like to integrate eCourts
> case-information services via a sanctioned API.
>
> Could you please advise whether the following are available through API Setu,
> and the onboarding steps:
> • Case status search (CNR, party name, advocate name, FIR, case number, filing
>   number, act)
> • Cause lists and the court-establishment directory (state → district →
>   establishment)
> • Order/judgment retrieval
>
> Scope: District & Sessions Courts ⟨and High Courts⟩, ⟨pan-India / states⟩.
> Expected volume: ⟨N⟩ lookups/day. We will comply with all usage terms and can
> provide our organisation KYC, Privacy Policy and Data Processing Agreement.
>
> Thank you,
> ⟨Name⟩, ⟨designation⟩ — ⟨entity⟩ · support@sirahdigital.in · ⟨phone⟩

---

## 6. Checklist

- [ ] Register organisation on **API Setu** (`apisetu.gov.in`)
- [ ] Search API Setu for existing eCourts / case-status APIs
- [ ] If not present, send the §4 letter to the **eCommittee**
- [ ] Attach `PRIVACY_POLICY.md` + `DATA_PROCESSING_AGREEMENT.md`
- [ ] Provide technical contact for credential delivery
- [ ] On credentials: swap `courtEstWebService` + search calls to the official
      endpoint (client already carries the correct param names)
