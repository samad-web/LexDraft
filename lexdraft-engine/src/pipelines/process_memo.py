"""Process Memo — a short memo praying the court to issue summons / warrant on the
opposite party at a stated address.

After a case is filed, the party (through counsel) files this memo asking the court
to issue its process — summons or warrant — on the named accused/petitioner at the
address for service given. This is the advocate's short standard form
(03_Process_Memo.pdf): a Magistrate cause title, the DVC/case number, the parties,
the "PROCESS MEMO" heading, the single prayer clause, the date line, the address
for service, and the counsel signature. The form is generalised for any state/court
— court name and place are placeholders. PARTY-FILED (by counsel for the petitioner).

FILL-IN COURT FORM (like the other advocate forms): nothing is a hard requirement.
The verbatim prayer always renders; the particulars (court, case no., parties,
address, date) fill from the case when known and render as the form's blank
fill-in line otherwise — the pipeline never refuses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal

TEMPLATE = "process_memo.docx"
SPEC = "tn-processmemo"


def _dedupe_court(court_name: str) -> str:
    """The fixed heading already says "IN THE COURT OF" and ends in "MAGISTRATE";
    the case court name is inserted between. Strip a leading "(In the) Court of
    (the)" and a trailing/again "Magistrate" so a case court like "Judicial
    Magistrate First Class Court, Chennai" doesn't double the heading. Returns the
    distinguishing remainder (e.g. "First Class, Chennai"), or "" when nothing
    distinguishing remains."""
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
class ProcessMemoResult:
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
    case_no: str = "",        # DVC No. / case number
    case_year: str = "",
    petitioner_name: str = "",
    respondent_name: str = "",
    # which process is prayed: "summons" | "warrant" | "" (blank -> both, strike out)
    process_type: str = "",
    address_for_service: str = "",
    place: str = "",
    filing_date: Optional[date] = None,
) -> ProcessMemoResult:
    """Assemble the Process Memo. Never refuses — renders blanks for anything not
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

    # Normalise the case year to a FULL 4-digit year for the "DVC No. __ OF <year>"
    # line (the template prints the full year, not "20"+suffix — that produced
    # "OF 202026"). Accept "26" -> "2026", "2026" -> "2026"; blank -> "20____".
    _y = (case_year or "").strip()
    if _y:
        case_year_full = _y if len(_y) == 4 else ("20" + _y.zfill(2))[-4:]
    else:
        case_year_full = ""

    context: Dict[str, Any] = {
        "court_name": court_name_clean,
        "court_place": court_place,
        "court_at": court_at,
        "case_ref": case_ref,
        "case_no": case_no,
        "case_year": case_year_full,
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        # summons / warrant — blank prints "summons / warrant" (both) to strike out.
        "process_type": process_type,
        "address_for_service": address_for_service,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return ProcessMemoResult(refused=False, context=context)
