"""Batta Witness — Application for issue of Process and Deposit of witness Batta.

A party to a suit applies to the court to issue process (summons/notice/warrant/
subpoena) on the opposite party or on witnesses, and deposits the witness batta
(travelling allowance, subsistence and process fees) so the process can be served.
This is the WIDE TABULAR form (the advocate's 05_Batta_Witness.pdf): a header block
(court, O.S. No., parties, value of claim, court day) and a 10-column schedule —
nature of process, description of the person, place of service, distance, travelling
allowance (Rs/P), class of allowance, amount (Rs/P), number of days, process fees
(Rs/P), and remarks. The form is generalised for any state/court — court name and
place are placeholders.

FILL-IN COURT FORM (like affidavit of service / copy application / call for memo):
nothing is a hard requirement. A missing value renders as the form's blank cell /
line for the advocate to autofill from the case or complete by hand — the pipeline
never refuses. PARTY-FILED.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal

TEMPLATE = "batta_witness.docx"
SPEC = "tn-batta"


@dataclass(frozen=True)
class BattaRow:
    """One row of the batta schedule. Every field optional (fill-in form)."""
    nature_of_process: str = ""          # col 1: nature of process + section of law
    person_description: str = ""         # col 2: person on/against whom process issues
    place_of_service: str = ""           # col 3: municipal division / place
    distance_miles: str = ""             # col 4: distance in miles from court house
    travelling_allowance: str = ""       # col 5: TA for journey to & from court (Rs/P)
    class_of_allowance: str = ""         # col 6: class of allowance
    amount: str = ""                     # col 7: amount (Rs/P)
    for_how_many_days: str = ""          # col 8: for how many days
    process_fees: str = ""               # col 9: process fees (Rs/P)
    remarks: str = ""                    # col 10: remarks


@dataclass(frozen=True)
class BattaWitnessResult:
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
    os_no: str = "",
    os_year: str = "",
    plaintiff_name: str = "",
    defendant_name: str = "",
    applicant_role: str = "",            # "Plaintiff" or "Defendant" (who applies)
    value_of_claim: str = "",
    court_day: str = "",
    rows: Sequence[BattaRow] = (),
    place: str = "",
    filing_date: Optional[date] = None,
) -> BattaWitnessResult:
    """Assemble the Batta Witness application. Never refuses — renders blanks for
    anything not supplied, so it drafts complete-with-gaps for the advocate."""

    # Heading "AT <place>" — drop it when the place already appears IN the court
    # name (avoids "... Court, Chennai AT Chennai"). Only shown when it adds info.
    court_at = ""
    cp = (court_place or "").strip()
    if cp and cp.lower() not in (court_name or "").lower():
        court_at = cp

    # Date parts for "on this the <day> day of <month> <year>". None -> the
    # template prints the blank fill-in lines (advocate fills, or a date on record
    # fills automatically).
    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None
    filing_year = str(filing_date.year) if filing_date else None

    row_ctx: List[Dict[str, Any]] = []
    for r in (rows or ()):
        row_ctx.append({
            "nature_of_process": r.nature_of_process,
            "person_description": r.person_description,
            "place_of_service": r.place_of_service,
            "distance_miles": r.distance_miles,
            "travelling_allowance": r.travelling_allowance,
            "class_of_allowance": r.class_of_allowance,
            "amount": r.amount,
            "for_how_many_days": r.for_how_many_days,
            "process_fees": r.process_fees,
            "remarks": r.remarks,
        })
    # When NOTHING was extracted, still give the advocate a set of blank ruled rows
    # to hand-enter witnesses/process into (Word grows each cell as they type, and
    # Tab adds more rows). Matches the printed form's tall writable area.
    _BLANK_ROWS = 4
    if not row_ctx:
        empty = {k: "" for k in (
            "nature_of_process", "person_description", "place_of_service",
            "distance_miles", "travelling_allowance", "class_of_allowance",
            "amount", "for_how_many_days", "process_fees", "remarks")}
        row_ctx = [dict(empty) for _ in range(_BLANK_ROWS)]

    context: Dict[str, Any] = {
        "court_name": court_name,
        "court_place": court_place,
        # "AT <place>" for the heading — empty when redundant with the court name.
        "court_at": court_at,
        "case_ref": case_ref,
        "os_no": os_no,
        "os_year": os_year,
        "plaintiff_name": plaintiff_name,
        "defendant_name": defendant_name,
        # Which side applies ("Plaintiff - Defendant" strikeout on the form).
        "applicant_role": applicant_role,
        "value_of_claim": value_of_claim,
        "court_day": court_day,
        "rows": row_ctx,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
        "case_year": filing_date.year if filing_date else None,
    }
    return BattaWitnessResult(refused=False, context=context)
