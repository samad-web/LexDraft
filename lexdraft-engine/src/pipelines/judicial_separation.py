"""Petition for Judicial Separation, s.10 HMA — document pipeline (DPC book pp.42-43).

Filed before the Family Court on any of the grounds available under s.10 (which
adopts the s.13(1) divorce grounds). The book (pp.42-43) pleads the marriage, the
status/residence particulars, the ground(s), non-condonation / non-connivance
where relevant, no-collusion, no-delay, and jurisdiction, then prays for a decree
of judicial separation.

Hard requirements (each refuses, no partial output):
  - Marriage solemnisation (date + place) must be pleaded.
  - At least one statutory ground under s.10 must be pleaded (a bare petition is
    refused).
  - The no-collusion averment is mandatory.
  - Where the ground is cruelty, non-condonation of the cruelty must be pleaded
    (book para 6); where adultery, non-condonation/non-connivance (book para 5).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "judicial_separation.docx"
SPEC = "dpc-42-43"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class Ground(Enum):
    CRUELTY = "cruelty"
    DESERTION = "desertion"
    ADULTERY = "adultery"
    CONVERSION = "conversion"
    UNSOUND_MIND = "unsound_mind"
    VENEREAL_DISEASE = "venereal_disease"
    RENUNCIATION = "renunciation"
    OTHER = "other"


@dataclass(frozen=True)
class JudicialSeparationResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> JudicialSeparationResult:
    return JudicialSeparationResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="judicial_separation", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    marriage_date: Optional[date],
    marriage_place: str,
    marriage_registered: bool,
    ground: Ground,
    ground_narrative: str,
    no_condonation: bool,
    no_connivance: bool,
    no_collusion: bool,
    no_undue_delay: bool,
    last_resided_together: str,
    jurisdiction_basis: str,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.42-43). Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
    respondent_parentage: Optional[str] = None,
    respondent_address: Optional[str] = None,
    family_court: Optional[str] = None,
    city: Optional[str] = None,
) -> JudicialSeparationResult:
    """Assemble the s.10 HMA judicial-separation petition, or refuse."""

    # 1. marriage is the foundational fact.
    if marriage_date is None or not marriage_place.strip():
        return _refuse(
            "a matrimonial petition must plead the solemnisation of the marriage "
            "(its date and place, according to Hindu rites and ceremonies); it is "
            "absent",
            code="judicial_separation_marriage_not_pleaded",
            fields=("marriage_date", "marriage_place"),
        )

    # 2. at least one ground must be pleaded.
    if not ground_narrative.strip():
        return _refuse(
            "at least one statutory ground under s.10 HMA must be pleaded with its "
            "particulars; a bare petition is refused",
            code="judicial_separation_no_ground",
            fields=("ground", "ground_narrative"),
        )

    # 3. ground-specific bars.
    if ground is Ground.CRUELTY and not no_condonation:
        return _refuse(
            "where the ground is cruelty, the petition must aver that the petitioner "
            "has not condoned the cruelty; that averment is absent",
            code="judicial_separation_cruelty_condonation_not_negatived",
            fields=("no_condonation",),
        )
    if ground is Ground.ADULTERY and not (no_condonation and no_connivance):
        return _refuse(
            "where the ground is adultery, the petition must aver that the petitioner "
            "has not been accessory to, connived at, or condoned the act(s); that "
            "averment is absent",
            code="judicial_separation_adultery_bars_not_negatived",
            fields=("no_condonation", "no_connivance"),
        )

    # 4. no-collusion is mandatory.
    if not no_collusion:
        return _refuse(
            "the petition must aver that it is not presented in collusion with the "
            "respondent; that averment is absent",
            code="judicial_separation_collusion_not_negatived",
            fields=("no_collusion",),
        )

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondent": {"name": respondent_name, "parentage": respondent_parentage,
                       "address": respondent_address},
        "family_court": family_court,
        "city": city,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "knowledge_para_last": 8,
        "marriage_date": marriage_date,
        "marriage_place": marriage_place,
        "marriage_registered": marriage_registered,
        "ground": ground.value,
        "ground_slot": ground_narrative,
        "no_condonation": no_condonation,
        "no_connivance": no_connivance,
        "no_collusion": no_collusion,
        "no_undue_delay": no_undue_delay,
        "last_resided_together": last_resided_together,
        "jurisdiction_basis": jurisdiction_basis,
        "has_matrimonial_verification": True,
        "place": place,
    }
    return JudicialSeparationResult(refused=False, context=context)
