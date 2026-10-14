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
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional

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
    court_fee: int,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.25-26). Optional.
    plaintiff_parentage: Optional[str] = None,
    plaintiff_address: Optional[str] = None,
    defendant_parentage: Optional[str] = None,
    defendant_address: Optional[str] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
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

    context: Dict[str, Any] = {
        "plaintiff": {"name": plaintiff_name, "parentage": plaintiff_parentage,
                      "address": plaintiff_address},
        "defendant": {"name": defendant_name, "parentage": defendant_parentage,
                      "address": defendant_address},
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "suit_date": filing_date.isoformat(),
        "knowledge_para_last": 8,
        "suit_property": suit_property,
        "agreement_date": agreement_date,
        "agreement_ref": agreement_ref,
        "total_consideration": total_consideration,
        "earnest_paid": earnest_paid,
        "balance_amount": balance_amount,
        "refusal_slot": refusal_narrative if refusal_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "notice_ref": notice_ref,
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        "court_fee": court_fee,
        "has_verification": True,
        "place": place,
    }
    return SpecificPerformanceResult(refused=False, context=context)
