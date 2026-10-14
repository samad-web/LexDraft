# Fact Sheet — Regular Bail Application

Fill this from a real closed matter. Every field the engine needs is below. Write
in plain words; the engineer converts it. **Redact as the runbook says** — use the
placeholders (ACCUSED-1, etc.), not real names.

Leave a field blank only if it is marked *(optional)*. If a *(required)* field
does not apply to your matter, this may not be a regular-bail matter — say so.

---

## The accused

| Field | Your answer | What it means |
|---|---|---|
| Accused name *(required)* | | Use the redaction placeholder, e.g. `ACCUSED-1`. |
| Age *(required)* | | Age in years. |
| Occupation *(required)* | | e.g. driver, farmer, businessman. |
| Address *(required)* | | Redacted — e.g. `ADDRESS-1, CITY-1`. |
| In which prison *(required)* | | Where the accused is presently confined. |

## The crime

| Field | Your answer | What it means |
|---|---|---|
| FIR / Crime number *(required)* | | Redacted placeholder, e.g. `FIR-1`. |
| Police station *(required)* | | Name of the station. |
| District *(required)* | | District of the offence. |
| Section(s) charged *(required)* | | e.g. "BNS 115, BNS 118". List all. |

## Dates — used to pick BNSS vs CrPC and to compute custody

> This is the part practitioners find fiddly. Three separate dates, and the engine
> uses each differently. Give your best dates from the file.

| Field | Your answer | What it means |
|---|---|---|
| Date of offence *(required)* | | When the offence is alleged to have happened. Fixes IPC vs BNS. |
| Date this proceeding started *(required, unless fresh)* | | When the case/investigation began. Blank only if this is a brand-new filing on old facts. |
| Is this a fresh filing? *(required)* | Yes / No | "Yes" if you are filing this bail as a new move, not continuing a pending proceeding. |
| In custody since *(required)* | | Date first remanded to custody (not arrest, if different). |
| Compute custody as on *(required)* | | The date you filed the bail application. Custody days are counted to here. |

## Investigation

| Field | Your answer | What it means |
|---|---|---|
| Charge sheet filed? *(required)* | Yes / No | Has the final report been filed? |
| Court level *(required)* | Magistrate / Sessions / High Court | Which court this application goes to. |

## Special statute (NDPS / PMLA / UAPA) — leave blank if none

| Field | Your answer | What it means |
|---|---|---|
| Special statute *(optional)* | NDPS / PMLA / UAPA / (blank) | Only if the offence is under one of these. |
| Did the application address the bail bar? *(required if statute above)* | Yes / No | Whether the draft argues the statutory bail conditions head-on. |

## Successive application — leave blank if this is the first

| Field | Your answer | What it means |
|---|---|---|
| Is this a successive application? *(required)* | Yes / No | Has a bail application been made and refused before? |
| Prior order reference *(required if successive)* | | The earlier order, e.g. `CRLMP-1 dismissed on DATE-1`. |
| Change of circumstance *(required if successive)* | | What has changed since the refusal. |

## Parity — leave blank if not claiming parity

> One row per co-accused already released. Each MUST have an order reference, or
> the engine refuses that claim.

| Co-accused (redacted) | Order reference |
|---|---|
| | |

## Narrative (the advocate/model writes these — paste the filed wording)

| Field | Your answer | What it means |
|---|---|---|
| Prosecution case in brief | | As per the FIR, neutral. Paste what was actually pleaded. |
| Grounds | | The bail grounds as pleaded. |

## Filing

| Field | Your answer | What it means |
|---|---|---|
| Place *(required)* | | Place of filing/signing. |

---

### Notes for engineering (awkwardness observed)

- **The three-date block is the sharpest edge.** "Date of offence" vs "date this
  proceeding started" vs "in custody since" vs "compute as on" is four dates, and a
  non-lawyer filling this will conflate arrest with remand and offence-date with
  FIR-date. A form should ask these as a guided sequence with examples, not a flat
  table. This is a real signal about the frontend.
- **`is_fresh_action` is jargon.** Phrased here as "Is this a fresh filing?" but it
  still needs the one-line gloss to be usable. The router's mental model
  (substantive vs procedural framework) never surfaces to the filler — good.
- **Special-statute → bail-bar-addressed coupling** is a conditional the flat form
  can't enforce; a real form must show the second field only when the first is set.
