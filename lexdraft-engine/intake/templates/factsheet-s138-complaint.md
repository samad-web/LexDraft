# Fact Sheet — Section 138 NI Act Complaint

Fill from a real closed cheque-bounce complaint. **Redact per the runbook.** Blank
only where marked *(optional)*.

> This is the highest-risk document. The engine is strict about the dates and the
> service of notice — give the file's actual dates.

---

## Complainant

| Field | Your answer | What it means |
|---|---|---|
| Complainant name *(required)* | | Redacted, e.g. `COMPLAINANT-1`. |
| Is the complainant a company? *(required)* | Yes / No | |
| Authorised representative *(required if company)* | | Who represents the company. |
| Board resolution / authority reference *(optional)* | | The authorisation document. |
| Is the complainant the payee/holder? *(required)* | Yes / No | Must be "Yes" — the payee or holder in due course. |

## Accused

| Field | Your answer | What it means |
|---|---|---|
| Accused name *(required)* | | Redacted, e.g. `ACCUSED-1`. |
| Is the accused a company? *(required)* | Yes / No | If yes, the s.141 averment below is mandatory. |
| s.141 averment *(required if company accused)* | | The averment that the named person(s) were "in charge of and responsible for the conduct of the business at the relevant time". Paste the filed wording. Missing → refuse. |

## The cheque(s)

> One block per cheque. Multi-cheque complaints are allowed.

| Field | Your answer | What it means |
|---|---|---|
| Cheque number *(required)* | | Redacted if needed, e.g. `CHEQUE-1`. |
| Cheque date *(required)* | | Date on the cheque. |
| Amount *(required)* | | In rupees. |
| Bank | | Drawee bank. |
| Branch | | Branch. |
| Drawer | | Who signed the cheque. |
| Payee | | To whom payable. |

## Presentation and dishonour — the date chain

> The engine checks: presentation within cheque validity; notice within 30 days of
> **memo receipt**; complaint within one month of the cause of action.

| Field | Your answer | What it means |
|---|---|---|
| Presentation date *(required)* | | When the cheque was presented to the bank. |
| Memo date *(required)* | | Date on the bank's dishonour memo. |
| Memo received date *(required)* | | When your client **received** the memo. This, not the memo date, starts the 30-day clock. |
| Dishonour reason *(required)* | | The reason **as written on the memo**, verbatim (e.g. "Funds insufficient"). |

## Statutory notice and its service

| Field | Your answer | What it means |
|---|---|---|
| Notice date *(required)* | | Date of the s.138 demand notice. |
| Notice dispatch date *(required)* | | When the notice was dispatched. |
| Notice delivery date *(required, unless refused/unclaimed)* | | When it was delivered. Blank only if refused/unclaimed below. |
| Was the notice refused? *(required)* | Yes / No | Returned "refused". |
| Was the notice unclaimed? *(required)* | Yes / No | Returned "unclaimed". |
| Deemed delivery date *(required if refused/unclaimed)* | | The date deemed served. Cause of action still runs from here. |
| Deemed-service averment *(required if refused/unclaimed)* | | The pleaded averment that the notice is deemed served. |

## Filing and jurisdiction

| Field | Your answer | What it means |
|---|---|---|
| Filing date *(required)* | | When the complaint was filed. |
| Is the payee's bank branch in this court's territory? *(required)* | Yes / No | Must be "Yes" (s.142(2)). |
| Jurisdiction basis *(required)* | | The pleaded jurisdiction ground. |

## Narrative (paste the filed wording)

| Field | Your answer | What it means |
|---|---|---|
| Legally enforceable debt narrative | | The debt/liability the cheque discharged. |

## Filing

| Field | Your answer | What it means |
|---|---|---|
| Place *(required)* | | Place of filing/signing. |

---

### Notes for engineering (awkwardness observed)

- **Two date chains** (presentation→memo→memo-receipt, and notice→dispatch→delivery)
  with a conditional deemed-service fork. This is the most date-heavy intake of the
  three and the memo-**date** vs memo-**receipt-date** distinction is subtle — a
  filler will reach for the memo date. The gloss helps but a form should ask
  "When did your client physically receive the dishonour memo?" not "memo_received_date".
- **The refused/unclaimed → deemed-delivery fork** is three coupled fields that only
  appear together. Flat form can't gate them; a real form must.
- **Multi-cheque is a repeating block** — same structured-sub-record problem as the
  plaint's acknowledgements. Recurring theme across all three templates: the flat
  intake form cannot express "0..n structured sub-records", and every one of our
  documents has at least one.
