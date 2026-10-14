"""Writ Petition (Criminal) under Art.226/227 r/w s.482 CrPC
— document pipeline (DPC book pp.63-66).

Used to challenge a detention order (here, under a preventive-detention statute) at
the pre-execution stage and seek its quashing plus production of the grounds of
detention. The book (pp.63-66) recites the impugned detention order, the falsity of
the grounds, the Alka Subhash Gadia / Deepak Bajaj pre-execution exceptions, the
delay, and prays for mandamus (produce record) + certiorari (quash).

Hard requirements (each refuses, no partial output):
  - The impugned order (its reference + date) must be identified — there is nothing
    to quash otherwise.
  - At least one ground must be pleaded (a bare quashing prayer is refused).
  - The no-similar-petition declaration is mandatory (as in the civil writ).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "writ_criminal.docx"
SPEC = "dpc-63-66"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class WritCriminalResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> WritCriminalResult:
    return WritCriminalResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="writ_criminal", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondents: Sequence[str],
    impugned_order_ref: str,
    impugned_order_date: Optional[date],
    impugned_order_statute: str,
    facts_narrative: str,
    grounds: Sequence[str],
    pre_execution_stage: bool,
    no_similar_petition: bool,
    filing_date: date,
    place: str,
    high_court: Optional[str] = None,
    # cause-title header (DPC book pp.63-66). Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
) -> WritCriminalResult:
    """Assemble the criminal writ petition, or refuse."""

    # 1. the impugned order must be identified.
    if not impugned_order_ref.strip() or impugned_order_date is None:
        return _refuse(
            "a writ petition to quash an order must identify the impugned order (its "
            "reference and date); it is absent",
            code="writ_criminal_impugned_order_not_identified",
            fields=("impugned_order_ref", "impugned_order_date"),
        )

    # 2. at least one ground.
    if not grounds or not any(g.strip() for g in grounds):
        return _refuse(
            "the grounds on which the impugned order is challenged must be pleaded; a "
            "bare quashing prayer is refused",
            code="writ_criminal_no_grounds", fields=("grounds",),
        )

    # 3. no-similar-petition declaration (mandatory).
    if not no_similar_petition:
        return _refuse(
            "the petition must declare that no similar petition has been filed before "
            "this Hon'ble Court or the Hon'ble Supreme Court; that declaration is "
            "absent",
            code="writ_criminal_no_similar_petition_declaration_missing",
            fields=("no_similar_petition",),
        )

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondents": list(respondents),
        "high_court": high_court,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date,
        "impugned_order_statute": impugned_order_statute,
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "grounds": [g for g in grounds if g.strip()],
        "pre_execution_stage": pre_execution_stage,
        "no_similar_petition": no_similar_petition,
        "place": place,
    }
    return WritCriminalResult(refused=False, context=context)
