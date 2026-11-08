"""Shared fill-ins for the TN court forms: court heading, case numbers, party labels.

The forms print a fixed "IN THE COURT OF" (and often "of 20__"), so the extracted
values must be shaped to fit: "District Munsif Court, Tiruppur" would otherwise read
"COURT OF DISTRICT MUNSIF COURT ... AT TIRUPPUR", and a 4-digit year fed to a
"20{{ yy }}" blank prints "202026"."""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

_REF = re.compile(
    r"(?P<label>[A-Za-z][A-Za-z.()\s]*?)\s*No\.?\s*(?P<no>\d+[\w/-]*)\s*(?:of|/)\s*(?P<year>\d{4}|\d{2})\b",
    re.I)

_OPPOSITE = {"plaintiff": "Defendant", "defendant": "Plaintiff", "petitioner": "Respondent",
             "respondent": "Petitioner", "appellant": "Respondent", "applicant": "Respondent",
             "complainant": "Accused", "accused": "Complainant"}

_SUIT = {"OS", "CS", "OSNO"}
_CRIMINAL = {"CC", "STC", "SC", "PRC", "CRLMP", "CMP", "MC", "DVC", "CRLOP"}


def court_heading(court_name: Optional[str], court_place: Optional[str]) -> Tuple[str, str]:
    """(court, at) for "IN THE COURT OF <court>[ AT <at>]": a leading "Court of" and a
    trailing "Court" after Munsif are dropped, Sub/District Court read as the Judge,
    and <at> is empty when the name already carries the place."""
    s = (court_name or "").strip()
    s = re.sub(r"^\s*(in\s+the\s+)?court\s+of\s+(the\s+)?", "", s, flags=re.I)
    s = re.sub(r"\bsub(ordinate)?\s+court\b", "Subordinate Judge", s, flags=re.I)
    s = re.sub(r"\bdistrict\s+court\b", "District Judge", s, flags=re.I)
    s = re.sub(r"\b(munsif+)\s+court\b", r"\1", s, flags=re.I)
    s = s.strip(" ,")
    p = (court_place or "").strip()
    return s, (p if p and p.lower() not in s.lower() else "")


def case_parts(case_ref: Optional[str]) -> List[Tuple[str, str, str]]:
    """[(label, no, 4-digit year)] for each "<X> No. n of yyyy" in the reference, outer
    first as written: "I.A. No. 245 of 2026 in O.S. No. 112 of 2026" -> I.A., O.S."""
    return [(re.sub(r"^in\s+", "", m.group("label").strip(), flags=re.I), m.group("no"),
             year4(m.group("year"))) for m in _REF.finditer(case_ref or "")]


def year4(y: Optional[str]) -> str:
    d = "".join(ch for ch in str(y or "") if ch.isdigit())
    return d if len(d) == 4 else (("20" + d.zfill(2))[-4:] if d else "")


def year2(y: Optional[str]) -> str:
    """Last two digits, for a form that prints a fixed "20" before the blank."""
    d = "".join(ch for ch in str(y or "") if ch.isdigit())
    return d[-2:] if d else ""


def kind_of(case_ref: Optional[str]) -> str:
    """"suit" | "criminal" | "petition" (I.A./O.P./... and anything unrecognised) by
    the outermost case number; "" when no case number is given."""
    parts = case_parts(case_ref)
    if not parts:
        return ""
    k = re.sub(r"[^A-Z]", "", parts[0][0].upper())
    return "suit" if k in _SUIT else "criminal" if k in _CRIMINAL else "petition"


def party_labels(case_ref: Optional[str]) -> Tuple[str, str]:
    return {"suit": ("Plaintiff", "Defendant"), "criminal": ("Complainant", "Accused")}.get(
        kind_of(case_ref), ("Petitioner", "Respondent"))


def his_her(name: Optional[str]) -> str:
    """The deponent's pronoun from the honorific, else the form's "his/her"."""
    if re.match(r"\s*(mr|thiru|shri|sri)\b\.?", name or "", re.I):
        return "his"
    if re.match(r"\s*(mrs|ms|miss|smt|tmt|selvi|kumari)\b\.?", name or "", re.I):
        return "her"
    return "his/her"


def age_years(age) -> Optional[str]:
    """"67", 67, "aged 67 years", "67 yrs old" -> "67"; anything else (a gap) -> None."""
    a = re.sub(r"^\s*aged\s+|\s*(?:years?|yrs?)\.?\s*(?:old)?\s*$", "", str(age or ""), flags=re.I).strip()
    return a if re.fullmatch(r"\d{1,3}", a) else None


def deponent_particulars(age) -> str:
    """What follows "I, <name>," in an affidavit: the age the brief gives (b2: 67, 29),
    the rest a visible gap."""
    a = age_years(age)
    if not a:
        return "[age, parentage and address of the deponent to be provided]"
    return f"aged {a} years, [parentage and address of the deponent to be provided]"


def opposite_role(role: Optional[str]) -> str:
    return _OPPOSITE.get((role or "").strip().lower(), "")
