"""Surrender petition — document pipeline.

A petition by which an accused, implicated in a specified crime, voluntarily
surrenders himself before the court and prays that he be taken into custody /
dealt with according to law. It recites the offence and crime number in which he
is implicated, his identification marks (to fix his identity on surrender), and
his willingness to submit to the process of the court. The court name and place
are placeholders — the petition adapts to any state. PARTY-FILED (tendered by the
accused, not issued by the court).

Hard requirements (each refuses, no partial output):
  - The offence section under which the accused is implicated must be stated.
  - The crime number must be given — a surrender petition must identify the
    crime the accused is implicated in.
  - At least one identification mark must be given — they are mandatory to fix
    the identity of the accused on surrender/custody.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "surrender_petition.docx"
SPEC = "tn-surrender"


@dataclass(frozen=True)
class SurrenderPetitionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SurrenderPetitionResult:
    return SurrenderPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="surrender_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    accused_name: str,
    offence_section: str,
    crime_no: str,
    identification_marks: Sequence[str],
    case_ref: str,
    place: str,
    accused_address: Optional[str] = None,
    complainant_name: Optional[str] = None,
    state_rep_by: Optional[str] = None,
    police_station: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_place: Optional[str] = None,
) -> SurrenderPetitionResult:
    """Assemble the surrender petition, or refuse."""

    # 1. the offence section under which the accused is implicated must be stated.
    if not offence_section.strip():
        return _refuse(
            "a surrender petition must state the offence section under which the "
            "accused is implicated; it is absent",
            code="surrender_petition_offence_section_missing",
            fields=("offence_section",),
        )

    # 2. a surrender petition must identify the crime the accused is implicated in.
    if not crime_no.strip():
        return _refuse(
            "a surrender petition must identify the crime the accused is implicated "
            "in",
            code="surrender_petition_crime_no_missing",
            fields=("crime_no",),
        )

    # 3. identification marks are mandatory to fix the identity of the accused on
    #    surrender/custody.
    if not any(m.strip() for m in identification_marks):
        return _refuse(
            "identification marks are mandatory to fix the identity of the accused "
            "on surrender/custody",
            code="surrender_petition_no_identification_marks",
            fields=("identification_marks",),
        )

    context: Dict[str, Any] = {
        "accused_name": accused_name,
        "offence_section": offence_section,
        "crime_no": crime_no,
        "identification_marks": [m for m in identification_marks if m.strip()],
        "case_ref": case_ref,
        "place": place,
        "accused_address": accused_address,
        "complainant_name": complainant_name,
        "state_rep_by": state_rep_by,
        "police_station": police_station,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "court_place": court_place,
    }
    return SurrenderPetitionResult(refused=False, context=context)
