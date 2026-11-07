"""List of documents for the appeal record with cost estimate (Form 476) — pipeline.

PARTY-FILED. On the admission of an appeal, the appellant (or respondent, where
so directed) files a schedule listing the documents to be translated and printed
for inclusion in the appeal record, against each of which is shown, whether the
whole or a part is to be printed, its mark in the lower court, the number of
pages of translation and of printing, and the estimated cost. The schedule
follows statutory Form 476 and is used to compute and deposit the translation and
printing charges. Generalised for any state.

Hard requirements (each refuses, no partial output):
  - The cost schedule must list at least one document to be translated/printed;
    an empty schedule serves no purpose and cannot be costed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "appeal_record_cost_schedule.docx"
SPEC = "tn-appealrec"


def _total(costs: Sequence[Optional[str]]) -> Optional[str]:
    """Sum of the per-row figures ("Rs. 1,200" -> 1200), or None when any row has
    no figure (the total is then a fill-in gap, never a guess)."""
    total = Decimal(0)
    for c in costs:
        digits = re.sub(r"(?i)^\s*(rs\.?|inr|₹)\s*", "", c or "").replace(",", "").rstrip("/- ").strip()
        try:
            total += Decimal(digits)
        except InvalidOperation:
            return None
    return format(total, "f")  # served copy gets Indian grouping (service/tidy.py)


@dataclass(frozen=True)
class RecordDocRow:
    description: str
    whole_or_part: Optional[str] = None
    mark_in_lower_court: Optional[str] = None
    pages_translation: Optional[str] = None
    pages_printing: Optional[str] = None
    cost_estimate: Optional[str] = None


@dataclass(frozen=True)
class AppealRecordCostScheduleResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> AppealRecordCostScheduleResult:
    return AppealRecordCostScheduleResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="appeal_record_cost_schedule", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    appeal_ref: str,
    on_behalf_of: str,
    documents: Sequence[RecordDocRow],
    place: str,
    court_type: Optional[str] = None,
    court_place: Optional[str] = None,
    copies_required: Optional[str] = None,
    counsel_name: Optional[str] = None,
    lower_court_case: Optional[str] = None,
    lower_court: Optional[str] = None,
) -> AppealRecordCostScheduleResult:
    """Assemble the Form 476 appeal-record cost schedule, or refuse."""

    # 1. the cost schedule must list at least one document to be translated/printed.
    rows: List[RecordDocRow] = [
        r for r in documents if r.description and r.description.strip()
    ]
    if not rows:
        return _refuse(
            "the cost schedule must list at least one document to be "
            "translated/printed; an empty schedule serves no purpose and cannot be "
            "costed",
            code="appeal_record_no_documents",
            fields=("documents",),
        )

    context: Dict[str, Any] = {
        "appeal_ref": appeal_ref,
        "on_behalf_of": on_behalf_of,
        "documents": [
            {
                "description": r.description,
                "whole_or_part": r.whole_or_part,
                "mark_in_lower_court": r.mark_in_lower_court,
                "pages_translation": r.pages_translation,
                "pages_printing": r.pages_printing,
                "cost_estimate": r.cost_estimate,
            }
            for r in rows
        ],
        "court_type": court_type,
        "court_place": court_place,
        "copies_required": copies_required,
        "counsel_name": counsel_name,
        "place": place,
        "lower_court_case": lower_court_case,
        "lower_court": re.sub(r"^the\s+", "", (lower_court or "").strip(), flags=re.I),
        # The engine holds no verified copying/printing rate table, so a cost is
        # only ever the advocate's own figure; the total is their sum, else a gap.
        "total_cost": _total([r.cost_estimate for r in rows]),
    }
    return AppealRecordCostScheduleResult(refused=False, context=context)
