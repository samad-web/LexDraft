"""Execution Application (O21 CPC) — document pipeline (DPC book pp.36-37).

The decree-holder applies to execute a decree/order against the judgment-debtor.
The book (pp.36-37) uses a 10-column tabular form (suit no., parties, decree date,
appeal, payments, prior applications, amount + interest, costs, against whom,
mode of assistance sought) followed by prayer + verification.

Hard requirements (each refuses, no partial output):
  - The decree/order sought to be executed must be identified (its date) — there is
    nothing to execute otherwise.
  - The mode in which the court's assistance is sought (column 10) must be stated —
    an execution application must specify the relief (attachment, arrest, sale...).
  - The application must be accompanied by a certified copy of the decree (book
    footnote; O21 R11); the flag must be affirmed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "execution_application.docx"
SPEC = "dpc-36-37"


@dataclass(frozen=True)
class ExecutionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> ExecutionResult:
    return ExecutionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="execution_application", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    decree_holder_name: str,
    judgment_debtor_name: str,
    execution_court: str,
    suit_no: str,
    decree_date: Optional[date],
    appeal_filed: bool,
    payment_received: str,
    prior_applications: str,
    decretal_amount: int,
    interest_note: str,
    costs_amount: int,
    execution_against: str,
    mode_of_assistance: str,
    certified_copy_attached: bool,
    filing_date: date,
    place: str,
    police_station: Optional[str] = None,
) -> ExecutionResult:
    """Assemble the execution application, or refuse."""

    # 1. there must be a decree/order to execute.
    if decree_date is None or not suit_no.strip():
        return _refuse(
            "an execution application must identify the decree/order sought to be "
            "executed (the suit number and the date of the decree); it is absent",
            code="execution_decree_not_identified",
            fields=("suit_no", "decree_date"),
        )

    # 2. the mode of assistance sought (column 10) must be stated.
    if not mode_of_assistance.strip():
        return _refuse(
            "the manner in which the court's assistance is sought (e.g. attachment "
            "and sale of property, arrest and detention of the judgment-debtor, "
            "delivery of possession) must be stated; it is absent",
            code="execution_mode_not_stated",
            fields=("mode_of_assistance",),
        )

    # 3. O21 R11 — certified copy of the decree must accompany the application.
    if not certified_copy_attached:
        return _refuse(
            "the execution application must be accompanied by a duly certified copy "
            "of the decree or order (Order XXI Rule 11 CPC); the flag is not "
            "affirmed",
            code="execution_certified_copy_missing",
            fields=("certified_copy_attached",),
        )

    context: Dict[str, Any] = {
        "decree_holder": {"name": decree_holder_name},
        "judgment_debtor": {"name": judgment_debtor_name},
        "execution_court": execution_court,
        "execution_year": filing_date.year,
        "execution_date": filing_date.isoformat(),
        "police_station": police_station,
        "suit_no": suit_no,
        "decree_date": decree_date,
        "appeal_filed": appeal_filed,
        "payment_received": payment_received or "Nil",
        "prior_applications": prior_applications or "Nil",
        "decretal_amount": decretal_amount,
        "interest_note": interest_note,
        "costs_amount": costs_amount,
        "execution_against": execution_against,
        "mode_of_assistance": mode_of_assistance,
        "certified_copy_attached": certified_copy_attached,
        "place": place,
    }
    return ExecutionResult(refused=False, context=context)
