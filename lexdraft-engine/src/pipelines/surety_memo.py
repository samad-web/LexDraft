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

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal

TEMPLATE = "surety_memo.docx"
SPEC = "tn-suretymemo"


def _dedupe_court(court_name: str) -> str:
    """The fixed heading already says "IN THE COURT OF" and ends in "MAGISTRATE";
    the case court name is inserted between. Strip a leading "(In the) Court of
    (the)" and the "Magistrate" phrase / redundant "Court" so a case court like
    "Judicial Magistrate First Class Court, Chennai" doesn't double the heading.
    Returns the distinguishing remainder (e.g. "First Class, Chennai"), or "" when
    nothing distinguishing remains."""
    s = (court_name or "").strip()
    if not s:
        return ""
    s = re.sub(r"^\s*(in\s+the\s+)?court\s+of\s+(the\s+)?", "", s, flags=re.I)
    s = re.sub(r"\b(chief\s+)?(judicial|metropolitan)?\s*magistrate('s)?\b", "", s, flags=re.I)
    s = re.sub(r"\bcourt\b", "", s, flags=re.I)
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ,-")
    return s


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
) -> SuretyMemoResult:
    """Assemble the Surety Memo. Never refuses — renders blanks for anything not
    supplied, so it drafts complete-with-gaps for the advocate to finish."""

    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None
    filing_year = str(filing_date.year) if filing_date else None

    # De-duplicate the court name against the fixed "... MAGISTRATE" heading.
    court_name_clean = _dedupe_court(court_name)
    # "AT <place>" — drop when the place already appears in the (cleaned) court name.
    cp = (court_place or "").strip()
    court_at = cp if (cp and cp.lower() not in court_name_clean.lower()) else ""

    # Normalise the crime year to a FULL 4-digit year for the "Crime No. __ of
    # <year>" line ("26" -> "2026"; "2026" -> "2026"; blank -> "202__").
    _y = (crime_year or "").strip()
    if _y:
        crime_year_full = _y if len(_y) == 4 else ("20" + _y.zfill(2))[-4:]
    else:
        crime_year_full = ""

    context: Dict[str, Any] = {
        "court_name": court_name_clean,
        "court_place": court_place,
        "court_at": court_at,
        "case_ref": case_ref,
        "crime_no": crime_no,
        "crime_year": crime_year_full,
        "state_name": state_name,
        "police_inspector": police_inspector,
        "accused_name": accused_name,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return SuretyMemoResult(refused=False, context=context)
