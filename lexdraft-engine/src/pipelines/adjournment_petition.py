"""Petition for adjournment/postponement (Order XVII Rule 1 CPC) — pipeline.

PARTY-FILED. Order XVII Rule 1 CPC empowers the court, if sufficient cause is
shown, to grant time to the parties or to any of them and, from time to time, to
adjourn the hearing of the suit. This petition prays the court to adjourn the
hearing to a subsequent date, stating the purpose for which the case stands
posted today and the ground on which time/adjournment is sought. Generalised for
any state.

Hard requirements (each refuses, no partial output):
  - The petition must state the purpose for which the case is posted today; an
    adjournment prayer must fix what stage the case is at.
  - The petition must state the ground on which time/adjournment is sought;
    Order XVII Rule 1 requires sufficient cause to be shown.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "adjournment_petition.docx"
SPEC = "tn-adjourn"


@dataclass(frozen=True)
class AdjournmentPetitionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> AdjournmentPetitionResult:
    return AdjournmentPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="adjournment_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    posted_for: str,
    adjournment_reason: str,
    case_ref: str,
    place: str,
    court_place: Optional[str] = None,
    petition_date: Optional[date] = None,
) -> AdjournmentPetitionResult:
    """Assemble the Order XVII Rule 1 adjournment petition, or refuse."""

    # 1. the petition must state the purpose for which the case is posted today.
    if not posted_for.strip():
        return _refuse(
            "the petition must state the purpose for which the case is posted today; "
            "an adjournment prayer must fix the stage at which the case stands",
            code="adjournment_posted_for_missing",
            fields=("posted_for",),
        )

    # 2. Order XVII Rule 1 requires the ground on which time/adjournment is sought.
    if not adjournment_reason.strip():
        return _refuse(
            "Order XVII Rule 1 requires the ground on which time/adjournment is "
            "sought; a bare prayer to adjourn, without sufficient cause shown, is "
            "not maintainable",
            code="adjournment_reason_missing",
            fields=("adjournment_reason",),
        )

    context: Dict[str, Any] = {
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        "posted_for": posted_for,
        "adjournment_reason": adjournment_reason,
        "case_ref": case_ref,
        "court_place": court_place,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "place": place,
    }
    return AdjournmentPetitionResult(refused=False, context=context)
