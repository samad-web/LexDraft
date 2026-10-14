"""Application under O39 R2-A CPC (disobedience of an injunction order)
— document pipeline (DPC book pp.19-20).

Where a party wilfully disobeys an injunction order, the aggrieved party applies
under O39 R2-A for the disobeying party to be detained in civil imprisonment and
his property attached. The book (pp.19-20) pleads the earlier injunction order,
the disobedience (forcible dispossession despite the order), and prays for
detention + attachment + restoration of possession.

Hard requirements (each refuses, no partial output):
  - The injunction order alleged to be disobeyed must be identified (its date) —
    O39 R2-A presupposes a subsisting order.
  - The disobedience must be pleaded with knowledge (the party disobeyed "in spite
    of the service and knowledge" of the order); a bare allegation is refused.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "o39_r2a_application.docx"
SPEC = "dpc-19-20"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class O39R2AResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> O39R2AResult:
    return O39R2AResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="o39_r2a_application", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    applicant_name: str,
    respondent_name: str,
    suit_ref: str,
    injunction_order_date: Optional[date],
    respondent_had_knowledge: bool,
    disobedience_narrative: str,
    disobedience_date: Optional[date],
    property_list_attached: bool,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.19-20). Optional.
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> O39R2AResult:
    """Assemble the O39 R2-A application, or refuse."""

    # 1. the injunction order alleged to be disobeyed must be identified.
    if injunction_order_date is None:
        return _refuse(
            "an application under Order XXXIX Rule 2-A presupposes a subsisting "
            "injunction order; the date of the order alleged to be disobeyed must be "
            "pleaded and is absent",
            code="o39_r2a_injunction_order_not_identified",
            fields=("injunction_order_date",),
        )

    # 2. disobedience with knowledge is the gravamen (civil imprisonment follows).
    if not respondent_had_knowledge:
        return _refuse(
            "Order XXXIX Rule 2-A requires the disobedience to be wilful — the "
            "respondent must be shown to have had knowledge of the injunction order; "
            "that averment is absent and detention cannot be sought",
            code="o39_r2a_knowledge_not_pleaded",
            fields=("respondent_had_knowledge",),
        )
    if not disobedience_narrative.strip():
        return _refuse(
            "the acts of disobedience must be pleaded specifically; a bare "
            "allegation of disobedience is refused",
            code="o39_r2a_disobedience_not_specific",
            fields=("disobedience_narrative",),
        )

    context: Dict[str, Any] = {
        "applicant": {"name": applicant_name},
        "respondent": {"name": respondent_name},
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "application_date": filing_date.isoformat(),
        "suit_ref": suit_ref,
        "injunction_order_date": injunction_order_date,
        "respondent_had_knowledge": respondent_had_knowledge,
        "disobedience_slot": disobedience_narrative,
        "disobedience_date": disobedience_date,
        "property_list_attached": property_list_attached,
        "place": place,
    }
    return O39R2AResult(refused=False, context=context)
