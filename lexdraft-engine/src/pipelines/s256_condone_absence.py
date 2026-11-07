"""Petition to condone the complainant's absence (s.256 CrPC) — document pipeline.

PARTY-FILED (complainant's counsel). In a summons case instituted upon a
complaint, s.256 CrPC empowers the Magistrate to acquit the accused if the
complainant, being required to appear, is absent on the day appointed for the
appearance. Where the complainant cannot personally attend, this petition prays
the court to condone the complainant's absence for the day and to permit the
complainant to be represented by counsel, so that the proviso to s.256(1) is
attracted and no acquittal follows for mere non-appearance. Generalised for any
state.

Hard requirements (each refuses, no partial output):
  - The petition must state the ground on which the complainant seeks to have
    their absence condoned; a bare prayer without a reason is not maintainable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ._code_framework import provision
from ._court import clause, court_and_place

TEMPLATE = "s256_condone_absence.docx"
# "the proprietor, Mr. K. Senthil, was ..." -> the deponent's name.
_PROPRIETOR = re.compile(r"\b(?:the\s+)?(?:proprietor|partner|director),?\s+"
                         r"((?:mr|mrs|ms|thiru|tmt|selvi)\.?\s+[^,]+?),?(?=\s+(?:was|is|had|could)\b)",
                         re.I)
_TRAVEL = re.compile(r"travel|journey|train|flight|abroad|out of station", re.I)
SPEC = "tn-s256"


@dataclass(frozen=True)
class S256CondoneAbsenceResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> S256CondoneAbsenceResult:
    return S256CondoneAbsenceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="s256_condone_absence", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    complainant_name: str,
    accused_name: str,
    absence_reason: str,
    case_ref: str,
    place: str,
    court_designation: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_place: Optional[str] = None,
    absence_date: Optional[date] = None,   # the hearing the complainant missed
    post_for: Optional[str] = None,        # e.g. "evidence": post the case for it
    case_dismissed: bool = False,          # only a dismissed case is prayed to be restored
    case_nature: Optional[str] = None,     # e.g. "Section 138 of the Negotiable Instruments Act, 1881"
    deponent_name: Optional[str] = None,   # the proprietor / complainant who swears the affidavit
    deponent_description: Optional[str] = None,  # age, parentage, address
    documents: Sequence[str] = (),         # proof of the reason, e.g. the travel tickets
    filing_date: Optional[date] = None,    # the intake's date of filing (today)
) -> S256CondoneAbsenceResult:
    """Assemble the s.256 petition to condone the complainant's absence, or refuse."""

    # 1. the petition must state the ground on which the complainant seeks to have
    #    their absence condoned.
    if not absence_reason.strip():
        return _refuse(
            "the petition must state the ground on which the complainant seeks to "
            "have their absence condoned; a bare prayer to condone absence, without "
            "the reason, is not maintainable",
            code="s256_absence_reason_missing",
            fields=("absence_reason",),
        )

    court, at = court_and_place(court_designation, court_place)
    firm = bool(re.match(r"\s*(m/s|messrs)\b", complainant_name or "", re.I))
    reason = clause(absence_reason)
    deponent = (deponent_name or "").strip()
    m = _PROPRIETOR.search(reason)
    if not deponent and m:
        deponent = m.group(1).strip()
    # the deponent's own affidavit speaks in the first person.
    reason_first = (_PROPRIETOR.sub("I", reason, count=1) if m and m.group(1).strip() == deponent
                    else reason)
    docs = [d for d in documents if d.strip()]
    proof = (", ".join(docs) if docs
             else "[copies of the travel tickets]" if _TRAVEL.search(reason)
             else "[proof of the reason for the absence]")
    context: Dict[str, Any] = {
        "court_name": court,
        # s.279 BNSS (old s.256 CrPC): complainant's absence; proviso: represented by counsel.
        "absence_provision": provision("complainant_absence", case_ref),
        "absence_date": absence_date.isoformat() if absence_date else None,
        "post_for": (post_for or "").strip().rstrip("."),
        "complainant_name": complainant_name,
        "accused_name": accused_name,
        "absence_reason": reason,
        "absence_reason_first": reason_first,
        "firm": firm,
        "deponent": deponent,
        "deponent_description": (deponent_description or "").strip(),
        "proof": proof,
        "case_dismissed": case_dismissed,
        "case_nature": (case_nature or "").strip().rstrip("."),
        "case_ref": case_ref,
        "court_designation": court_designation,
        "petition_date": ((petition_date or filing_date).isoformat()
                          if (petition_date or filing_date) else None),
        "court_place": at,
        "place": place,
    }
    return S256CondoneAbsenceResult(refused=False, context=context)
