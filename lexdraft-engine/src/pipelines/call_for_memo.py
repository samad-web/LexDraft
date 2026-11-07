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
from ._court_form import case_parts, year2, year4

TEMPLATE = "call_for_memo.docx"
SPEC = "tn-callmemo"


_RECORDS = re.compile(r"(?i)records?\s+(of|in)\b|case\s+records?")
_COPY = re.compile(r"(?i)certified\s+cop")


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
    # "copy" (memo to release applied-for certified copies, the default form) or
    # "records" (petition to call for the records of another case); blank -> inferred
    kind: str = "",
    applicant_role: str = "",            # "complainant" / "accused" — who files
    hearing_date: Optional[date] = None,
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

    # "of 20{{ cc_year }}" on the form (a 4-digit year printed "2022025")
    parts = case_parts(case_ref)
    cc_no = cc_no or (parts[0][1] if parts else "")
    cc_year = (cc_year or "").strip()
    if len(cc_year) == 1:          # the old "202_" form took the last digit alone
        cc_year = "202" + cc_year
    full_year = year4(cc_year or (parts[0][2] if parts else ""))
    cc_year = year2(cc_year or (parts[0][2] if parts else ""))
    docs = [str(d).strip() for d in (documents or ()) if str(d).strip()]
    # r12: "For For comparison of ..." — the form prints its own "For".
    purpose = re.sub(r"^\s*(for|to\s+enable)\s+", "", purpose.strip(), flags=re.I).rstrip(". ")
    # r12: a brief asking the court to CALL FOR the records of another case (S.T.C.
    # No. 118 of 2024, to compare the accused's signatures) is a call-for-records
    # petition, not the copying-section memo for certified copies applied for.
    kind = (kind or "").strip().lower()
    if kind not in ("copy", "records"):
        kind = "records" if any(_RECORDS.search(d) and not _COPY.search(d) for d in docs) else "copy"
    records_of, records_court = [], []
    for d in docs:
        d = re.sub(r"^\s*(the\s+)?(case\s+)?records?\s+(of|in)\s+", "", d, flags=re.I)
        m = re.search(r"\s+on\s+the\s+file\s+of\s+(.+)$", d, re.I)
        records_of.append(d[:m.start()] if m else d)
        if m:
            records_court.append(m.group(1).strip(" ."))
    if kind == "records" and not records_of:
        # r13: the case to call for came in the case reference / purpose, not as a document.
        main = parts[0][1:] if parts else None
        records_of = list(dict.fromkeys(
            f"{label.split()[-1]} No. {no} of {year}" for label, no, year in case_parts(f"{case_ref} {purpose}")
            if (no, year) != main))
    own = {re.sub(r"\W+", "", court_name.lower()), re.sub(r"\W+", "", court_name_clean.lower())} - {""}
    others = [c for c in records_court if not any(o and o in re.sub(r"\W+", "", c.lower()) for o in own)]
    role = applicant_role.strip().title()
    context: Dict[str, Any] = {
        "kind": kind,
        "applicant_label": role if role in ("Complainant", "Accused") else "Petitioner",
        "records_of": " and ".join(records_of) or "[case to be provided]",
        "records_court": "; ".join(others) if others else "this Hon'ble Court",
        # proceedings instituted before 1 July 2024 stay under the Cr.P.C. (s.531 BNSS)
        "section": ("Section 91 of the Code of Criminal Procedure, 1973" if full_year and full_year < "2024"
                    else "Section 94 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (Section 91 of the "
                         "Code of Criminal Procedure, 1973)" if full_year == "2024"
                    else "Section 94 of the Bharatiya Nagarik Suraksha Sanhita, 2023"),
        "hearing_date": hearing_date.isoformat() if hearing_date else None,
        "court_name": court_name_clean,
        # shown under the heading only when the court name does not already carry it
        "court_place": "" if (court_place or "").lower() in court_name_clean.lower() else court_place,
        "pincode": pin,
        "case_ref": case_ref,
        "cc_no": cc_no,
        "cc_year": cc_year,
        # the petition's cause title names both sides; the copy memo keeps its blanks
        "complainant_name": complainant_name or (
            "[name of the complainant to be provided]" if kind == "records" else ""),
        "accused_name": accused_name or (
            "[name of the accused to be provided]" if kind == "records" else ""),
        # The numbered list of documents applied for (blank lines when absent).
        "documents": docs,
        "purpose": purpose,
        "court_fee": court_fee,
        "place": place,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "filing_year": filing_year,
    }
    return CallForMemoResult(refused=False, context=context)
