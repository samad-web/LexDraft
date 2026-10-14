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

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "appeal_record_cost_schedule.docx"
SPEC = "tn-appealrec"


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
    }
    return AppealRecordCostScheduleResult(refused=False, context=context)
