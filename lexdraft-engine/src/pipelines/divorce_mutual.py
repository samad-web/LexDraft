"""Mutual-consent divorce under HMA s.13B — pipeline (spec 6.2).

TWO SEPARATE documents sharing a fact sheet — first motion and second motion,
each its own build function and template (not one document with a flag).

First motion:
  - Separation >= 1 year (hard check).
  - Settlement covers maintenance, custody and property, or expressly records that
    a head does not arise; silence on a head refuses.
  - Joint affidavit by BOTH parties.

Second motion:
  - 6 to 18 months from the first-motion order.
  - Before 6 months -> refuse UNLESS a waiver application is attached.
  - After 18 months -> refuse.
  - Waiver (Amardeep Singh v. Harveen Kaur): the settlement must ALREADY be
    implemented; a waiver with outstanding terms refuses.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from dateutil.relativedelta import relativedelta

from ..verify.refusals import Refusal, Severity

TEMPLATE_FIRST = "divorce_mutual_first.docx"
TEMPLATE_SECOND = "divorce_mutual_second.docx"
SPEC = "6.2"


@dataclass(frozen=True)
class Settlement:
    """Each head must be a non-empty string — either the terms, or an express
    record that the head does not arise."""

    maintenance: str
    custody: str
    property: str


@dataclass(frozen=True)
class MotionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(
    reason: str,
    *,
    code: str,
    fields: tuple = (),
    remedy_hint: str = "none",
) -> MotionResult:
    return MotionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            pipeline="divorce_mutual", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


# --------------------------------------------------------------------------
# First motion.
# --------------------------------------------------------------------------

def build_first_motion(
    *,
    party_a: str,
    party_b: str,
    marriage_date: date,
    marriage_place: str,
    living_separately_since: date,
    first_motion_date: date,
    settlement: Settlement,
    joint_affidavit: bool,
    place: str,
    # cause-title header (DPC book). Optional.
    family_court: Optional[str] = None,
    city: Optional[str] = None,
) -> MotionResult:
    """Assemble the first-motion petition, or refuse."""

    # 1. separation >= 1 year.
    one_year = living_separately_since + relativedelta(years=1)
    if first_motion_date < one_year:
        return _refuse(
            "the parties must have been living separately for one year or more "
            "before the first motion; the period is not made out",
            code="divorce_mutual_first_separation_under_one_year",
            fields=("living_separately_since", "first_motion_date"),
        )

    # 2. settlement heads — each must be addressed (terms or express non-arising).
    if not settlement.maintenance.strip():
        return _refuse("the settlement must address maintenance (or expressly "
                       "record that it does not arise)",
                       code="divorce_mutual_first_settlement_no_maintenance",
                       fields=("settlement",))
    if not settlement.custody.strip():
        return _refuse("the settlement must address custody (or expressly record "
                       "that it does not arise)",
                       code="divorce_mutual_first_settlement_no_custody",
                       fields=("settlement",))
    if not settlement.property.strip():
        return _refuse("the settlement must address property (or expressly record "
                       "that it does not arise)",
                       code="divorce_mutual_first_settlement_no_property",
                       fields=("settlement",))

    # 3. joint affidavit by both parties.
    if not joint_affidavit:
        return _refuse("a joint affidavit by both parties is required for the "
                       "first motion",
                       code="divorce_mutual_first_no_joint_affidavit",
                       fields=("joint_affidavit",))

    context: Dict[str, Any] = {
        "party_a": party_a,
        "party_b": party_b,
        "deponents": [party_a, party_b],
        # cause-title header fields (render only when present).
        "family_court": family_court,
        "city": city,
        "petition_year": first_motion_date.year,
        "petition_date": first_motion_date.isoformat(),
        "marriage_date": marriage_date,
        "marriage_place": marriage_place,
        "living_separately_since": living_separately_since,
        "first_motion_date": first_motion_date,
        "settlement": {
            "maintenance": settlement.maintenance,
            "custody": settlement.custody,
            "property": settlement.property,
        },
        "joint_affidavit": joint_affidavit,
        "place": place,
    }
    return MotionResult(refused=False, context=context)


# --------------------------------------------------------------------------
# Second motion.
# --------------------------------------------------------------------------

def build_second_motion(
    *,
    party_a: str,
    party_b: str,
    first_motion_order_date: date,
    second_motion_date: date,
    settlement_implemented: bool,
    waiver_sought: bool,
    place: str,
    # cause-title header (DPC book). Optional.
    family_court: Optional[str] = None,
    city: Optional[str] = None,
) -> MotionResult:
    """Assemble the second-motion petition, or refuse."""

    six_months = first_motion_order_date + relativedelta(months=6)
    eighteen_months = first_motion_order_date + relativedelta(months=18)

    # After 18 months -> refuse outright.
    if second_motion_date > eighteen_months:
        return _refuse(
            "the second motion must be moved within eighteen months of the "
            "first-motion order; the window has closed",
            code="divorce_mutual_second_after_eighteen_months",
            fields=("first_motion_order_date", "second_motion_date"),
        )

    waiver_attached = False
    # Before 6 months -> refuse unless a waiver is attached (and valid).
    if second_motion_date < six_months:
        if not waiver_sought:
            return _refuse(
                "the second motion is before the expiry of the six-month "
                "cooling-off period; a waiver application under Amardeep Singh v. "
                "Harveen Kaur must be attached",
                code="divorce_mutual_second_before_six_months_no_waiver",
                fields=("second_motion_date", "waiver_sought"),
            )
        # Waiver requires the settlement to be already implemented.
        if not settlement_implemented:
            return _refuse(
                "a waiver of the cooling-off period requires the settlement to be "
                "already implemented (Amardeep Singh); settlement terms are "
                "outstanding",
                code="divorce_mutual_second_waiver_settlement_not_implemented",
                fields=("settlement_implemented",),
            )
        waiver_attached = True

    context: Dict[str, Any] = {
        "party_a": party_a,
        "party_b": party_b,
        # cause-title header fields (render only when present).
        "family_court": family_court,
        "city": city,
        "petition_year": second_motion_date.year,
        "petition_date": second_motion_date.isoformat(),
        "first_motion_order_date": first_motion_order_date,
        "second_motion_date": second_motion_date,
        "settlement_implemented": settlement_implemented,
        "waiver_attached": waiver_attached,
        "place": place,
    }
    return MotionResult(refused=False, context=context)
