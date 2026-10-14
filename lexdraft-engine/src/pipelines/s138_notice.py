"""s.138 NI Act statutory notice — document pipeline (spec 2.2).

Highest-risk template in the P0 set. Every defect REFUSES (no warning, no partial
output) and shows the computation. If the notice window has lapsed, do not
generate — show the computation and stop.

Window and amount hard stops are DELEGATED to src.rules.s138_windows (which owns
the boundary-tested arithmetic). This pipeline adds the 2.2-specific requirements
and assembles the docxtpl context.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..rules import s138_windows as windows
from ..components.amount_words import rupees_in_words
from ..verify.refusals import Refusal, Severity

TEMPLATE = "s138_notice.docx"
SPEC = "2.2"

_COMPLIANCE_DAYS = 15  # statutory; exactly 15, never fewer


class NoticeInputError(ValueError):
    pass


@dataclass(frozen=True)
class Cheque:
    number: str
    date: date
    amount: int
    bank: str
    branch: str
    drawer: str
    payee: str


@dataclass(frozen=True)
class NoticeResult:
    refused: bool
    reason: str = ""
    computation: Optional[str] = None
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
    """Build a refused result carrying a stable code. Every s.138-notice refusal
    goes through here so none can be code-less."""
    return NoticeResult(
        refused=True, reason=reason, computation=computation, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="s138_notice", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _refuse_delegated(assessment) -> NoticeResult:
    """Surface a rule-module refusal (already carrying its own Refusal) as a
    NoticeResult without restating the code."""
    return NoticeResult(
        refused=True, reason=assessment.reason,
        computation=assessment.computation, context=None,
        refusal=assessment.refusal,
    )


def build(
    *,
    client: str,
    advocate: str,
    advocate_enrolment: str,
    recipient_name: str,
    recipient_address: str,
    cheques: Sequence[Cheque],
    debt_nature: str,
    debt_documents: Sequence[str],
    presentation_date: date,
    presentation_bank: str,
    memo_date: date,
    memo_received_date: Optional[date],
    dishonour_reason: str,
    notice_date: date,
    dispatch_mode: str,
    dispatch_tracking_placeholder: str,
    place: str,
    # advocate letterhead + second-service address (DPC book pp.130-131). Optional.
    advocate_chamber: Optional[str] = None,
    advocate_phone: Optional[str] = None,
    dispatch_line: Optional[str] = None,
    recipient_also_at: Optional[str] = None,
    compliance_days: int = _COMPLIANCE_DAYS,
    override_demand_amount: Optional[int] = None,
) -> NoticeResult:
    """Assemble the s.138 statutory notice, or refuse with the computation."""

    # --- structural preconditions (2.2-specific) ---
    if not cheques:
        return _refuse(
            "notice has no cheque particulars",
            code="s138_notice_no_cheque_particulars", fields=("cheques",),
        )

    if memo_received_date is None:
        return _refuse(
            "date of receipt of the dishonour memo is required — the limitation "
            "anchor is the receipt date, not the memo date",
            code="s138_notice_memo_receipt_date_missing",
            fields=("memo_received_date",),
        )

    if not dishonour_reason.strip():
        return _refuse(
            "dishonour reason (as stated in the bank memo, verbatim) is required",
            code="s138_notice_dishonour_reason_missing",
            fields=("dishonour_reason",),
        )

    if not dispatch_tracking_placeholder.strip():
        return _refuse(
            "dispatch proof placeholder is mandatory (proof of dispatch must be "
            "recorded on the notice)",
            code="s138_notice_dispatch_proof_missing",
            fields=("dispatch_tracking_placeholder",),
        )

    if compliance_days != _COMPLIANCE_DAYS:
        return _refuse(
            f"compliance period must be exactly {_COMPLIANCE_DAYS} days "
            f"(got {compliance_days}); the drawer's statutory time to pay cannot "
            f"be shortened or extended",
            code="s138_notice_compliance_period_not_15_days",
            fields=("compliance_days",),
        )

    # --- consolidated demand = sum of cheque amounts ---
    demand_amount = sum(c.amount for c in cheques)

    # A tampered/explicit demand that disagrees with the cheque total is a defect.
    if override_demand_amount is not None and override_demand_amount != demand_amount:
        return _refuse(
            f"demand amount ({override_demand_amount}) does not equal the total "
            f"cheque amount ({demand_amount})",
            code="s138_notice_override_demand_not_equal_cheque_total",
            fields=("override_demand_amount", "cheques"),
            computation=f"cheque total={demand_amount}; demand={override_demand_amount}",
        )

    # --- delegated hard stops, per cheque ---
    for c in cheques:
        pres = windows.check_presentation(cheque_date=c.date,
                                          presented_date=presentation_date)
        if not pres.valid:
            return _refuse(
                f"cheque {c.number} presented beyond validity: presented "
                f"{presentation_date}, cheque dated {c.date}, valid to "
                f"{pres.last_valid_date}",
                code="s138_notice_cheque_presented_after_validity",
                # Name the cheque DATE specifically (not the whole cheque list),
                # so the adapter can point the frontend at the offending sub-field.
                fields=("cheque_dates", "presentation_date"),
                computation=f"cheque {c.number}: valid_to={pres.last_valid_date}, "
                            f"presented={presentation_date}",
            )

    # --- delegated notice-window + demand-amount hard stop ---
    # Demand must equal the (consolidated) cheque amount; check_notice enforces
    # both the 30-day window and demand==amount. The rule module attaches its own
    # coded Refusal; surface it without restating the code.
    notice_check = windows.check_notice(
        memo_received=memo_received_date,
        notice_date=notice_date,
        cheque_amount=demand_amount,
        demand_amount=demand_amount,
    )
    if notice_check.refused:
        return _refuse_delegated(notice_check)

    # --- build context ---
    context: Dict[str, Any] = {
        "client": client,
        "advocate": advocate,
        "advocate_enrolment": advocate_enrolment,
        "advocate_chamber": advocate_chamber,
        "advocate_phone": advocate_phone,
        "dispatch_line": dispatch_line,
        "under_instructions": True,
        "recipient": {"name": recipient_name, "address": recipient_address,
                      "also_at": recipient_also_at},
        "cheques": [
            {
                "number": c.number,
                "date": c.date.isoformat(),
                "amount": c.amount,
                "amount_words": rupees_in_words(c.amount),
                "bank": c.bank,
                "branch": c.branch,
                "drawer": c.drawer,
                "payee": c.payee,
            }
            for c in cheques
        ],
        "is_multiple_cheques": len(cheques) > 1,
        "debt_nature": debt_nature,
        "debt_documents": list(debt_documents),
        "cheque_in_discharge": True,          # mandatory averment
        "presentation_date": presentation_date,
        "presentation_bank": presentation_bank,
        "memo_date": memo_date,
        "memo_received_date": memo_received_date,   # limitation anchor
        "dishonour_reason": dishonour_reason,       # verbatim
        "notice_date": notice_date,
        "demand_amount": demand_amount,
        "demand_words": rupees_in_words(demand_amount),
        "compliance_days": compliance_days,
        "dispatch_mode": dispatch_mode,
        "dispatch_tracking_placeholder": dispatch_tracking_placeholder,
        "place": place,
    }

    return NoticeResult(refused=False, context=context)
