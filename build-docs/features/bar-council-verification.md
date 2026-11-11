# Bar Council verification at sign-up (approved 2026-11-11)

## Status
- Phase 1 built: council list, Tamil Nadu OTP check, onboarding + admin badge, migration 0102 (local only).
- Phase 2 built: live lookups for Karnataka, AP, Gujarat (lib/bar-council-lookups.ts); new status `inactive` (roll says died/retired/suspended/transferred/non-practice).
- Excluded: Kerala (directory refuses non-browser clients) and MP (firewall blocks automated requests) - not worked around; UP deferred (no result table seen for test numbers, HTTP only); Telangana skipped (robots.txt).
- Next: roll imports (Punjab & Haryana, J&K, Uttarakhand, Rajasthan).

## Purpose
- Confirm a signing-up advocate is really on a State Bar Council roll: their enrolment number exists and the name matches.
- User's choices (2026-11-11): automatic lookup (no manual review); unverified advocates can use the app with an "Unverified" badge.

## What research found (2026-11-11, read-only checks of official sites)
- No Bar Council of India API and no public national roll. BCI's own advocate search needs a BCI login and takes only the BCI number.
- Every council differs. Grouped by how we can check:

| Group | Councils | How |
|---|---|---|
| A. Live lookup from our server | Karnataka (JSON), Andhra Pradesh, Telangana (robots.txt says Disallow), Kerala (no date/status), Gujarat (JSON), Uttar Pradesh (HTTP only, ASP.NET), Madhya Pradesh (firewall blocked our test; retry from prod) | Server calls the council's search with the enrolment number |
| B. Advocate completes the council's check | Tamil Nadu & Puducherry (bctnpy.org: reCAPTCHA v3 + OTP to the searcher's mobile) | Our server opens the council page in a real browser (as TN Land Records does); the advocate types the OTP the council sends them; we read the result |
| C. Published roll imported into DifAi | Punjab & Haryana (roll PDFs), J&K & Ladakh (High Court PDFs), Uttarakhand (2026 enrolments only), Rajasthan (last ~3 enrolment batches only) | Scheduled import; store only enrolment no. + name |
| D. No online source at all | Maharashtra & Goa, Delhi, West Bengal, Odisha, Assam group (2019 list only), Meghalaya, Manipur, Tripura, Chhattisgarh, Himachal, Bihar, Jharkhand | Cannot be verified automatically by anyone. Stay "Unverified" |

## Architecture
- Onboarding (advocate): adds a required "State Bar Council" select next to the existing enrolment number (0097 already stores id_document_type/number + uploaded card).
- `bar-verification.service.ts`: `verify(userId)` → picks the council adapter → normalises the enrolment number → fetches → compares.
- One adapter per council in `lib/bar-councils/<council>.ts`: `lookup(enrolmentNo) → { name, enrolmentNo, enrolmentDate?, status? } | null`. Group C adapters read the imported table.
- Match rule: enrolment number equal after normalising (case, spaces, separators) AND name match (token overlap of the council name with the Google/profile name, initials allowed). Mismatch is not auto-rejected; it stays Unverified with the reason.
- Data (migration 0102, additive): `users.bar_council`, `bar_verification_status` (verified | not_found | name_mismatch | unavailable | unsupported | pending_otp), `bar_verified_at`, `bar_verification_source`, `bar_record jsonb` (name, number, date, status only). Table `bar_roll_entries (council, enrolment_no, name, imported_at)` for group C.
- Runs after onboarding submit, never blocks sign-up. `unavailable` (site down) retries via the existing pg-boss jobs. TN shows an OTP step in onboarding (skippable → Unverified).
- UI: "Verified advocate" / "Unverified" badge on the profile, Admin → Users column + filter, "Re-check" button for admin and advocate.

## Impact map
- `onboarding.routes/service`, `OnboardingView.tsx`: new field, TN OTP step.
- `admin.service.ts`, Admin `UsersView`: new columns.
- `jobs.service.ts`: retry + monthly roll import.
- Server browser (Playwright, already used by eFiling/eCourts/TN land) for TN.
- No change to Google/WhatsApp sign-in.

## Edge cases and failure modes
- Council site down / changed → `unavailable`, retried; an adapter that fails N times in a row alerts admin (portals change without notice).
- Transferred advocates (e.g. "U.P. 6598/1992" now in Uttarakhand) → advocate picks the council they are on now.
- Name differences (initials, father's name, "Adv.") → token match; ambiguous = Unverified with reason, never auto-banned.
- Someone types another advocate's number → name must match; TN path also ties to the advocate's own mobile.
- Privacy (DPDP): we send only the advocate's own number to their council, with consent text on the form; we store only name/number/date/status; roll imports keep no phones/addresses.
- Telangana robots.txt disallows bots; Gujarat's Cloudflare signals restrict AI use (plain lookups are not AI use).

## Acceptance criteria
- Each group-A adapter returns the right record for a known real enrolment number and null for a fake one (tests with recorded responses).
- Matching: exact/initials/reordered names pass; different person fails.
- Group-D councils show "Unverified — your Bar Council has no online roll" immediately, no network call.
- TN: OTP step works end-to-end on one real advocate (manual test).
- Onboarding never fails or slows because a council site is down.
- Admin sees status, source and time per user; Re-check works.

## Not possible / open
- 12 of ~24 councils (incl. Maharashtra, Delhi, West Bengal) have no online roll: no automatic check exists for them.
- No real positive response has been seen yet from any council. Needs one real enrolment number per council (public data) to build each adapter against.
