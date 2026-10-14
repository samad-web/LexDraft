"""Court-issued warrant / order in execution or interim relief — document pipeline.

COURT-ISSUED INSTRUMENT. A warrant or order issues from the court/registry under
its seal; the advocate only PREPARES a draft for the court's issue and never
authors the court's own process. The context therefore carries
``"court_issues": True`` so the template can print the marker banner "[COURT ISSUES
THIS — the advocate prepares this draft for the court's issue]".

Covers: an Order XXI Rule 54 CPC prohibitory order attaching immovable property; an
Order XXI CPC warrant of attachment of movable property in execution of a money
decree; a warrant of delivery of possession in execution of an eviction/HRC order;
and an Order XXXIX Rules 1 & 2 CPC order granting an interim injunction.

Hard requirements (each refuses, no partial output):
  - The decree-holder/petitioner and the judgment-debtor/respondent must both be
    named.
  - An execution warrant (attachment/possession) must identify the subsisting
    decree/order (its reference and date) it enforces.
  - An attachment/possession warrant must annex a schedule identifying the property.
  - An injunction order must state what the respondent is restrained from doing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "court_warrant.docx"
SPEC = "tn-warrant"


class WarrantKind(Enum):
    ATTACH_IMMOVABLE = "attach_immovable"     # Order XXI Rule 54 CPC — prohibitory order attaching immovable property
    ATTACH_MOVABLE = "attach_movable"         # Order XXI CPC — warrant of attachment of movable property in execution of a money decree
    POSSESSION = "possession"                 # warrant of delivery of possession in execution of an eviction/HRC order
    INJUNCTION_ORDER = "injunction_order"     # Order XXXIX Rules 1 & 2 CPC — order granting interim injunction


@dataclass(frozen=True)
class CourtWarrantResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> CourtWarrantResult:
    return CourtWarrantResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="court_warrant", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    kind: WarrantKind,
    case_ref: str,
    decree_holder_or_petitioner_name: str,
    judgment_debtor_or_respondent_name: str,
    place: str,
    court_place: Optional[str] = None,
    decree_or_order_ref: Optional[str] = None,
    decree_or_order_date: Optional[date] = None,
    property_schedule: Optional[str] = None,
    amount_due: Optional[str] = None,
    restraint_text: Optional[str] = None,   # injunction: what the respondent is restrained from
    addressed_to: Optional[str] = None,     # e.g. "The Bailiff of the Court"
    seal_date: Optional[date] = None,
) -> CourtWarrantResult:
    """Assemble the court-issued warrant/order draft for the court's issue, or refuse."""

    _EXECUTION = (WarrantKind.ATTACH_IMMOVABLE, WarrantKind.ATTACH_MOVABLE,
                  WarrantKind.POSSESSION)

    # 1. both parties must be named.
    if (not decree_holder_or_petitioner_name.strip()
            or not judgment_debtor_or_respondent_name.strip()):
        return _refuse(
            "a warrant/order must name the decree-holder/petitioner and the "
            "judgment-debtor/respondent; one or both are absent",
            code="court_warrant_parties_missing",
            fields=("decree_holder_or_petitioner_name",
                    "judgment_debtor_or_respondent_name"),
        )

    # 2. an execution warrant presupposes a subsisting decree/order, to be identified.
    if kind in _EXECUTION:
        if not (decree_or_order_ref or "").strip() or decree_or_order_date is None:
            return _refuse(
                "an execution warrant presupposes a subsisting decree/order, which "
                "must be identified (its reference and date); it is absent",
                code="court_warrant_decree_not_identified",
                fields=("decree_or_order_ref", "decree_or_order_date"),
            )

    # 3. an attachment/possession warrant must annex a schedule of the property.
    if kind in _EXECUTION:
        if not (property_schedule or "").strip():
            return _refuse(
                "an attachment/possession warrant must annex a schedule identifying "
                "the property; it is absent",
                code="court_warrant_schedule_missing",
                fields=("property_schedule",),
            )

    # 4. an injunction order must state what the respondent is restrained from.
    if kind is WarrantKind.INJUNCTION_ORDER:
        if not (restraint_text or "").strip():
            return _refuse(
                "an injunction order must state what the respondent is restrained "
                "from doing; it is absent",
                code="court_warrant_restraint_missing",
                fields=("restraint_text",),
            )

    context: Dict[str, Any] = {
        "court_issues": True,
        "kind": kind.value,
        "case_ref": case_ref,
        "decree_holder_or_petitioner_name": decree_holder_or_petitioner_name,
        "judgment_debtor_or_respondent_name": judgment_debtor_or_respondent_name,
        "place": place,
        "court_place": court_place,
        "decree_or_order_ref": decree_or_order_ref,
        "decree_or_order_date": (decree_or_order_date.isoformat()
                                 if decree_or_order_date else None),
        "property_schedule": property_schedule,
        "amount_due": amount_due,
        "restraint_text": restraint_text,
        "addressed_to": addressed_to,
        "seal_date": seal_date.isoformat() if seal_date else None,
    }
    return CourtWarrantResult(refused=False, context=context)
