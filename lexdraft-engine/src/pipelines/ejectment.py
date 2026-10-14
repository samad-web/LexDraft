"""Suit for ejectment and damages for wrongful use and occupation
— document pipeline (DPC book pp.22-24).

The landlord sues a tenant who holds over after a s.106 TPA notice terminating
the month-to-month tenancy. The book's suit pleads the lease, its expiry, the
s.106 notice + its valid service (clear 15 days), the wrongful occupation and the
damages rate, cause of action, jurisdiction (premises outside Rent Control), and
court fee ad valorem on the annual rent.

Hard requirements (each refuses, no partial output):
  - A s.106 TPA notice terminating the tenancy must be pleaded, with its service
    date (the notice is a condition precedent to ejectment of a TPA tenant).
  - The notice must give clear 15 days before the tenancy-end date (s.106 TPA).
  - Cause of action needs a date AND place.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "ejectment.docx"
SPEC = "dpc-22-24"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_NOTICE_CLEAR_DAYS = 15  # s.106 TPA: clear 15 days' notice


@dataclass(frozen=True)
class EjectmentResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> EjectmentResult:
    return EjectmentResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="ejectment", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    plaintiff_names: Sequence[str],
    defendant_name: str,
    suit_premises: str,
    lease_ref: str,
    lease_expiry_date: Optional[date],
    s106_notice_ref: str,
    s106_notice_served_date: Optional[date],
    tenancy_end_date: Optional[date],
    damages_rate_per_day: int,
    wrongful_occupation_since: Optional[date],
    annual_rent: int,
    court_fee: int,
    cause_of_action_date: Optional[date],
    cause_of_action_place: str,
    jurisdiction_basis: str,
    filing_date: date,
    place: str,
    outside_rent_control: bool = True,
    # cause-title header (DPC book pp.22-24). Optional.
    plaintiff_address: Optional[str] = None,
    defendant_address: Optional[str] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> EjectmentResult:
    """Assemble the ejectment-and-damages suit, or refuse."""

    # 1. the s.106 notice is a condition precedent to ejectment.
    if not s106_notice_ref.strip() or s106_notice_served_date is None:
        return _refuse(
            "ejectment of a tenant under the Transfer of Property Act requires a "
            "notice under s.106 terminating the tenancy; the notice and its date of "
            "service must be pleaded and are absent",
            code="ejectment_s106_notice_missing",
            fields=("s106_notice_ref", "s106_notice_served_date"),
        )

    # 2. the notice must give clear 15 days before the tenancy-end date.
    if tenancy_end_date is None:
        return _refuse(
            "the date on which the tenancy is terminated by the s.106 notice must "
            "be pleaded",
            code="ejectment_tenancy_end_date_missing",
            fields=("tenancy_end_date",),
        )
    clear_days = (tenancy_end_date - s106_notice_served_date).days
    if clear_days < _NOTICE_CLEAR_DAYS:
        return _refuse(
            f"the s.106 notice does not give clear {_NOTICE_CLEAR_DAYS} days: served "
            f"{s106_notice_served_date}, tenancy terminated {tenancy_end_date} "
            f"({clear_days} days); the notice is invalid",
            code="ejectment_s106_notice_short",
            fields=("s106_notice_served_date", "tenancy_end_date"),
            computation=f"served={s106_notice_served_date}, "
                        f"end={tenancy_end_date}, clear_days={clear_days} "
                        f"(< {_NOTICE_CLEAR_DAYS})",
        )

    # 3. cause of action: date AND place.
    if cause_of_action_date is None:
        return _refuse(
            "cause of action requires a date; it is missing",
            code="ejectment_cause_of_action_date_missing",
            fields=("cause_of_action_date",),
        )
    if not cause_of_action_place.strip():
        return _refuse(
            "cause of action requires a place; it is missing",
            code="ejectment_cause_of_action_place_missing",
            fields=("cause_of_action_place",),
        )

    context: Dict[str, Any] = {
        "plaintiffs": list(plaintiff_names),
        "plaintiff_address": plaintiff_address,
        "defendant": {"name": defendant_name, "address": defendant_address},
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "suit_date": filing_date.isoformat(),
        "knowledge_para_last": 7,
        "suit_premises": suit_premises,
        "lease_ref": lease_ref,
        "lease_expiry_date": lease_expiry_date,
        "s106_notice_ref": s106_notice_ref,
        "s106_notice_served_date": s106_notice_served_date,
        "tenancy_end_date": tenancy_end_date,
        "clear_days": clear_days,
        "damages_rate_per_day": damages_rate_per_day,
        "wrongful_occupation_since": wrongful_occupation_since,
        "annual_rent": annual_rent,
        "court_fee": court_fee,
        "outside_rent_control": outside_rent_control,
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        "jurisdiction_basis": jurisdiction_basis,
        "has_verification": True,
        "place": place,
    }
    return EjectmentResult(refused=False, context=context)
