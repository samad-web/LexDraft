"""Contested divorce under HMA s.13 — pipeline (spec 6.1).

Date-math heavy. Its s.19 HMA jurisdiction limbs are HMA-specific and are NOT
routed through the s.20 CPC civil jurisdiction module (the limbs differ).

Checks:
  - s.14 one-year bar from the marriage date: within a year -> DON'T refuse;
    auto-attach the leave application under the s.14 proviso.
  - Ground-specific validation:
      Cruelty   -> at least one DATED instance (general allegations refuse).
      Desertion -> separation >= 2 years, animus deserendi, without consent,
                   without reasonable cause — all four or refuse.
      Adultery  -> a specific instance; co-respondent joined OR non-joinder reason.
  - No collusion, connivance or condonation — all three pleaded expressly.
  - Children mentioned -> custody AND maintenance position addressed or refuse.

LLM slot at paragraph 5 (grounds narrative).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from dateutil.relativedelta import relativedelta

from ..verify.refusals import Refusal, Severity

TEMPLATE = "divorce_contested.docx"
SPEC = "6.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class Ground(Enum):
    ADULTERY = "adultery"
    CRUELTY = "cruelty"
    DESERTION = "desertion"
    CONVERSION = "conversion"
    UNSOUND_MIND = "unsound_mind"


class Section19Basis(Enum):
    """s.19 HMA jurisdiction limbs — HMA-specific, NOT the s.20 CPC bases."""

    MARRIAGE_SOLEMNISED = "marriage_solemnised"
    LAST_RESIDED_TOGETHER = "last_resided_together"
    RESPONDENT_RESIDES = "respondent_resides"
    PETITIONER_RESIDES = "petitioner_resides"   # in the cases s.19 allows


@dataclass(frozen=True)
class DatedInstance:
    date: date
    description: str


@dataclass(frozen=True)
class DivorceResult:
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
) -> DivorceResult:
    return DivorceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            pipeline="divorce_contested", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    marriage_date: date,
    marriage_place: str,
    filing_date: date,
    ground: Ground,
    cruelty_instances: Sequence[DatedInstance],
    separation_since: Optional[date],
    animus_deserendi: Optional[bool],
    without_consent: Optional[bool],
    without_reasonable_cause: Optional[bool],
    adultery_instance: Optional[str],
    co_respondent_joined: Optional[bool],
    non_joinder_reason: Optional[str],
    no_collusion: bool,
    no_connivance: bool,
    no_condonation: bool,
    children: Sequence[str],
    custody_position: Optional[str],
    maintenance_position: Optional[str],
    jurisdiction_basis: Section19Basis,
    place: str,
    grounds_narrative: str,
    # cause-title header (DPC book). Optional.
    family_court: Optional[str] = None,
    city: Optional[str] = None,
) -> DivorceResult:
    """Assemble the contested-divorce petition, or refuse."""

    # 1. s.14 one-year bar: within a year -> leave required (attach), not refuse.
    one_year = marriage_date + relativedelta(years=1)
    leave_required = filing_date < one_year

    # 2. ground-specific validation.
    if ground is Ground.CRUELTY:
        if not cruelty_instances:
            return _refuse(
                "cruelty must be pleaded with at least one dated instance; general "
                "allegations are insufficient",
                code="divorce_contested_cruelty_no_dated_instance",
                fields=("cruelty_instances",),
            )
    elif ground is Ground.DESERTION:
        if separation_since is None:
            return _refuse("desertion requires the date since which the parties "
                           "have lived separately",
                           code="divorce_contested_desertion_no_separation_date",
                           fields=("separation_since",))
        two_years = separation_since + relativedelta(years=2)
        if filing_date < two_years:
            return _refuse(
                "desertion requires separation for a continuous period of not less "
                "than two years; the period is not made out",
                code="divorce_contested_desertion_under_2_years",
                fields=("separation_since", "filing_date"),
            )
        if not animus_deserendi:
            return _refuse("desertion requires animus deserendi (the intention to "
                           "desert); it is not pleaded",
                           code="divorce_contested_desertion_no_animus",
                           fields=("animus_deserendi",))
        if not without_consent:
            return _refuse("desertion must be without the consent of the petitioner",
                           code="divorce_contested_desertion_not_without_consent",
                           fields=("without_consent",))
        if not without_reasonable_cause:
            return _refuse("desertion must be without reasonable cause",
                           code="divorce_contested_desertion_not_without_reasonable_cause",
                           fields=("without_reasonable_cause",))
    elif ground is Ground.ADULTERY:
        if not (adultery_instance and adultery_instance.strip()):
            return _refuse("adultery requires a specific instance to be pleaded",
                           code="divorce_contested_adultery_no_instance",
                           fields=("adultery_instance",))
        if not co_respondent_joined and not (non_joinder_reason and non_joinder_reason.strip()):
            return _refuse(
                "the alleged adulterer (co-respondent) must be joined, or the "
                "reason for non-joinder stated",
                code="divorce_contested_adultery_corespondent_not_joined",
                fields=("co_respondent_joined", "non_joinder_reason"),
            )

    # 3. bars — all three pleaded expressly.
    if not no_collusion:
        return _refuse("the petition must aver the absence of collusion",
                       code="divorce_contested_collusion_not_negatived",
                       fields=("no_collusion",))
    if not no_connivance:
        return _refuse("the petition must aver the absence of connivance",
                       code="divorce_contested_connivance_not_negatived",
                       fields=("no_connivance",))
    if not no_condonation:
        return _refuse("the petition must aver the absence of condonation",
                       code="divorce_contested_condonation_not_negatived",
                       fields=("no_condonation",))

    # 4. children -> custody AND maintenance position addressed.
    if children:
        if not (custody_position and custody_position.strip()):
            return _refuse(
                "there are children of the marriage; the custody position must be "
                "addressed — a petition silent on it is defective",
                code="divorce_contested_children_custody_unaddressed",
                fields=("children", "custody_position"),
            )
        if not (maintenance_position and maintenance_position.strip()):
            return _refuse(
                "there are children of the marriage; the maintenance position must "
                "be addressed",
                code="divorce_contested_children_maintenance_unaddressed",
                fields=("children", "maintenance_position"),
            )

    # separation years (for the desertion context / display)
    separation_years = None
    if separation_since is not None:
        separation_years = relativedelta(filing_date, separation_since).years

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name},
        "respondent": {"name": respondent_name},
        # cause-title header fields (render only when present).
        "family_court": family_court,
        "city": city,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "marriage_date": marriage_date,
        "marriage_place": marriage_place,
        "ground": ground.value,
        "leave_required": leave_required,
        "cruelty_instances": [
            {"date": i.date, "description": i.description} for i in cruelty_instances
        ],
        "separation_since": separation_since,
        "separation_years": separation_years,
        "adultery_instance": adultery_instance,
        "co_respondent_joined": co_respondent_joined,
        "non_joinder_reason": non_joinder_reason,
        "children": list(children),
        "custody_position": custody_position,
        "maintenance_position": maintenance_position,
        "jurisdiction_basis": jurisdiction_basis.value,
        "grounds_slot": grounds_narrative if grounds_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return DivorceResult(refused=False, context=context)
