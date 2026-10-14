"""Recall Petition — Petition u/s 70(2) Cr.P.C. to recall a warrant of arrest.

Where a Non-Bailable Warrant (N.B.W.) or Bailable Warrant (B.W.) has issued against
an accused who was unable to attend court, the accused (through counsel) petitions
the Magistrate under Section 70(2) of the Code of Criminal Procedure to recall and
cancel the warrant and release the accused on his own bond. This is the advocate's
short standard form (02_Recall_Petition.pdf): a Judicial-Magistrate cause title, the
C.C./Crime number, the parties (accused vs State by S.I. of Police), the "PETITION
U/S.70(2) Cr.P.C." heading, four verbatim submission/prayer clauses, the date line,
and the accused/counsel signatures. The form is generalised for any state/court —
court name and place are placeholders. Criminal context. PARTY-FILED (by the
accused's counsel).

FILL-IN COURT FORM (like the other advocate forms): nothing is a hard requirement.
The verbatim clauses always render; the particulars (court, C.C./Crime No.,
accused, complainant, dates, N.B.W./B.W. choice) fill from the case when known and
render as the form's blank fill-in line otherwise — the pipeline never refuses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal

TEMPLATE = "recall_petition.docx"
SPEC = "tn-recallpet"


def _dedupe_court(court_name: str) -> str:
    """The fixed heading already says "In the Court of Hon'ble Judicial
    Magistrate"; the case court name is appended after it. A court like "Magistrate
    First Class Court, Chennai" would double it. Strip what the heading already
    carries — a leading "(In the) Court of (the)", any "Judicial/Metropolitan
    Magistrate", and a redundant standalone "Court" — leaving the distinguishing
    remainder ("First Class, Chennai"). Returns "" when nothing distinguishing
    remains (the fixed heading then stands alone)."""
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
class RecallPetitionResult:
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
    cc_no: str = "",          # C.C. / Crime No.
    accused_name: str = "",
    complainant_name: str = "",   # e.g. "State by S.I. of Police, <station>"
    # which warrant issued: "N.B.W." | "B.W." | "" (blank -> both, to strike out)
    warrant_type: str = "",
    place: str = "",
    filing_date: Optional[date] = None,
) -> RecallPetitionResult:
    """Assemble the Recall Petition. Never refuses — renders blanks for anything
    not supplied, so it drafts complete-with-gaps for the advocate to finish."""

    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None
    filing_year = str(filing_date.year) if filing_date else None

    # De-duplicate the court name against the fixed "Judicial Magistrate" heading.
    court_name_clean = _dedupe_court(court_name)
    # "AT <place>" — drop when the place already appears in the (cleaned) court name.
    cp = (court_place or "").strip()
    court_at = cp if (cp and cp.lower() not in court_name_clean.lower()) else ""
    # Strip a redundant leading "C.C./Crime No." from cc_no (the label already
    # prints "C.C. / Crime No.").
    cc_clean = re.sub(r"^\s*(c\.?\s*c\.?|crime)\s*(no\.?)?\s*", "", cc_no or "", flags=re.I).strip()

    context: Dict[str, Any] = {
        "court_name": court_name_clean,
        "court_place": court_place,
        "court_at": court_at,
        "case_ref": case_ref,
        "cc_no": cc_clean,
        "accused_name": accused_name,
        "complainant_name": complainant_name,
        # N.B.W. / B.W. — blank prints both for the advocate to strike one out.
        "warrant_type": warrant_type,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return RecallPetitionResult(refused=False, context=context)
