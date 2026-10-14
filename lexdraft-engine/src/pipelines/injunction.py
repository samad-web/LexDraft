"""Temporary injunction application O39 R1&2 — pipeline (spec 4.2).

The classic triad — prima facie case, balance of convenience, irreparable injury
— must EACH be a separately headed, non-empty paragraph. Any one missing or empty
-> REFUSE. Unlike ordinary [LLM] slots, a triad limb never falls back to the
named placeholder; an empty limb is a refusal, because a missing limb is exactly
what injunction applications are dismissed on.

Other hard rules:
  - Prayer specificity: the act to be restrained must be named. "restrain the
    defendant" with no act -> refuse.
  - Ex-parte relief -> mandatory O39 R3-proviso urgency + notice-futility para.
  - Undertaking as to damages required.

Brief facts (para 2) is an ordinary named [LLM] slot. This layer calls no LLM.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "injunction.docx"
SPEC = "4.2"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# Vague prayer phrases that name no concrete act. Normalised (lowercased, stripped
# trailing punctuation) before comparison.
_VAGUE_PRAYERS = {
    "restrain the defendant",
    "restrain the defendants",
    "grant an injunction",
    "grant injunction",
    "the defendant",
    "as prayed for",
}


@dataclass(frozen=True)
class InjunctionResult:
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
    remedy_hint: str = "none",
) -> InjunctionResult:
    return InjunctionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            pipeline="injunction", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def build(
    *,
    suit_ref: str,
    subject_matter: str,
    applicant_name: str,
    applicant_role: str,
    brief_facts: str,
    prima_facie_case: str,
    balance_of_convenience: str,
    irreparable_injury: str,
    urgency_conduct: str,
    undertaking_as_to_damages: bool,
    act_restrained: str,
    is_ex_parte: bool,
    notice_futility: Optional[str],
    place: str,
    # cause-title header (DPC book O39 application). Optional.
    opposite_party_name: str = "",
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
    application_date: Optional[date] = None,
) -> InjunctionResult:
    """Assemble the injunction application, or refuse."""

    # --- the triad: each separately headed and non-empty ---
    triad_inputs = [
        ("PRIMA FACIE CASE", "prima facie case", prima_facie_case,
         "prima_facie", "prima_facie_case"),
        ("BALANCE OF CONVENIENCE", "balance of convenience", balance_of_convenience,
         "balance_of_convenience", "balance_of_convenience"),
        ("IRREPARABLE INJURY", "irreparable injury", irreparable_injury,
         "irreparable_injury", "irreparable_injury"),
    ]
    for heading, name, text, code_slug, field_name in triad_inputs:
        if not text.strip():
            return _refuse(
                f"the {name} limb is missing or empty; all three limbs of the "
                f"injunction triad must be pleaded as separately headed paragraphs, "
                f"and a missing limb is fatal",
                code=f"injunction_triad_missing_{code_slug}",
                fields=(field_name,),
            )

    # --- prayer specificity: the restrained act must be named ---
    act = act_restrained.strip()
    if not act or act.rstrip(".").lower() in _VAGUE_PRAYERS:
        return _refuse(
            "the prayer is not specific: the act sought to be restrained must be "
            "identified (e.g. 'restrain the defendant from alienating the suit "
            "property'); a bare 'restrain the defendant' is refused",
            code="injunction_vague_prayer", fields=("act_restrained",),
        )

    # --- undertaking as to damages ---
    if not undertaking_as_to_damages:
        return _refuse(
            "an undertaking as to damages is required for a temporary injunction",
            code="injunction_no_undertaking",
            fields=("undertaking_as_to_damages",),
        )

    # --- ex-parte -> O39 R3-proviso urgency + notice-futility paragraph ---
    if is_ex_parte and not (notice_futility and notice_futility.strip()):
        return _refuse(
            "ex-parte relief requires the additional paragraph under the proviso to "
            "O39 R3 stating the urgency and why notice to the opposite party would "
            "defeat the purpose of the application",
            code="injunction_exparte_no_notice_futility",
            fields=("is_ex_parte", "notice_futility"),
        )

    context: Dict[str, Any] = {
        "suit_ref": suit_ref,
        "subject_matter": subject_matter,
        "applicant": {"name": applicant_name, "role": applicant_role},
        "opposite_party_name": opposite_party_name,
        "opposite_party_role": applicant_role_opposite(applicant_role),
        # cause-title header fields (render only when present).
        "civil_court": civil_court,
        "city": city,
        "application_date": (application_date.isoformat()
                             if application_date else None),
        "brief_facts_slot": brief_facts if brief_facts.strip()
                            else _LLM_SLOT_PLACEHOLDER,
        "triad": [
            {"heading": heading, "text": text}
            for heading, _name, text, _slug, _field in triad_inputs
        ],
        "urgency_conduct": urgency_conduct,
        "undertaking_as_to_damages": undertaking_as_to_damages,
        "prayer": f"restrain the {applicant_role_opposite(applicant_role)} from "
                  f"{act}",
        "act_restrained": act,
        "is_ex_parte": is_ex_parte,
        "notice_futility_paragraph": bool(is_ex_parte),
        "notice_futility": notice_futility,
        "place": place,
    }
    return InjunctionResult(refused=False, context=context)


def applicant_role_opposite(role: str) -> str:
    """The party to be restrained is the applicant's opponent."""
    opposites = {
        "plaintiff": "defendant",
        "petitioner": "respondent",
        "applicant": "respondent",
    }
    return opposites.get(role.lower(), "opposite party")
