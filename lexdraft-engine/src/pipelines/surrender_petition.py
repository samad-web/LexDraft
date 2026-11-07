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

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ._state_party import bare_crime_no, state_respondent

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


def _state_line(state_rep_by: Optional[str], police_station: Optional[str]) -> str:
    """'State rep. by the Inspector of Police, X Police Station' — from a full
    description when given (adding the station it omits), else built."""
    rep_by = (state_rep_by or "").strip()
    if rep_by.lower() in ("", "state", "the state"):
        return state_respondent(police_station)
    ps = (police_station or "").strip()
    if ps and ps.lower() not in rep_by.lower():
        rep_by += f", {ps}" + ("" if "police station" in ps.lower() else " Police Station")
    return rep_by


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
    court_name: Optional[str] = None,
    crime_registered_date: Optional[date] = None,
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

    # The Magistrate's remand / bail powers on surrender: BNSS for a crime
    # registered on or after 1.7.2024 (s.531 BNSS saves the CrPC for earlier ones).
    # shortcut: a 2024 crime number without its registration date is taken as BNSS.
    year = re.search(r"\b(?:19|20)\d{2}\b", crime_no)
    crpc = (crime_registered_date < date(2024, 7, 1) if crime_registered_date
            else bool(year) and int(year.group()) < 2024)
    context: Dict[str, Any] = {
        "remand_section": ("Section 167 of the Code of Criminal Procedure, 1973" if crpc
                           else "Section 187 of the Bharatiya Nagarik Suraksha Sanhita, 2023"),
        "bail_section": ("Section 437 of the said Code" if crpc
                         else "Section 480 of the said Sanhita"),
        "accused_name": accused_name,
        "offence_section": offence_section,
        "crime_no": bare_crime_no(crime_no),
        "identification_marks": [m for m in identification_marks if m.strip()],
        "case_ref": case_ref,
        "place": place,
        "accused_address": accused_address,
        "complainant_name": complainant_name,
        # a crime number is a police case: the State is the respondent
        "state_rep_by": _state_line(state_rep_by, police_station),
        "court_name": court_name,
        "police_station": police_station,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "court_place": court_place,
    }
    return SurrenderPetitionResult(refused=False, context=context)
