"""Petition to recall/cancel a warrant of arrest (s.72(2) BNSS; s.70(2) CrPC for
a pre-1.7.2024 case) — pipeline.

PARTY-FILED (accused's counsel). Where, on the accused's non-appearance, the
court has issued a warrant of arrest, s.70(2) CrPC provides that such a warrant
remains in force until it is cancelled by the court which issued it. This
petition prays the court to recall/cancel the warrant pending against the
accused, explaining the reason for the earlier non-appearance and carrying the
accused's undertaking to appear regularly in future. Generalised for any state.

Hard requirements (each refuses, no partial output):
  - A warrant must actually be pending against the accused; s.70(2) recall
    presupposes a live warrant to be cancelled.
  - The petition must state the reason for the non-appearance that occasioned
    the warrant.
  - The petition must carry the accused's undertaking to appear regularly in
    future, on the strength of which recall is sought.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ._code_framework import provision
from ._court import bare_station, court_and_place, first_person, pronouns, subject_clause
from ._state_party import state_respondent

TEMPLATE = "recall_warrant.docx"
SPEC = "tn-recall"


@dataclass(frozen=True)
class RecallWarrantResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> RecallWarrantResult:
    return RecallWarrantResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="recall_warrant", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    accused_name: str,
    absence_reason: str,
    warrant_pending: bool,
    undertaking_future_appearance: bool,
    case_ref: str,
    place: str,
    state_rep_by: Optional[str] = None,
    police_station: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_place: Optional[str] = None,
    court_name: Optional[str] = None,
    warrant_date: Optional[date] = None,
    documents: Sequence[str] = (),   # e.g. the medical certificate filed with it
    filing_date: Optional[date] = None,   # the intake's date of filing (today)
    accused_gender: Optional[str] = None,  # resolves he/she when no title
    deponent_description: Optional[str] = None,  # age, parentage, address for the affidavit
) -> RecallWarrantResult:
    """Assemble the s.70(2) petition to recall the warrant of arrest, or refuse."""

    # 1. s.70(2) recall presupposes a warrant is actually pending against the accused.
    if not warrant_pending:
        return _refuse(
            "s.70(2) recall presupposes a warrant is actually pending against the "
            "accused; with no warrant in force there is nothing to be recalled or "
            "cancelled and the petition would not lie",
            code="recall_warrant_no_warrant_pending",
            fields=("warrant_pending",),
        )

    # 2. the petition must state the reason for the non-appearance that occasioned
    #    the warrant.
    if not absence_reason.strip():
        return _refuse(
            "the petition must state the reason for the non-appearance that "
            "occasioned the warrant; a bare prayer to recall, without the ground, "
            "is not maintainable",
            code="recall_warrant_absence_reason_missing",
            fields=("absence_reason",),
        )

    # 3. the petition must carry the accused's undertaking to appear regularly in
    #    future.
    if not undertaking_future_appearance:
        return _refuse(
            "the petition must carry the accused's undertaking to appear regularly "
            "in future; without that undertaking the court has no basis on which to "
            "recall the warrant",
            code="recall_warrant_no_undertaking",
            fields=("undertaking_future_appearance",),
        )

    petition_date = petition_date or filing_date
    court, at = court_and_place(court_name, court_place)
    station = bare_station(police_station)
    if not (state_rep_by or "").strip():
        # The State prosecutes a warrant case; an unknown station stays a visible gap.
        state_rep_by, station = state_respondent(station), ""

    context: Dict[str, Any] = {
        "court_name": court,
        "recall_provision": provision("warrant_recall", case_ref),
        "warrant_date": warrant_date.isoformat() if warrant_date else None,
        "documents": [d for d in documents if d.strip()],
        "accused_name": accused_name,
        "absence_reason": subject_clause(
            absence_reason, pronouns(accused_name, accused_gender)["he"]),
        "absence_reason_first": first_person(absence_reason),
        "deponent_description": (deponent_description or "").strip(),
        "petition_year": str(petition_date.year) if petition_date else None,
        "warrant_pending": warrant_pending,
        "undertaking_future_appearance": undertaking_future_appearance,
        "case_ref": case_ref,
        "state_rep_by": state_rep_by,
        "police_station": station,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "court_place": at,
        "place": place,
    }
    return RecallWarrantResult(refused=False, context=context)
