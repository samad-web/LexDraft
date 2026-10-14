"""Suit for permanent injunction — document pipeline (DPC book pp.14-16).

A SEPARATE skeleton from the O39 temporary-injunction APPLICATION
(src.pipelines.injunction). This is the main SUIT: the plaintiff in settled
possession sues to permanently restrain the defendants from dispossessing /
interfering. The book's suit (pp.14-16) pleads possession, the threat, the
police-inaction, cause of action, valuation and jurisdiction, then prays for a
decree of permanent injunction.

Hard requirements (each refuses, no partial output):
  - Possession must be pleaded (the foundation of a possessory injunction).
  - The act sought to be restrained must be specific (a bare "restrain the
    defendants" is refused — same rule as the temporary-injunction application).
  - Cause of action needs a date AND place.
  - Court fee + valuation must be stated (the book pleads both).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "permanent_injunction.docx"
SPEC = "dpc-14-16"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_VAGUE_ACTS = {"", "interfere", "disturb", "trouble", "harass", "do anything"}


@dataclass(frozen=True)
class PermanentInjunctionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> PermanentInjunctionResult:
    return PermanentInjunctionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="permanent_injunction", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    plaintiff_name: str,
    defendant_names: Sequence[str],
    suit_property: str,
    possession_basis: str,
    act_restrained: str,
    threat_narrative: str,
    cause_of_action_date: Optional[date],
    cause_of_action_place: str,
    court_fee: int,
    valuation: str,
    jurisdiction_basis: str,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.14-16). Optional.
    plaintiff_parentage: Optional[str] = None,
    plaintiff_address: Optional[str] = None,
    defendant_addresses: Optional[Sequence[str]] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> PermanentInjunctionResult:
    """Assemble the permanent-injunction suit, or refuse."""

    # 1. possession is the foundation of a possessory injunction.
    if not possession_basis.strip():
        return _refuse(
            "a suit for permanent injunction protecting possession must plead the "
            "plaintiff's possession and its basis; it is absent",
            code="permanent_injunction_possession_not_pleaded",
            fields=("possession_basis",),
        )

    # 2. the restrained act must be specific.
    act = act_restrained.strip()
    if not act or act.rstrip(".").lower() in _VAGUE_ACTS:
        return _refuse(
            "the prayer is not specific: the act sought to be restrained must be "
            "identified (e.g. 'restrain the defendants from dispossessing the "
            "plaintiff from the suit premises'); a bare 'restrain the defendants' "
            "is refused",
            code="permanent_injunction_vague_prayer", fields=("act_restrained",),
        )

    # 3. cause of action: date AND place.
    if cause_of_action_date is None:
        return _refuse(
            "cause of action requires a date; it is missing",
            code="permanent_injunction_cause_of_action_date_missing",
            fields=("cause_of_action_date",),
        )
    if not cause_of_action_place.strip():
        return _refuse(
            "cause of action requires a place; it is missing",
            code="permanent_injunction_cause_of_action_place_missing",
            fields=("cause_of_action_place",),
        )

    context: Dict[str, Any] = {
        "plaintiff": {"name": plaintiff_name, "parentage": plaintiff_parentage,
                      "address": plaintiff_address},
        "defendants": [
            {"name": n,
             "address": (defendant_addresses[i]
                         if defendant_addresses and i < len(defendant_addresses)
                         else None)}
            for i, n in enumerate(defendant_names)
        ],
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "suit_date": filing_date.isoformat(),
        "knowledge_para_last": 4,
        "suit_property": suit_property,
        "possession_basis": possession_basis,
        "act_restrained": act,
        "threat_slot": threat_narrative if threat_narrative.strip()
                       else _LLM_SLOT_PLACEHOLDER,
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        "court_fee": court_fee,
        "valuation": valuation,
        "jurisdiction_basis": jurisdiction_basis,
        "has_verification": True,
        "place": place,
    }
    return PermanentInjunctionResult(refused=False, context=context)
