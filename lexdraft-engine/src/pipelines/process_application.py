"""Application for issue of process and deposit of batta — document pipeline.

A party to a pending suit or proceeding applies to the court to issue process —
summons, notice, warrant or subpoena — on the opposite party or on witnesses, and
deposits (or tenders) the witness batta (travelling, subsistence and process fees)
so that the process may be served. The application recites the forum, the cause
reference, the applicant and his role in the cause, and a schedule of the process
to be issued: the nature of each process, the person on whom it is to be served,
the place of service, and (for witnesses) the mileage and batta computed. The form
is generalised for any state and any court — the court name and place of sitting
are placeholders. PARTY-FILED.

Hard requirements (each refuses, no partial output):
  - At least one row of process must be sought (nature_of_process non-blank); an
    application to issue process that names no process is meaningless.
  - The applicant must be named — the court must know at whose instance the
    process issues and who tenders the batta.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "process_application.docx"
SPEC = "tn-process"


class Forum(Enum):
    CIVIL = "civil"
    MACT = "mact"
    SMALL_CAUSES = "small_causes"
    CRIMINAL = "criminal"


@dataclass(frozen=True)
class ProcessRow:
    nature_of_process: str
    on_whom: str
    place_of_service: str
    distance_miles: Optional[str] = None
    travelling_allowance: Optional[str] = None
    subsistence_allowance: Optional[str] = None
    process_fee: Optional[str] = None
    remarks: Optional[str] = None


@dataclass(frozen=True)
class ProcessApplicationResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> ProcessApplicationResult:
    return ProcessApplicationResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="process_application", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    forum: Forum,
    case_ref: str,
    applicant_name: str,
    applicant_role: str,
    rows: Sequence[ProcessRow],
    place: str,
    court_place: Optional[str] = None,
    opposite_party_name: Optional[str] = None,
    value_of_claim: Optional[str] = None,
    court_day: Optional[str] = None,
    # criminal courts: the kind of process prayed for (Summons/Notice/NBW/Subpoena)
    process_type: Optional[str] = None,
    # mode of service (Police / RPAD)
    service_mode: Optional[str] = None,
    next_hearing_date: Optional[date] = None,
    filing_date: Optional[date] = None,
) -> ProcessApplicationResult:
    """Assemble the application for issue of process and deposit of batta, or refuse."""

    # 1. at least one row of process must be sought.
    if not any(r.nature_of_process.strip() for r in rows):
        return _refuse(
            "an application for issue of process must set out at least one process to "
            "be issued (its nature — summons, notice, warrant or subpoena); no process "
            "row is present",
            code="process_application_no_process_rows",
            fields=("rows",),
        )

    # 2. the applicant must be named.
    if not applicant_name.strip():
        return _refuse(
            "the application must name the applicant at whose instance the process is "
            "to issue and who tenders the batta; it is absent",
            code="process_application_applicant_missing",
            fields=("applicant_name",),
        )

    context: Dict[str, Any] = {
        "forum": forum.value,
        "case_ref": case_ref,
        "applicant": {"name": applicant_name, "role": applicant_role},
        "rows": [
            {
                "nature_of_process": r.nature_of_process,
                "on_whom": r.on_whom,
                "place_of_service": r.place_of_service,
                "distance_miles": r.distance_miles,
                "travelling_allowance": r.travelling_allowance,
                "subsistence_allowance": r.subsistence_allowance,
                "process_fee": r.process_fee,
                "remarks": r.remarks,
            }
            for r in rows
        ],
        "opposite_party_name": opposite_party_name,
        "value_of_claim": value_of_claim,
        "court_day": court_day,
        "process_type": process_type,
        "service_mode": service_mode,
        "next_hearing_date": next_hearing_date.isoformat() if next_hearing_date else None,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "case_year": filing_date.year if filing_date else None,
        "court_place": court_place,
        "place": place,
    }
    return ProcessApplicationResult(refused=False, context=context)
