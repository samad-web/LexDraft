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

import re
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


# The operative clause of s.13(1) HMA for each ground. Pleaded by clause, never a
# bare "s.13(1)": the composer writes the clause, which must be in the skeleton.
_GROUND_CLAUSE = {
    Ground.ADULTERY: "13(1)(i)",
    Ground.CRUELTY: "13(1)(ia)",
    Ground.DESERTION: "13(1)(ib)",
    Ground.CONVERSION: "13(1)(ii)",
    Ground.UNSOUND_MIND: "13(1)(iii)",
}

# "No children" / "nil" in the children list is the brief saying there are none.
_NO_CHILDREN = re.compile(r"^\s*(no|nil|none)\b", re.I)


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


def _derive_basis(
    court_place: str,
    marriage_place: str,
    respondent_address: Optional[str],
    matrimonial_home: Optional[str],
    petitioner_address: Optional[str],
) -> Optional[Section19Basis]:
    """The s.19 limb the stated facts support, in the section's own order. None when no
    stated place is in the court's town: the draft then shows a gap, never a guess."""
    at_court = re.compile(rf"\b{re.escape(court_place.strip())}\b", re.I)
    for basis, where in (
        (Section19Basis.MARRIAGE_SOLEMNISED, marriage_place),
        (Section19Basis.RESPONDENT_RESIDES, respondent_address),
        (Section19Basis.LAST_RESIDED_TOGETHER, matrimonial_home),
        (Section19Basis.PETITIONER_RESIDES, petitioner_address),
    ):
        if where and at_court.search(where):
            return basis
    return None


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
    jurisdiction_basis: Optional[Section19Basis],
    place: str,
    grounds_narrative: str,
    # cause-title header (DPC book). Optional.
    family_court: Optional[str] = None,
    city: Optional[str] = None,
    # the parties' particulars and where they lived together. Optional.
    petitioner_age: Optional[int] = None,
    petitioner_address: Optional[str] = None,
    respondent_age: Optional[int] = None,
    respondent_address: Optional[str] = None,
    matrimonial_home: Optional[str] = None,
) -> DivorceResult:
    """Assemble the contested-divorce petition, or refuse."""

    if jurisdiction_basis is None:
        jurisdiction_basis = _derive_basis(
            city or place, marriage_place, respondent_address, matrimonial_home, petitioner_address)

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
    no_children_stated = bool(children) and all(_NO_CHILDREN.match(c) for c in children)
    if no_children_stated:
        children = []
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

    # Cruelty with dated instances opens the ground with the statutory averment
    # (s.13(1)(ia)) rather than an empty "[to be drafted]" slot.
    if grounds_narrative.strip():
        grounds_slot = grounds_narrative
    elif ground is Ground.CRUELTY and cruelty_instances:
        grounds_slot = ("After the solemnisation of the marriage, the respondent has "
                        "treated the petitioner with cruelty, the particulars of which "
                        "are set out below.")
    else:
        grounds_slot = _LLM_SLOT_PLACEHOLDER

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "age": petitioner_age,
                       "address": petitioner_address},
        "respondent": {"name": respondent_name, "age": respondent_age,
                       "address": respondent_address},
        "matrimonial_home": matrimonial_home,
        "no_children_stated": no_children_stated,
        "ground_clause": _GROUND_CLAUSE[ground],
        "ground_label": ground.value.replace("_", " "),
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
        "jurisdiction_basis": jurisdiction_basis.value if jurisdiction_basis else None,
        "grounds_slot": grounds_slot,
        "place": place,
    }
    return DivorceResult(refused=False, context=context)
