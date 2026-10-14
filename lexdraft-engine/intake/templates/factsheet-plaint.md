# Fact Sheet — Plaint (Money Recovery)

Fill from a real closed money-recovery suit. **Redact per the runbook** — use
placeholders, not real names/numbers. Blank only where marked *(optional)*.

---

## Parties

| Field | Your answer | What it means |
|---|---|---|
| Plaintiff name *(required)* | | Redacted, e.g. `PLAINTIFF-1`. |
| Defendant name(s) *(required)* | | One or more, e.g. `DEFENDANT-1; DEFENDANT-2`. |
| Party type *(required)* | individual / partnership / company / government / minor | Governs the skeleton. |

## The claim — money

> The engine recomputes the arithmetic. Principal + interest must equal the total,
> or it refuses. Give the figures as filed.

| Field | Your answer | What it means |
|---|---|---|
| Principal *(required)* | | The sum lent/owed, in rupees. |
| Interest amount *(required)* | | Total interest claimed, in rupees. |
| Total claimed *(required)* | | Must equal principal + interest. |
| Interest rate *(required)* | | e.g. 18 (percent per year). |
| Is the interest contractual? *(required)* | Yes / No | "Yes" if a document fixes the rate. |
| Interest document reference *(required if contractual)* | | e.g. `loan agreement dated DATE-1, clause 4`. Blank → engine falls back to statutory interest and says so. |

## Cause of action — date AND place both required

| Field | Your answer | What it means |
|---|---|---|
| Cause of action date *(required)* | | When the right to sue arose. |
| Cause of action place *(required)* | | Where it arose. Missing either → refuse. |

## Jurisdiction — both limbs

| Field | Your answer | What it means |
|---|---|---|
| Forum *(required)* | district munsif / subordinate judge / district court / city civil / high court OS | The court, by pecuniary limit. |
| Territorial basis *(required, one or more)* | defendant resides / defendant business / cause wholly arose / cause part arose | Why this court has territorial jurisdiction (s.20 CPC). |

## Limitation

| Field | Your answer | What it means |
|---|---|---|
| Limitation article *(required)* | | Schedule article, e.g. `19`. |
| Trigger date *(required)* | | When time began to run. |
| Filing date *(required)* | | When the plaint was filed. |
| Acknowledgements *(optional)* | | Any written, signed acknowledgement(s) of the debt that restart limitation: date + whether written + signed. One per line. |

## Statutory notices — leave blank if not applicable

| Field | Your answer | What it means |
|---|---|---|
| Is the defendant Government? *(required)* | Yes / No | Triggers the s.80 CPC notice requirement. |
| s.80 CPC notice reference *(required if Government)* | | e.g. `notice dated DATE-1 served on the Collector`. |
| Is this a commercial suit? *(required)* | Yes / No | Triggers s.12A mediation + statement of truth. |
| s.12A reference *(required if commercial)* | | Mediation certificate or a pleaded exemption. |

## Narrative (paste the filed wording)

| Field | Your answer | What it means |
|---|---|---|
| Transaction narrative | | How the relationship arose. |
| Performance narrative | | Performance by the plaintiff. |
| Default narrative | | Default by the defendant. |
| Legal notice narrative | | The pre-suit notice and reply. |

## Filing

| Field | Your answer | What it means |
|---|---|---|
| Place *(required)* | | Place of filing/signing. |

---

### Notes for engineering (awkwardness observed)

- **Three amount fields with an equality constraint** (principal + interest =
  total) is fine on paper but a live form should compute the total, not ask for it
  and then reject a mismatch. Asking for it invites the exact mismatch the engine
  refuses on.
- **Forum and territorial-basis vocabularies are engine enums in disguise.** A
  filler must pick from an exact list; free text won't map. A real form needs these
  as dropdowns with plain-language labels ("City Civil Court, Chennai"), not the
  enum tokens shown here.
- **Acknowledgements are three sub-fields each (date/written?/signed?)** but there's
  no clean way to express that in a flat table — flagging that repeating structured
  sub-records are a form-design requirement, not an afterthought.
