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

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "s256_condone_absence.docx"
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

    context: Dict[str, Any] = {
        "complainant_name": complainant_name,
        "accused_name": accused_name,
        "absence_reason": absence_reason,
        "case_ref": case_ref,
        "court_designation": court_designation,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "court_place": court_place,
        "place": place,
    }
    return S256CondoneAbsenceResult(refused=False, context=context)
