"""Petition to recall/cancel a warrant of arrest (s.70(2) CrPC) — pipeline.

PARTY-FILED (accused's counsel). Where, on the accused's non-appearance, the
court has issued a warrant of arrest, s.70(2) CrPC provides that such a warrant
remains in force until it is cancelled by the court which issued it. This
petition prays the court to recall/cancel the warrant pending against the
accused, explaining the reason for the earlier non-appearance and carrying the
accused's undertaking to appear regularly in future. Generalised for any state.

Hard requirements (each refuses, no partial output):
  - A warrant must actually be pending against the accused; s.70(2) recall
    presupposes a live warrant to be cancelled.
  - The petition must state the reason for the non-appearance that occasioned
    the warrant.
  - The petition must carry the accused's undertaking to appear regularly in
    future, on the strength of which recall is sought.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "recall_warrant.docx"
SPEC = "tn-recall"


@dataclass(frozen=True)
class RecallWarrantResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> RecallWarrantResult:
    return RecallWarrantResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="recall_warrant", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    accused_name: str,
    absence_reason: str,
    warrant_pending: bool,
    undertaking_future_appearance: bool,
    case_ref: str,
    place: str,
    state_rep_by: Optional[str] = None,
    police_station: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_place: Optional[str] = None,
) -> RecallWarrantResult:
    """Assemble the s.70(2) petition to recall the warrant of arrest, or refuse."""

    # 1. s.70(2) recall presupposes a warrant is actually pending against the accused.
    if not warrant_pending:
        return _refuse(
            "s.70(2) recall presupposes a warrant is actually pending against the "
            "accused; with no warrant in force there is nothing to be recalled or "
            "cancelled and the petition would not lie",
            code="recall_warrant_no_warrant_pending",
            fields=("warrant_pending",),
        )

    # 2. the petition must state the reason for the non-appearance that occasioned
    #    the warrant.
    if not absence_reason.strip():
        return _refuse(
            "the petition must state the reason for the non-appearance that "
            "occasioned the warrant; a bare prayer to recall, without the ground, "
            "is not maintainable",
            code="recall_warrant_absence_reason_missing",
            fields=("absence_reason",),
        )

    # 3. the petition must carry the accused's undertaking to appear regularly in
    #    future.
    if not undertaking_future_appearance:
        return _refuse(
            "the petition must carry the accused's undertaking to appear regularly "
            "in future; without that undertaking the court has no basis on which to "
            "recall the warrant",
            code="recall_warrant_no_undertaking",
            fields=("undertaking_future_appearance",),
        )

    context: Dict[str, Any] = {
        "accused_name": accused_name,
        "absence_reason": absence_reason,
        "warrant_pending": warrant_pending,
        "undertaking_future_appearance": undertaking_future_appearance,
        "case_ref": case_ref,
        "state_rep_by": state_rep_by,
        "police_station": police_station,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "court_place": court_place,
        "place": place,
    }
    return RecallWarrantResult(refused=False, context=context)
