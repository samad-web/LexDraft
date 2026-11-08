"""Petition to dispense with the accused's personal attendance (s.317 CrPC).

PARTY-FILED (accused's counsel). Where an accused cannot personally attend on a
given day of the enquiry or trial, s.317 CrPC empowers the Magistrate, for
reasons to be recorded, to dispense with the personal attendance of the accused
and to permit the accused to appear by pleader. This petition prays that the
accused's personal attendance be dispensed with for the day and that counsel be
permitted to represent the accused, averring that the accused's absence is
neither wanton nor wilful. Generalised for any state.

Hard requirements (each refuses, no partial output):
  - The petition must state the ground on which personal attendance is sought to
    be dispensed with.
  - The petition must carry the operative averment that the accused's absence is
    neither wanton nor wilful — the foundation on which s.317 relief rests.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity
from ._code_framework import provision
from ._court import clause, court_and_place, first_person, pronouns

TEMPLATE = "s317_dispense_presence.docx"
SPEC = "tn-s317"


@dataclass(frozen=True)
class S317DispensePresenceResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> S317DispensePresenceResult:
    return S317DispensePresenceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="s317_dispense_presence", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    accused_name: str,
    complainant_name: str,
    absence_reason: str,
    absence_not_wanton: bool,
    case_ref: str,
    place: str,
    magistrate_designation: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_place: Optional[str] = None,
    hearing_date: Optional[date] = None,   # the hearing to be dispensed with
    identity_not_disputed: bool = False,   # counsel appears; identity will not be disputed
    accused_gender: Optional[str] = None,  # resolves he/his/him when no title
    deponent_description: Optional[str] = None,  # age, parentage, address for the affidavit
    filing_date: Optional[date] = None,    # the intake's date of filing (today)
) -> S317DispensePresenceResult:
    """Assemble the s.317 petition to dispense with the accused's presence, or refuse."""

    # 1. the petition must state the ground on which personal attendance is sought
    #    to be dispensed with.
    if not absence_reason.strip():
        return _refuse(
            "the petition must state the ground on which the accused seeks to have "
            "personal attendance dispensed with for the day; a bare prayer without "
            "the reason is not maintainable",
            code="s317_absence_reason_missing",
            fields=("absence_reason",),
        )

    # 2. s.317 requires the operative averment that the absence of the accused is
    #    neither wanton nor wilful.
    if not absence_not_wanton:
        return _refuse(
            "s.317 requires the operative averment that the absence of the accused "
            "is neither wanton nor wilful; that averment is absent and the petition "
            "would lack the foundation on which the relief rests",
            code="s317_absence_not_averred_non_wanton",
            fields=("absence_not_wanton",),
        )

    court, at = court_and_place(magistrate_designation, court_place)
    petition_date = petition_date or filing_date
    context: Dict[str, Any] = {
        "court_name": court,
        # s.355 BNSS (old s.317 CrPC): inquiry / trial in the accused's absence.
        "dispense_provision": provision("dispense_presence", case_ref),
        "hearing_date": hearing_date.isoformat() if hearing_date else None,
        "identity_not_disputed": identity_not_disputed,
        "accused_name": accused_name,
        "complainant_name": complainant_name,
        "absence_reason": clause(absence_reason),
        "absence_reason_first": first_person(absence_reason),
        "pr": pronouns(accused_name, accused_gender),
        "deponent_description": (deponent_description or "").strip(),
        "petition_year": str(petition_date.year) if petition_date else None,
        "absence_not_wanton": absence_not_wanton,
        "case_ref": case_ref,
        "magistrate_designation": magistrate_designation,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "court_place": at,
        "place": place,
    }
    return S317DispensePresenceResult(refused=False, context=context)
