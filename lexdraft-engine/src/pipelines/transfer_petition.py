"""Transfer Petition (Civil) under s.25 CPC — document pipeline (DPC book pp.31-35).

Filed in the Supreme Court's original civil jurisdiction to transfer a case from a
court in one State to a court in another State, in the interest of justice. The
book (pp.31-35) recites the case sought to be transferred, brief facts, grounds
(loss of faith, threat, penury/inability to travel, interest of justice) and a
declaration of no other similar transfer petition.

Hard requirements (each refuses, no partial output):
  - The case sought to be transferred and BOTH courts (from-court in one State,
    to-court in another State) must be identified — s.25 only transfers inter-State.
  - The grounds for transfer must be pleaded (a bare transfer prayer is refused).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "transfer_petition.docx"
SPEC = "dpc-31-35"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class TransferPetitionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> TransferPetitionResult:
    return TransferPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="transfer_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondents: Sequence[str],
    case_to_transfer: str,
    from_court: str,
    from_state: str,
    to_court: str,
    to_state: str,
    brief_facts: str,
    grounds: Sequence[str],
    no_other_transfer_petition: bool,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.31-35). Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
) -> TransferPetitionResult:
    """Assemble the s.25 CPC transfer petition, or refuse."""

    # 1. inter-State transfer requires both courts and both States identified.
    missing = [f for f, v in (("case_to_transfer", case_to_transfer),
                              ("from_court", from_court), ("from_state", from_state),
                              ("to_court", to_court), ("to_state", to_state))
               if not v.strip()]
    if missing:
        return _refuse(
            "a transfer petition under s.25 CPC must identify the case to be "
            "transferred and both the transferor court (with its State) and the "
            "transferee court (with its State); the following are missing: "
            + ", ".join(missing),
            code="transfer_petition_courts_not_identified",
            fields=tuple(missing),
        )

    # 2. s.25 transfers only BETWEEN States.
    if from_state.strip().lower() == to_state.strip().lower():
        return _refuse(
            "s.25 CPC empowers the Supreme Court to transfer a case from a court in "
            "one State to a court in another State; both courts are in "
            f"{from_state}, so s.25 is not available (an intra-State transfer lies to "
            "the High Court under s.24 CPC)",
            code="transfer_petition_not_inter_state",
            fields=("from_state", "to_state"),
        )

    # 3. grounds must be pleaded.
    if not grounds or not any(g.strip() for g in grounds):
        return _refuse(
            "the grounds for transfer (in the interest of justice) must be pleaded; "
            "a bare transfer prayer is refused",
            code="transfer_petition_no_grounds", fields=("grounds",),
        )

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondents": list(respondents),
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "case_to_transfer": case_to_transfer,
        "from_court": from_court,
        "from_state": from_state,
        "to_court": to_court,
        "to_state": to_state,
        "brief_facts_slot": brief_facts if brief_facts.strip()
                            else _LLM_SLOT_PLACEHOLDER,
        "grounds": [g for g in grounds if g.strip()],
        "no_other_transfer_petition": no_other_transfer_petition,
        "place": place,
    }
    return TransferPetitionResult(refused=False, context=context)
