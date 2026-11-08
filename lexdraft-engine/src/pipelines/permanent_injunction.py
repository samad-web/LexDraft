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

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..components.prayer import relief_clause
from ..verify.refusals import Refusal, Severity
from ._court import gender_of

TEMPLATE = "permanent_injunction.docx"
SPEC = "dpc-14-16"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_VAGUE_ACTS = {"", "interfere", "disturb", "trouble", "harass", "do anything"}


def _restrained(names: Sequence[str]) -> str:
    if len(names) != 1:
        return "the defendants, their men, agents, servants and all persons claiming under them"
    g = gender_of(names[0])
    his, him = ("his", "him") if g == "m" else ("her", "her") if g == "f" else ("their", "them")
    return f"the defendant, {his} men, agents, servants and all persons claiming under {him}"


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


def _relationship(rels: Optional[Sequence[str]], i: int) -> Optional[str]:
    """'the plaintiff's cousin' / 'cousin of the plaintiff' -> 'cousin' (r17)."""
    r = str(rels[i] if rels and i < len(rels) else "").strip().rstrip(".")
    r = re.sub(r"^(?:is\s+)?(?:the\s+)?(?:plaintiff'?s|his|her)\s+", "", r, flags=re.I)
    r = re.sub(r"\s+of\s+the\s+plaintiff$", "", r, flags=re.I)
    r = re.sub(r"^(?:the|a|an)\s+", "", r, flags=re.I).strip()
    return r if r and not r.startswith("[") else None  # an unknown relation is not pleaded


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
    plaintiff_age: Optional[str] = None,
    plaintiff_occupation: Optional[str] = None,
    defendant_addresses: Optional[Sequence[str]] = None,
    # each defendant's relationship to the plaintiff, from the brief ("cousin").
    defendant_relationships: Optional[Sequence[str]] = None,
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
    act = relief_clause(act_restrained, after_restraining=True)
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
                      "age": str(plaintiff_age or "").strip() or None,
                      "occupation": (plaintiff_occupation or "").strip() or None,
                      "address": plaintiff_address},
        # the prayer names who is restrained: the defendant, his men and agents.
        "restrained": _restrained(defendant_names),
        "defendants": [
            {"name": n,
             "address": (defendant_addresses[i]
                         if defendant_addresses and i < len(defendant_addresses)
                         else None),
             "relationship": _relationship(defendant_relationships, i)}
            for i, n in enumerate(defendant_names)
        ],
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "suit_date": filing_date.isoformat(),
        "knowledge_para_last": 4,
        "suit_property": suit_property,
        # r12: the schedule after the plaint, from the same facts (a sentence of its own).
        "schedule_property": (lambda s: s[:1].upper() + s[1:])(suit_property.strip().rstrip(".")),
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
