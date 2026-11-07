"""Surety Memo — a short memo submitting that sureties are furnished for an accused
so the accused may be released on bail.

After bail is granted, the accused (through counsel) files this memo stating that
the sureties ordered by the court are being furnished, and prays that they be
accepted and the accused released on bail. This is the advocate's short standard
form (06_Surety_Memo.pdf): a Magistrate cause title, the Crime number ("on the file
of the Respondent"), the parties (State / Inspector of Police vs Accused), the
"SURETY MEMO" heading, the single submission clause, the date line, and the counsel
signature. The form is generalised for any state/court — court name and place are
placeholders. Criminal context. PARTY-FILED (Counsel For Petitioner / Accused).

FILL-IN COURT FORM (like the other advocate forms): nothing is a hard requirement.
The verbatim clause always renders; the particulars (court, Crime No., State/
Inspector, accused, dates) fill from the case when known and render as the form's
blank fill-in line otherwise — the pipeline never refuses.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Mapping, Optional, Sequence

from ..verify.refusals import Refusal
from ._court import bare_station, bare_sum, designation_and_place, split_crime

TEMPLATE = "surety_memo.docx"
SPEC = "tn-suretymemo"


@dataclass(frozen=True)
class SuretyMemoResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def build(
    *,
    # All optional — fill-in court form; a missing value renders the form's blank.
    court_name: str = "",
    court_place: str = "",
    case_ref: str = "",
    crime_no: str = "",
    crime_year: str = "",
    # complainant side: the State + the Inspector of Police / police station
    state_name: str = "",
    police_inspector: str = "",
    accused_name: str = "",
    place: str = "",
    filing_date: Optional[date] = None,
    police_station: str = "",
    sureties: Sequence[Mapping[str, Any]] = (),   # {name, address, amount}
    documents: Sequence[str] = (),                # property documents / ID proofs produced
) -> SuretyMemoResult:
    """Assemble the Surety Memo. Never refuses — renders blanks for anything not
    supplied, so it drafts complete-with-gaps for the advocate to finish."""

    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None
    filing_year = str(filing_date.year) if filing_date else None

    court_name_clean, court_at = designation_and_place(court_name, court_place)
    # "Crime No. 310 of 2026" -> number "310", year "2026" (the form prints both).
    crime_no, of_year = split_crime(crime_no)
    # Normalise the crime year to a FULL 4-digit year ("26" -> "2026").
    _y = (crime_year or of_year or "").strip()
    crime_year_full = (_y if len(_y) == 4 else ("20" + _y.zfill(2))[-4:]) if _y else ""
    if not police_inspector.strip() and bare_station(police_station):
        police_inspector = bare_station(police_station) + " Police Station"

    context: Dict[str, Any] = {
        "court_name": court_name_clean,
        "court_place": court_place,
        "court_at": court_at,
        "case_ref": case_ref,
        "crime_no": crime_no,
        "crime_year": crime_year_full,
        "state_name": state_name,
        "police_inspector": police_inspector,
        "sureties": [{"name": x.get("name") or "", "address": x.get("address"),
                      "amount": bare_sum(x.get("amount")) or None} for x in sureties],
        "documents": [d for d in documents if d.strip()],
        "accused_name": accused_name,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return SuretyMemoResult(refused=False, context=context)
