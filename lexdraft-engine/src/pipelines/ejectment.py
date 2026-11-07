"""Suit for ejectment and damages for wrongful use and occupation
— document pipeline (DPC book pp.22-24).

The landlord sues a tenant who holds over after a s.106 TPA notice terminating
the month-to-month tenancy. The book's suit pleads the lease, its expiry, the
s.106 notice + its valid service (clear 15 days), the wrongful occupation and the
damages rate, cause of action, jurisdiction (premises outside Rent Control), and
the valuation: s.50 TN Court Fees and Suits Valuation Act 1955 (the rent for the
year before the plaint) for possession, plus the arrears and damages claimed.
A vacant site is outside the TN 2017 Tenancy Act, which governs buildings.

Hard requirements (each refuses, no partial output):
  - A s.106 TPA notice terminating the tenancy must be pleaded, with its service
    date (the notice is a condition precedent to ejectment of a TPA tenant).
  - The notice must give clear 15 days before the tenancy-end date (s.106 TPA).
  - Cause of action needs a date AND place.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence

from ..rules import court_fee as cf
from ..rules import interest as intr
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

TEMPLATE = "ejectment.docx"
SPEC = "dpc-22-24"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_NOTICE_CLEAR_DAYS = 15  # s.106 TPA: clear 15 days' notice
_VACANT = re.compile(r"\b(?:vacant|open)\s+(?:site|land|plot)\b", re.I)
_S16_BASIS = ("the suit property is situate within the local limits of this Hon'ble "
              "Court, and a suit for the recovery of immovable property lies here under "
              "Section 16 of the Code of Civil Procedure, 1908")


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
    lease_expiry_date: Optional[date],  # None: month to month from the start
    s106_notice_ref: str,
    s106_notice_served_date: Optional[date],
    tenancy_end_date: Optional[date],
    damages_rate_per_day: Optional[int],
    wrongful_occupation_since: Optional[date],
    annual_rent: Optional[int],
    court_fee: Optional[int],
    cause_of_action_date: Optional[date],
    cause_of_action_place: str,
    jurisdiction_basis: Optional[str],
    filing_date: date,
    place: str,
    outside_rent_control: bool = True,
    # cause-title header (DPC book pp.22-24). Optional.
    plaintiff_address: Optional[str] = None,
    defendant_address: Optional[str] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
    # arrears of rent (monthly rent x months unpaid) and damages for use and
    # occupation at a monthly rate — each computed and printed. Optional.
    monthly_rent: Optional[int] = None,
    arrears_from_date: Optional[date] = None,
    arrears_months: Optional[int] = None,
    damages_rate_per_month: Optional[int] = None,
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

    # 4. the money claims, computed — never "Rs. 0/-".
    if not annual_rent and monthly_rent:
        annual_rent = monthly_rent * 12
    arrears = None
    if monthly_rent and (arrears_from_date or arrears_months):
        arrears = intr.arrears_of_rent(monthly_rent, arrears_from_date or tenancy_end_date,
                                       tenancy_end_date, arrears_months)
    damages_from = wrongful_occupation_since or (tenancy_end_date + timedelta(days=1))
    if damages_rate_per_day:
        rate, per = damages_rate_per_day, "day"
    elif damages_rate_per_month:
        rate, per = damages_rate_per_month, "month"
    else:
        rate, per = None, None
    past_damages = (intr.damages_for_period(rate, per, damages_from, filing_date)
                    if rate and filing_date > damages_from else None)

    # 5. valuation: s.50 TN CF & SV Act (a year's rent) for possession, plus the
    #    arrears and damages claimed; the fee is computed unless the advocate gave it.
    valuation_total, fee_computed = None, False
    if annual_rent:
        valuation_total = (annual_rent + (arrears.amount if arrears else 0)
                           + (past_damages.amount if past_damages else 0))
        if not court_fee:
            fee_computed = True
            court_fee = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY,
                                                      value=valuation_total)]).fee

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
        "damages_rate": rate,
        "damages_per": per,
        "damages_from": damages_from,
        "arrears": {"amount": arrears.amount, "working": arrears.text} if arrears else None,
        "past_damages": ({"amount": past_damages.amount, "working": past_damages.text}
                         if past_damages else None),
        "wrongful_occupation_since": wrongful_occupation_since,
        "annual_rent": annual_rent,
        "court_fee": court_fee or None,
        "valuation_total": valuation_total,
        # the engine's fee uses the VERIFY slab table; an advocate's own figure doesn't
        "unverified_marker": (_reg.marker_for("court_fee_ad_valorem_slabs")
                              if fee_computed else ""),
        "outside_rent_control": outside_rent_control,
        "vacant_land": bool(_VACANT.search(suit_premises or "")),
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        "jurisdiction_basis": (jurisdiction_basis or "").strip() or _S16_BASIS,
        "has_verification": True,
        "place": place,
    }
    return EjectmentResult(refused=False, context=context)
