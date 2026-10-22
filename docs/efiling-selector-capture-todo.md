# eFiling 3.0 (filing.ecourts.gov.in) — portal map and capture plan

Companion to `apps/api/src/services/efiling-live.service.ts`. Records what is known
about the National eFiling portal, where each fact came from, and what still has to be
captured from a real logged-in advocate session before `openNewFiling` /
`uploadFilingDocument` can be implemented.

Legend: **[live]** = observed on the public portal (2026-10-19) ·
**[manual]** = official eFiling 3.0 user manual (e-Committee, as hosted by Jharkhand HC) ·
**[guess]** = inferred, must be confirmed in a logged-in session.

---

## 1. Platform

- Classic server-rendered PHP app under `/pdedev/`, front-controller routing via
  `?p=<module>` (e.g. `?p=registration`, `?p=otherPages/siteMap`). **[live]**
- jQuery + Bootstrap 5 + jQuery Validate + `chosen` (searchable selects) +
  `jquery.steps` (the tabbed filing wizard). **[live]**
- AJAX endpoints are relative paths such as `login/verify_login/`,
  `login/generate_otp`, which return JSON. **[live]**
- CAPTCHA: Securimage (`/pdedev/securimage/securimage_show.php`), the same as the
  case-status site. There are 3 widgets on the login page: `#captcha_image` (login),
  `#captcha_image1` (duplicate login), `#captcha_image2` (forgot password). **[live]**
- Separate legacy portal `efiling.ecourts.gov.in` (eFiling 2.x, wizard:
  Petitioner → Respondent → Extra info → Extra parties → Case details → Act/Section →
  Signing method → Upload → Court fee → Affirmation OTP → Advocate OTP → View →
  Final submit). **Do not mix its flow up with 3.0.**

## 2. Login protocol **[live]** (from `/pdedev/js/login1.js`)

```
POST /pdedev/login/verify_login/   (form-urlencoded)
  user_state     = #selState value (numeric state code)
  user_name      = #user_name
  user_password  = sha256( sha256(password) + sha256(temp_gennum) )   // hex digests
  user_type      = rdoUser value: 1 advocate, 2 litigant, 3 pleader, 4 clerk,
                   6 institutional litigant (#user_insurance),
                   7 court nominated officials (#user_gov_auth)
  user_lang      = rdoLang (English / Marathi)
  temp_gennum    = hidden #gennum (server nonce, rotated on every failure)
  fcaptcha_code  = #fcaptcha_code_mobile

→ JSON { status, redirect_path?, errorMsg?, gennum?, duplicate_login? }
  success:  status === true && redirect_path → window.location = redirect_path
  failure:  new gennum returned; errorMsg rendered into #msg-danger4
  duplicate_login flag drives the "already login… CLICK HERE" → #frm_duplicate_login path
```

Implications:
- The password never leaves the browser in plain text. The nonce-salted hash is
  single-use, so replaying a captured POST will fail.
- A pure-HTTP client (no Playwright) is technically possible for login. It would
  still need the CAPTCHA solved by the human, plus the session cookie. Not
  worth it until the post-login flow is mapped; Playwright stays.
- Alternative login: Parichay / Meri Pehchaan / JanParichay SSO. Not supported.

## 3. Post-login structure **[manual]**

Dashboard tiles: Draft Pleadings · Completed Pleadings · Draft IAs · Completed IAs ·
Objections · My Cases. Advocate main menu:

| Menu | Sub-items |
|---|---|
| My Partners | Add / Accept / Revoke / Accept Revocation / Report (all OTP-confirmed) |
| Case Filing | **New Case Filing**, Manage Favourite Clients |
| Vakalat | Assign Partners to Case → (litigant: Offer to Advocate, OTP) → Accept Offer (OTP) → Print Vakalat (.odt) |
| Pleadings | Use Templates (.odt), **Pleadings** (Upload / Indexing / eSign tabs), Record Oath (webcam) |
| e-Payments | Payments (via pay.ecourts.gov.in → GRN), Court Fee Wallet (per establishment) |
| Applications | IA Filing (Applications / Pay Fees from wallet / Authentication OTP), Submitted Applications |
| Portfolio | Search Cases (CNR / advanced), My Cases, Import/Export, Delete, Planner |

### 3.1 New Case Filing wizard (jquery.steps tabs)

1. **Initial Inputs**: court level (HC / district) → State → District → Establishment
   (cascading selects) · Case Type (MVC adds a tab) · client/party details →
   Submit → "New Case Added" + **temporary eFiling number**.
2. **Litigant**: per party: Type (Appellant/Respondent), personal, contact, state,
   Other Information, Organization toggle, Legal-Heir toggle, local-language fields,
   Add to Favourites → **Update** (repeat per party) → Next. "View Previous Parties" link.
3. **Legal Heir**: only if the toggle is set.
4. **Fact Details**: repeatable {date, time HH:MM, text} ("Add More Fact") → Save.
5. **Case Details**: Cause of action + date, Important info/Subject, Prayer,
   Valuation, Plaint (local language), Dispute arising out of, Act(s)/Section(s)
   ("More Acts"), Hide Party (POCSO/matrimonial) → Save.
6. **MVC**: MVC case types only. Police station/FIR, accident, claim, vehicle.
7. **e-File**: read-only review → **eFile Case** (irreversible) → "Case registration
   is Successful" + eFiling registration number.

Draft cases can be Edited/Deleted/PDF'd from buttons top-right of Case Filing.

### 3.2 After registration (separate menus, keyed by eFiling number)

`Vakalat` → `Pleadings › Pleading Upload` (named PDF, Add File, Submit; merge;
indexing of page ranges) → `Pleading eSign` (authorize signatories; Aadhaar eSign via
C-DAC redirect **or** OTP) → `Record Oath` → `e-Payments` (GRN) →
**Dashboard › Draft Pleadings → select GRN → Submit** (final submission; advocate,
GP or party-in-person only) → court scrutiny → `Objections` / `Completed Pleadings ›
View Status`.

Rules from state SOPs: upload size up to 50 MB per file (legacy-portal guide; confirm
for 3.0). Court fee is online-only through ePay with GRN, and the court defaces it at
scrutiny. Several HCs still require physical copies on the same day.

## 4. What LexDraft can and cannot automate

| Step | Automatable? | Why |
|---|---|---|
| Login | Yes (done) | Human types CAPTCHA |
| Wizard tabs 1–6 | Yes, once selectors captured | Pure form fill from LexDraft case data |
| Tab 7 "eFile Case" | Only with explicit advocate confirmation | Irreversible |
| Pleading upload / merge / index | Yes, once captured | LexDraft already has the PDFs (`storage.pdf_key`) |
| eSign (Aadhaar) | **No** | C-DAC redirect + Aadhaar OTP to the advocate's phone |
| OTP steps (vakalat, signatories, IA auth) | Relay only | OTP goes to the advocate/litigant's phone; the human must type it |
| Oath recording | **No** | Webcam video of the person |
| Court-fee payment | **No** | Bank/UPI gateway, GRN back to portal |
| Final submit | Only with explicit confirmation | Legal filing |

The realistic product: LexDraft pre-fills tabs 1–6 and uploads the PDFs. It then hands
off at eSign, payment and final submit, and later polls Draft Pleadings, Objections and
Completed Pleadings for status.

## 5. Capture plan (needs one real advocate account)

Do this as a human in a normal browser with DevTools recording (HAR + "Preserve log"),
using a **dummy draft that is deleted at the end**. Never click *eFile Case* or *Submit*.

1. Login → save the dashboard HTML. Record `redirect_path` and the menu link `?p=` routes.
2. Case Filing › New Case Filing: for each tab save the DOM (`copy(document.documentElement.outerHTML)`)
   and every XHR (cascading-select endpoints such as district→establishment and
   case-type lists, plus each tab's save endpoint and its response with the temp eFiling no).
3. Record field `id`/`name`, mandatory markers, and option value sets for: court level,
   state, district, establishment, case type, party type, act/section pickers.
4. Edit → Delete the draft to confirm cleanup works.
5. Pleadings › Pleading Upload on a throwaway PDF: capture the multipart upload request,
   size/type errors, and the delete call.
6. Save everything under `docs/efiling-capture/<date>/`, with mobile numbers, names,
   tokens and cookies **redacted**, before committing.

Then implement `openNewFiling` (tabs 1–6, stops before tab 7) and `uploadFilingDocument`
against the captured selectors, each with a status check that the step actually saved.

## 6. What LexDraft does today (migration 0086)

- **Particulars** (`case_filing_particulars`, `case_filing_parties`, `case_facts`):
  everything wizard tabs 1–6 ask for, kept apart from the eCourts-synced tables.
  The data is pre-filled from the matter. `lib/efiling/readiness.ts` reports what the
  portal would reject.
- **Filings** (`efiling_filings` + events/documents/payments): draft → ready →
  submitted → objected/refiled → accepted → registered. eFiling no., GRNs,
  objections and the portal-only steps are recorded by the advocate.
- **Bundle** (`efiling-bundle.service.ts`): merged PDF behind an index page with
  continuous page numbers and per-document bookmarks. The size is checked against the
  50 MB limit, which is still unconfirmed for 3.0.
- **Connecting to eCourts** (`efiling-tracker.service.ts`): this runs after each 09:00 and
  19:00 IST eCourts sync. It finds the registered case by court filing number, or by
  party name narrowed on both sides. One match links the matter through the normal
  eCourts link/sync. Several matches are handed to the advocate. It uses a circuit
  breaker and retries every 30 min, and sends one in-app summary per advocate per slot.
- **Login fixes**: portal-only states, session closed on sign-out/unmount, no
  logging of the `verify_login` body.

## 7. Still open

- The post-login wizard selectors are not yet captured (§5), so LexDraft prepares the data
  and the bundle and the advocate keys it into the portal.
- The portal case-type master may differ from eCourts'. Both code and name are stored.
- Parichay / Meri Pehchaan SSO login is not supported.
- Import/export of the eCourts app's case file is not supported: no sample of the format yet.
- Clerk-style prepare-only access: writes need `matter.create`, so Paralegal / Legal
  Secretary roles can view filings but not edit them. A dedicated `efiling.prepare`
  feature would need a role-features seed.
- The service spoofs `sec-ch-ua` and `navigator.webdriver` to get past the
  portal's automation detection. That is evading an access control on a government
  system, which is likely against the portal's terms. Get it reviewed (legal / NIC) before
  shipping. The cleaner route is the API access request in
  `docs/ecourts-official-api-access-request.md`, extended to eFiling.
