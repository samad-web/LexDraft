"""Affidavit of Surety — the long statutory affidavit a surety swears to stand
surety for an accused released on bail (the Rule-14 particulars form).

A person offering to stand surety for an accused files this affidavit: it recites
the cause, offers the deponent as surety for the named accused (with the sections
charged and the bail sum ordered), and then sets out the detailed A-G particulars
of the surety (name, occupation, property, income, relationship to the accused
etc.), the proof documents produced, and the prayer + jurat. This is the advocate's
4-page form (07_Affidavit_of_Surety.pdf). Most of it is a FIXED questionnaire the
surety completes by hand; the pipeline autofills only the top particulars (court,
crime no., parties, accused / sections / bail sum in clause 1) when the case
supplies them.

FILL-IN COURT FORM (like the other advocate forms): nothing is a hard requirement.
The fixed clauses/questionnaire always render; the particulars fill from the case
when known and render as the form's blank fill-in line otherwise — never refuses.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal
from ._court import (bare_name, bare_parentage, bare_station, bare_sum,
                     designation_and_place, split_crime, sum_in_words)

TEMPLATE = "affidavit_of_surety.docx"
SPEC = "tn-affsurety"


@dataclass(frozen=True)
class AffidavitOfSuretyResult:
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
    state_name: str = "",
    police_station: str = "",
    accused_name: str = "",
    # clause 1 particulars (autofilled from the case when known):
    offence_sections: str = "",     # sections the accused is charged under
    bail_sum: str = "",             # bail sum in figures (Rs)
    bail_sum_words: str = "",       # bail sum in words
    bail_order_date: str = "",      # date the bail was ordered
    # the surety (deponent) — usually filled by hand, but accepted if supplied:
    surety_name: str = "",
    surety_parentage: str = "",
    surety_age: str = "",
    surety_address: str = "",
    place: str = "",
    filing_date: Optional[date] = None,
    accused_parentage: str = "",
    surety_occupation: str = "",
    property_particulars: str = "",
) -> AffidavitOfSuretyResult:
    """Assemble the Affidavit of Surety. Never refuses — renders blanks for
    anything not supplied, so it drafts complete-with-gaps for the surety."""

    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None
    filing_year = str(filing_date.year) if filing_date else None

    court_name_clean, court_at = designation_and_place(court_name, court_place)
    # "Crime No. 310 of 2026" -> number "310", year "2026" (the form prints both).
    crime_no, of_year = split_crime(crime_no)
    _y = (crime_year or of_year or "").strip()
    crime_year_full = (_y if len(_y) == 4 else ("20" + _y.zfill(2))[-4:]) if _y else ""

    context: Dict[str, Any] = {
        "court_name": court_name_clean,
        "court_place": court_place,
        "court_at": court_at,
        "case_ref": case_ref,
        "crime_no": crime_no,
        "crime_year": crime_year_full,
        "state_name": state_name,
        "police_station": bare_station(police_station),
        "accused_full": accused_name,
        "accused_name": bare_name(accused_name),  # the form prints "Mr"
        "accused_parentage": bare_parentage(accused_parentage),
        "surety_occupation": surety_occupation,
        "property_particulars": property_particulars,
        "offence_sections": offence_sections,
        "bail_sum": bare_sum(bail_sum),
        "bail_sum_words": bail_sum_words or sum_in_words(bail_sum),
        "bail_order_date": bail_order_date,
        "surety_name": surety_name,
        "surety_parentage": bare_parentage(surety_parentage),
        "surety_age": surety_age,
        "surety_address": surety_address,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return AffidavitOfSuretyResult(refused=False, context=context)
