"""Call for Memo — a short memo filed with the copying department so the certified
copies applied for are released against the court fee deposited.

After the accused (or a party) has applied for certified copies of documents on the
record, this memo is submitted to the court: it recites that the named accused
applied for certified copies of the listed documents, states the purpose and the
court fee deposited, and prays that the copies be furnished. Criminal context — the
cause reference is a C.C. No. before a Judicial Magistrate, and the memo is signed
"Counsel for Accused". The form is generalised for any state/court — court name,
place and pincode are placeholders.

FILL-IN COURT FORM (like the affidavit of service / copy application): nothing is
a hard requirement. A missing value renders as the form's blank fill-in line for
the advocate to autofill from the case or complete by hand — the pipeline never
refuses. PARTY-FILED (memo of the accused's counsel).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal

TEMPLATE = "call_for_memo.docx"
SPEC = "tn-callmemo"


def _dedupe_court(court_name: str) -> str:
    """The heading is fixed: "In the Court of Hon'ble Judicial Magistrate", and the
    case's court name is appended after it. A case court like "Court of the
    Magistrate First Class Court, Chennai" would double the heading
    ("... Judicial Magistrate Court of the Magistrate First Class Court ..."). Strip
    the words the fixed heading already carries — a leading "(In the) Court of
    (the)", any "Judicial/Metropolitan Magistrate", and a redundant standalone
    "Court" — leaving only the DISTINGUISHING remainder (e.g. "First Class,
    Chennai"). Returns "" when nothing distinguishing is left (the fixed heading
    then stands alone, as on the advocate's blank form)."""
    s = (court_name or "").strip()
    if not s:
        return ""
    # Drop a leading "In the Court of the" / "Court of".
    s = re.sub(r"^\s*(in\s+the\s+)?court\s+of\s+(the\s+)?", "", s, flags=re.I)
    # Drop the "Judicial/Metropolitan/Chief Judicial Magistrate" phrase the fixed
    # heading already states (anywhere it appears).
    s = re.sub(r"\b(chief\s+)?(judicial|metropolitan)?\s*magistrate('s)?\b", "", s, flags=re.I)
    # Drop a now-redundant standalone "Court" token (but keep place names).
    s = re.sub(r"\bcourt\b", "", s, flags=re.I)
    # Tidy leftover punctuation/whitespace ("  ,  Chennai" -> "Chennai").
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ,-")
    return s


@dataclass(frozen=True)
class CallForMemoResult:
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
    pincode: str = "",
    case_ref: str = "",
    cc_no: str = "",
    cc_year: str = "",
    complainant_name: str = "",
    accused_name: str = "",
    documents: Sequence[str] = (),
    purpose: str = "",
    court_fee: str = "",
    place: str = "",
    filing_date: Optional[date] = None,
) -> CallForMemoResult:
    """Assemble the Call for Memo. Never refuses — renders blanks for anything
    not supplied, so it drafts complete-with-gaps for the advocate to finish."""

    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None
    filing_year = str(filing_date.year) if filing_date else None

    # De-duplicate the court name against the fixed "Judicial Magistrate" heading.
    court_name_clean = _dedupe_court(court_name)
    # If no pincode was supplied, lift a 6-digit pincode out of the court place /
    # place text when one is present (e.g. "Chennai - 600 016").
    pin = pincode.strip()
    if not pin:
        m = re.search(r"\b(\d{3}\s?\d{3})\b", f"{court_place} {place} {court_name}")
        if m:
            pin = m.group(1)

    context: Dict[str, Any] = {
        "court_name": court_name_clean,
        "court_place": court_place,
        "pincode": pin,
        "case_ref": case_ref,
        "cc_no": cc_no,
        "cc_year": cc_year,
        "complainant_name": complainant_name,
        "accused_name": accused_name,
        # The numbered list of documents applied for (blank lines when absent).
        # Tolerate None (the adapter's default when the field is omitted).
        "documents": [d for d in (documents or ()) if str(d).strip()],
        "purpose": purpose,
        "court_fee": court_fee,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return CallForMemoResult(refused=False, context=context)
