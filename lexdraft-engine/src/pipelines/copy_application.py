"""Application for certified (true) copies of documents — document pipeline.

A party to a proceeding applies to the copying department of the court for
certified copies of documents on the record — pleadings, orders, judgments,
depositions or exhibits — for use in appeal, revision or in a connected cause. The
application is addressed to the copying officer (the Deputy Registrar / Registrar
as the case may be), recites the cause reference and the applicant's role, and sets
out a schedule of the documents wanted: their description, the dates of the document
and of its filing, the number of copies, the order under which each was passed or
filed, and whether the proceeding is pending or has been finally disposed of. The
form is generalised for any state and any court — the court name and place of
sitting are placeholders. PARTY-FILED.

Hard requirements (each refuses, no partial output):
  - At least one document must be described (description non-blank); an application
    for copies that describes no document has nothing to copy.
  - The applicant must be named — the copying office issues the certified copy to,
    and at the instance of, an identified party.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "copy_application.docx"
SPEC = "tn-copy"


class Forum(Enum):
    HIGH_COURT = "high_court"
    CITY_CIVIL = "city_civil"
    SMALL_CAUSES = "small_causes"


@dataclass(frozen=True)
class CopyDocRow:
    description: str
    date_of_document: Optional[str] = None
    date_of_filing: Optional[str] = None
    number_of_copies: Optional[str] = None
    order_under_which: Optional[str] = None
    pending_or_final: Optional[str] = None


@dataclass(frozen=True)
class CopyApplicationResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> CopyApplicationResult:
    return CopyApplicationResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="copy_application", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    # All optional — this is a FILL-IN COURT FORM (the advocate's printed form has
    # blank lines). A missing value renders the form's blank; it never refuses.
    forum: Forum = Forum.CITY_CIVIL,
    case_ref: str = "",
    applicant_name: str = "",
    applicant_role: str = "",
    documents: Sequence[CopyDocRow] = (),
    place: str = "",
    court_place: Optional[str] = None,
    court_name: Optional[str] = None,
    opposite_party_name: Optional[str] = None,
    opposite_role: Optional[str] = None,
    # the copying officer addressed (e.g. "The Deputy Registrar" / "The Registrar")
    addressed_to: Optional[str] = None,
    rule_ref: Optional[str] = None,
    filing_date: Optional[date] = None,
    # The advocate form carries the suit number on its own line (O.S. No. ___ of
    # 20__) and a "dated this ___ day of ___ 20__" footer; all optional.
    os_no: Optional[str] = None,
    os_year: Optional[str] = None,
) -> CopyApplicationResult:
    """Assemble the application for certified copies of documents.

    FILL-IN COURT FORM: nothing is a hard requirement — a missing applicant,
    document, court, rule or date renders as the form's blank line for the
    advocate to autofill from the case or complete by hand. (The old "refuse if no
    documents / no applicant" contract was replaced.)
    """

    # Split filing_date into day / month for the "dated this ___ day of ___ 20__"
    # footer line; None -> blanks on the form.
    _MONTHS = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
    filing_day = str(filing_date.day) if filing_date else None
    filing_month = _MONTHS[filing_date.month - 1] if filing_date else None

    # YEAR NORMALISATION (fixes "O.S. No. 20 of 202023"). The template prints a
    # fixed "of 20" prefix and appends os_year, so os_year must be the LAST TWO
    # digits. The extractor commonly supplies a full 4-digit year ("2023") — take
    # its last two digits; a already-2-digit value ("23") is left as-is; anything
    # non-numeric is dropped so the form shows the blank "of 20____".
    def _year2(y: Optional[str]) -> Optional[str]:
        s = (y or "").strip()
        if not s:
            return None
        digits = "".join(ch for ch in s if ch.isdigit())
        if not digits:
            return None
        return digits[-2:]
    os_year = _year2(os_year)

    context: Dict[str, Any] = {
        "forum": forum.value,
        "case_ref": case_ref,
        "applicant_name": applicant_name,
        "applicant_role": applicant_role,
        "applicant": {"name": applicant_name, "role": applicant_role},
        "documents": [
            {
                "description": d.description,
                "date_of_document": d.date_of_document,
                "date_of_filing": d.date_of_filing,
                "number_of_copies": d.number_of_copies,
                "order_under_which": d.order_under_which,
                "pending_or_final": d.pending_or_final,
            }
            for d in documents
        ],
        "opposite_party_name": opposite_party_name,
        "opposite_role": opposite_role,
        "addressed_to": addressed_to,
        "rule_ref": rule_ref,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "filing_day": filing_day,
        "filing_month": filing_month,
        "case_year": filing_date.year if filing_date else None,
        "court_place": court_place,
        "court_name": court_name,
        "os_no": os_no,
        "os_year": os_year,
        "place": place,
    }
    return CopyApplicationResult(refused=False, context=context)
