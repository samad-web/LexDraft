"""General demand notice — document pipeline (spec 2.1).

LLM slots are paragraphs 4, 6, 7, 8 ONLY (transaction narrative, breach, prior
demands, loss). Demand (para 9) and consequence (para 10) are RULE-DRIVEN and
assembled from fields — never model-written.

Validation:
  - Compliance period must meet the statutory minimum where a statute applies.
  - Amount in figures and words must match (reuse amount_words).
  - Client authority averment present.
  - Specific consequence stated (not a vague threat).
  - Dispatch proof placeholder present.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..components.amount_words import rupees_in_words
from ..verify.refusals import Refusal, Severity

TEMPLATE = "general_notice.docx"
SPEC = "2.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class NoticeResult:
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
    computation: Optional[str] = None,
    remedy_hint: str = "none",
) -> NoticeResult:
    return NoticeResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="general_notice", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


# "refund the security deposit of Rs. 1,50,000 to my client, together with ..." ->
# "Demand for refund of the security deposit of Rs. 1,50,000" (b4 item 5: a Sub: line).
_NOUN = {"refund": "refund of", "repay": "repayment of", "pay": "payment of",
         "return": "return of", "deliver": "delivery of", "release": "release of"}


def _subject(subject: str, act_required: str, demand_amount: int) -> str:
    s = re.sub(r"^\s*sub(?:ject)?\s*[:.-]\s*", "", subject or "", flags=re.I).strip().rstrip(".")
    if s:
        return s
    act = re.split(r",\s|\btogether with\b|\bwithin\b", act_required or "", maxsplit=1)[0].strip().rstrip(".")
    act = re.sub(r"\s+to\s+(?:my|our)\s+client$", "", act, flags=re.I)
    m = re.match(r"(?:to\s+)?(\w+)\s+(.+)", act)
    if m and m.group(1).lower() in _NOUN:
        return f"Demand for {_NOUN[m.group(1).lower()]} {m.group(2)}"
    return f"Demand that you {act}" if act else f"Demand for payment of Rs. {demand_amount}/-"


def build(
    *,
    client: str,
    advocate: str,
    advocate_enrolment: str,
    recipient_name: str,
    recipient_address: str,
    recipient_mode: str,
    demand_amount: int,
    act_required: str,
    compliance_days: int,
    statutory_minimum_days: Optional[int],
    civil_consequence: str,
    criminal_consequence: Optional[str],
    dispatch_tracking_placeholder: str,
    transaction_narrative: str,
    breach_narrative: str,
    prior_demands_narrative: str,
    loss_narrative: str,
    notice_date: date,
    place: str,
    subject: str = "",
) -> NoticeResult:
    """Assemble the general demand notice, or refuse."""

    # --- demand must be a real sum ---
    if demand_amount <= 0:
        return _refuse(
            "a demand notice must specify a positive sum demanded",
            code="general_notice_non_positive_demand",
            fields=("demand_amount",),
        )

    # --- compliance period vs statutory minimum ---
    if statutory_minimum_days is not None and compliance_days < statutory_minimum_days:
        return _refuse(
            f"compliance period of {compliance_days} days is below the statutory "
            f"minimum of {statutory_minimum_days} days that applies to this notice",
            code="general_notice_compliance_below_statutory_minimum",
            fields=("compliance_days", "statutory_minimum_days"),
            computation=f"compliance_days={compliance_days}; "
                        f"statutory_minimum_days={statutory_minimum_days}",
        )

    # --- specific consequence (not a vague threat) ---
    if not (civil_consequence.strip() or (criminal_consequence or "").strip()):
        return _refuse(
            "a specific consequence of non-compliance must be stated (civil suit "
            "and/or criminal proceedings); a vague threat is not sufficient",
            code="general_notice_no_specific_consequence",
            fields=("civil_consequence", "criminal_consequence"),
        )

    # --- dispatch proof placeholder ---
    if not dispatch_tracking_placeholder.strip():
        return _refuse(
            "dispatch proof placeholder is mandatory",
            code="general_notice_dispatch_proof_missing",
            fields=("dispatch_tracking_placeholder",),
        )

    context: Dict[str, Any] = {
        "client": client,
        "advocate": advocate,
        "advocate_enrolment": advocate_enrolment,
        "under_instructions": True,
        "recipient": {"name": recipient_name, "address": recipient_address,
                      "mode": recipient_mode},
        # rule-driven demand + consequence (never LLM)
        "demand_amount": demand_amount,
        "demand_words": rupees_in_words(demand_amount),
        "act_required": act_required,
        # b4 item 9: a demand with interest is not "being the sum of" the principal alone.
        "interest_in_demand": bool(re.search(r"\binterest\b", act_required or "", re.I)),
        "compliance_days": compliance_days,
        "civil_consequence": civil_consequence,
        "criminal_consequence": criminal_consequence,
        "dispatch_tracking_placeholder": dispatch_tracking_placeholder,
        # LLM slots (paragraphs 4, 6, 7, 8)
        "transaction_slot": transaction_narrative if transaction_narrative.strip()
                            else _LLM_SLOT_PLACEHOLDER,
        "breach_slot": breach_narrative if breach_narrative.strip()
                       else _LLM_SLOT_PLACEHOLDER,
        "prior_demands_slot": prior_demands_narrative if prior_demands_narrative.strip()
                              else _LLM_SLOT_PLACEHOLDER,
        "loss_slot": loss_narrative if loss_narrative.strip()
                     else _LLM_SLOT_PLACEHOLDER,
        "subject": _subject(subject, act_required, demand_amount),
        "notice_date": notice_date,
        "place": place,
    }
    return NoticeResult(refused=False, context=context)
