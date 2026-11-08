"""Suit for specific performance of contract — document pipeline (DPC book pp.25-26).

The plaintiff sues to compel the defendant to execute a sale deed under a written
agreement to sell. The book's suit pleads the agreement, earnest money, the
defendant's refusal, the legal notice, the plaintiff's readiness and willingness,
cause of action, limitation and jurisdiction.

Hard requirements (each refuses, no partial output):
  - A written agreement must be pleaded (Specific Relief Act needs an enforceable
    contract; and s.16(c) readiness-and-willingness is a mandatory averment).
  - The plaintiff's readiness and willingness to perform must be pleaded (a suit
    silent on it is defective — s.16(c) SRA).
  - Cause of action needs a date AND place.
  - Limitation (Art. 54): three years from the date fixed for performance, or,
    where none is fixed, from notice of refusal (the cause of action).

The suit is valued on the consideration (s.45(a) TN Court Fees and Suits
Valuation Act 1955); the fee is computed when not given.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional

from ..rules import court_fee as cf
from ..rules import limitation as lim
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

TEMPLATE = "specific_performance.docx"
SPEC = "dpc-25-26"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class SpecificPerformanceResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SpecificPerformanceResult:
    return SpecificPerformanceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="specific_performance", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    plaintiff_name: str,
    defendant_name: str,
    suit_property: str,
    agreement_date: Optional[date],
    agreement_ref: str,
    total_consideration: int,
    earnest_paid: int,
    balance_amount: int,
    readiness_and_willingness: bool,
    refusal_narrative: str,
    notice_ref: str,
    cause_of_action_date: Optional[date],
    cause_of_action_place: str,
    court_fee: Optional[int],
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.25-26). Optional.
    plaintiff_parentage: Optional[str] = None,
    plaintiff_address: Optional[str] = None,
    defendant_parentage: Optional[str] = None,
    defendant_address: Optional[str] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
    # optional prayers: in the alternative, refund of the earnest money with
    # interest (s.22(1)(b) SRA must be specifically claimed); a permanent
    # injunction restraining alienation of the suit property.
    alternative_refund: bool = False,
    refund_interest_rate: Optional[int] = None,
    injunction_against_alienation: bool = False,
    # the date fixed by the agreement for completing the sale (Art. 54).
    performance_date: Optional[date] = None,
) -> SpecificPerformanceResult:
    """Assemble the specific-performance suit, or refuse."""

    # 1. a written agreement is the foundation.
    if agreement_date is None or not agreement_ref.strip():
        return _refuse(
            "a suit for specific performance must plead the written agreement to "
            "sell (its date and identification); it is absent",
            code="specific_performance_agreement_not_pleaded",
            fields=("agreement_date", "agreement_ref"),
        )

    # 2. s.16(c) SRA — readiness and willingness is mandatory.
    if not readiness_and_willingness:
        return _refuse(
            "the plaintiff must plead readiness and willingness to perform his part "
            "of the contract (s.16(c) of the Specific Relief Act); a suit silent on "
            "it is defective and will not be generated",
            code="specific_performance_readiness_not_pleaded",
            fields=("readiness_and_willingness",),
        )

    # 3. arithmetic — earnest + balance == total.
    if earnest_paid + balance_amount != total_consideration:
        return _refuse(
            f"the consideration does not reconcile: earnest {earnest_paid} + "
            f"balance {balance_amount} = {earnest_paid + balance_amount}, but the "
            f"total agreed consideration is {total_consideration}",
            code="specific_performance_consideration_mismatch",
            fields=("earnest_paid", "balance_amount", "total_consideration"),
        )

    # 4. cause of action: date AND place.
    if cause_of_action_date is None:
        return _refuse(
            "cause of action requires a date; it is missing",
            code="specific_performance_cause_of_action_date_missing",
            fields=("cause_of_action_date",),
        )
    if not cause_of_action_place.strip():
        return _refuse(
            "cause of action requires a place; it is missing",
            code="specific_performance_cause_of_action_place_missing",
            fields=("cause_of_action_place",),
        )

    # 5. limitation — Art. 54: from the date fixed, else from notice of refusal.
    lim_result = lim.compute(accrual_date=performance_date or cause_of_action_date,
                             period_years=3, proceeding_class=lim.ProceedingClass.SUIT)
    if not lim.is_within_time(lim_result, filing_date=filing_date):
        return _refuse(
            f"suit is barred by limitation: Article 54 (three years) from "
            f"{performance_date or cause_of_action_date} expired on "
            f"{lim_result.expiry_date}; filing on {filing_date} is out of time",
            code="specific_performance_limitation_time_barred",
            fields=("performance_date", "cause_of_action_date", "filing_date"),
        )

    # 6. court fee — s.45(a): on the consideration; plus the injunction relief.
    fee_computed = not court_fee
    if fee_computed:
        reliefs = [cf.Relief(kind=cf.ReliefKind.MONEY, value=total_consideration)]
        if injunction_against_alienation:
            reliefs.append(cf.Relief(kind=cf.ReliefKind.INJUNCTION_FIXED))
        court_fee = cf.compute(reliefs=reliefs).fee

    context: Dict[str, Any] = {
        "plaintiff": {"name": plaintiff_name, "parentage": plaintiff_parentage,
                      "address": plaintiff_address},
        "defendant": {"name": defendant_name, "parentage": defendant_parentage,
                      "address": defendant_address},
        # The shared civil cause title loops over `defendants`; without it the
        # defendant line printed blank.
        "defendants": [{"name": defendant_name, "parentage": defendant_parentage,
                      "address": defendant_address}],
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "suit_date": filing_date.isoformat(),
        "knowledge_para_last": 8,
        "suit_property": suit_property,
        # b2 item 12: the schedule is always printed, from the property described.
        "schedule_property": (lambda s: (s[:1].upper() + s[1:]) if s else
                              "[schedule of the suit property (survey number, extent, village, "
                              "taluk, district and boundaries) to be provided]")(
            re.sub(r"^(?:a|an|the)\s+", "", (suit_property or "").strip().rstrip("."), flags=re.I)),
        "agreement_date": agreement_date,
        "agreement_ref": agreement_ref,
        "total_consideration": total_consideration,
        "earnest_paid": earnest_paid,
        "alternative_refund": alternative_refund,
        "refund_interest_rate": refund_interest_rate,
        "injunction_against_alienation": injunction_against_alienation,
        "balance_amount": balance_amount,
        "refusal_slot": refusal_narrative if refusal_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "notice_ref": notice_ref,
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        "court_fee": court_fee,
        "unverified_marker": (_reg.marker_for("court_fee_ad_valorem_slabs",
                                              "court_fee_fixed_fees") if fee_computed else ""),
        "performance_date": performance_date,
        "limitation_expiry": lim_result.expiry_date,
        "has_verification": True,
        "place": place,
    }
    return SpecificPerformanceResult(refused=False, context=context)
