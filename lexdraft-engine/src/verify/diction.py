"""Diction / person-consistency lint for EDITABLE (advocate- or LLM-authored) text.

Doc-5 Item 5 (optional). The engine's own generated text is clean; this rule
exists to catch the drafting errors a real filing carried — verified in the
Thoorigai Prints Complaint & Proof Affidavit (see the Language Audit):

  - "Complaint" written for "Complainant" (the document confused with the person)
  - first-person <-> third-person voice slips (an "I" affidavit lapsing into
    "the complainant …", or a 3rd-person complaint slipping into "I …")
  - "company" used for a sole proprietorship
  - "COUERT" misspelling of "COURT"
  - the stray "issued the to the Accused"

It NEVER refuses and never mutates text: it returns a list of findings the review
pack surfaces, so the advocate decides. Deterministic, no LLM.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Literal, Optional, Sequence

Severity = Literal["high", "minor"]
Voice = Literal["first_person", "third_person"]


@dataclass(frozen=True)
class DictionFinding:
    code: str
    severity: Severity
    message: str
    excerpt: str


# "Complaint" where "Complainant" is meant: the word "Complaint" immediately
# preceded by "the"/"am the"/"by the" (i.e. used as the PERSON, not the document).
_COMPLAINT_FOR_COMPLAINANT = re.compile(
    r"\b(?:am the|by the|the said|the)\s+Complaint\b", re.IGNORECASE
)
_COUERT = re.compile(r"\bCOUERT\b", re.IGNORECASE)
_COMPANY = re.compile(r"\b(?:complainant|accused)\s+company\b", re.IGNORECASE)
_STRAY_ISSUED_THE_TO = re.compile(r"\bissued\s+the\s+to\b", re.IGNORECASE)
# First-person markers (for detecting 3rd-person slips inside an affidavit).
_THIRD_PERSON_SLIP = re.compile(r"\bthe\s+complainant\b", re.IGNORECASE)
# Third-person context; a stray first-person "I " inside a complaint pleading.
_FIRST_PERSON_SLIP = re.compile(r"(?<![A-Za-z])I\s+(?:state|further state|say|submit|am)\b")


def _excerpt(text: str, start: int, end: int, pad: int = 30) -> str:
    a = max(0, start - pad)
    b = min(len(text), end + pad)
    return ("…" if a > 0 else "") + text[a:b].strip() + ("…" if b < len(text) else "")


def lint(text: str, *, voice: Optional[Voice] = None) -> List[DictionFinding]:
    """Lint one block of editable text. `voice` enables the person-slip checks:
    pass "first_person" for affidavit slots (flags "the complainant …" slips) or
    "third_person" for complaint slots (flags stray "I state …"). When voice is
    None the person checks are skipped and only the diction checks run."""
    findings: List[DictionFinding] = []
    if not text or not text.strip():
        return findings

    for m in _COMPLAINT_FOR_COMPLAINANT.finditer(text):
        findings.append(DictionFinding(
            code="diction_complaint_for_complainant", severity="high",
            message='"Complaint" appears where "Complainant" (the person) is meant.',
            excerpt=_excerpt(text, *m.span()),
        ))
    for m in _COUERT.finditer(text):
        findings.append(DictionFinding(
            code="diction_couert_misspelling", severity="minor",
            message='"COUERT" is a misspelling of "COURT".',
            excerpt=_excerpt(text, *m.span()),
        ))
    for m in _COMPANY.finditer(text):
        findings.append(DictionFinding(
            code="diction_company_for_proprietorship", severity="minor",
            message='"company" used for a party described as a Proprietor; prefer '
                    'the firm name or "proprietary concern".',
            excerpt=_excerpt(text, *m.span()),
        ))
    for m in _STRAY_ISSUED_THE_TO.finditer(text):
        findings.append(DictionFinding(
            code="diction_stray_the", severity="minor",
            message='Stray word: "issued the to" should read "issued to".',
            excerpt=_excerpt(text, *m.span()),
        ))

    if voice == "first_person":
        for m in _THIRD_PERSON_SLIP.finditer(text):
            findings.append(DictionFinding(
                code="diction_person_slip_third_in_first", severity="high",
                message='First-person affidavit slips into third person '
                        '("the complainant …"); it should read "I …".',
                excerpt=_excerpt(text, *m.span()),
            ))
    elif voice == "third_person":
        for m in _FIRST_PERSON_SLIP.finditer(text):
            findings.append(DictionFinding(
                code="diction_person_slip_first_in_third", severity="high",
                message='Third-person pleading slips into first person '
                        '("I state …"); a complaint should read "the complainant …".',
                excerpt=_excerpt(text, *m.span()),
            ))
    return findings


def lint_blocks(
    blocks: Sequence[str], *, voice: Optional[Voice] = None
) -> List[DictionFinding]:
    """Lint several editable blocks (e.g. the debt slot + each body para), keeping
    findings in block order."""
    out: List[DictionFinding] = []
    for b in blocks:
        out.extend(lint(b, voice=voice))
    return out
