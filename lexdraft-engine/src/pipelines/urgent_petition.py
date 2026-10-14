"""Petition for urgent listing (s.151 CPC, inherent powers) — pipeline.

PARTY-FILED. Where a substantive application has already been taken out in a
pending matter and the party apprehends prejudice unless it is heard at once,
this petition invokes the inherent powers of the court under s.151 CPC to have
that application treated as urgent, taken up out of turn, and disposed of
expeditiously. Generalised for any state.

Hard requirements (each refuses, no partial output):
  - There must be a substantive application already taken out in a pending
    matter; an urgent-listing petition rides on an existing application and
    cannot stand alone.
  - The petition must state the orders prayed for on the urgent listing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "urgent_petition.docx"
SPEC = "tn-urgent"


@dataclass(frozen=True)
class UrgentPetitionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> UrgentPetitionResult:
    return UrgentPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="urgent_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    underlying_application: str,
    orders_prayed: str,
    case_ref: str,
    place: str,
    court_place: Optional[str] = None,
    petition_date: Optional[date] = None,
) -> UrgentPetitionResult:
    """Assemble the s.151 CPC urgent-listing petition, or refuse."""

    # 1. an urgent-listing petition presupposes a substantive application already
    #    taken out in a pending matter.
    if not underlying_application.strip():
        return _refuse(
            "an urgent-listing petition presupposes a substantive application "
            "already taken out in a pending matter; with no such application "
            "identified the petition has nothing to have listed urgently",
            code="urgent_petition_no_underlying_application",
            fields=("underlying_application",),
        )

    # 2. the petition must state the orders prayed for on the urgent listing.
    if not orders_prayed.strip():
        return _refuse(
            "the petition must state the orders prayed for on the urgent listing; a "
            "bare prayer to treat the matter as urgent, without the orders sought, "
            "is not maintainable",
            code="urgent_petition_orders_prayed_missing",
            fields=("orders_prayed",),
        )

    context: Dict[str, Any] = {
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        "underlying_application": underlying_application,
        "orders_prayed": orders_prayed,
        "case_ref": case_ref,
        "court_place": court_place,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "place": place,
    }
    return UrgentPetitionResult(refused=False, context=context)
