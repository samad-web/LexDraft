"""Court-issued notice — document pipeline.

COURT-ISSUED INSTRUMENT. A court notice issues from the court/registry under its
seal; the advocate only PREPARES a draft for the court's issue and never authors
the court's own process. The context therefore carries ``"court_issues": True`` so
the template can print the marker banner "[COURT ISSUES THIS — the advocate
prepares this draft for the court's issue]".

Covers: a notice to show cause against an application (ex parte on default); a
warning to appear in person or by pleader; a Family Court notice to a respondent to
appear and file a written statement (21-day service window); an Order XLI CPC
notice that an appeal is registered and a hearing fixed; and an Order XVI CPC
production summons to a custodian of documents.

Hard requirements (each refuses, no partial output):
  - The addressee must be named.
  - A show-cause / appear-in-person / appeal / Family-Court notice must identify
    the application, appeal or relief the addressee is called to answer.
  - A production summons must identify the documents to be produced.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "court_notice.docx"
SPEC = "tn-courtnotice"


class NoticeKind(Enum):
    SHOW_CAUSE = "show_cause"               # notice to show cause against an application, ex parte on default
    APPEAR_PERSON = "appear_person"         # warning to appear in person or by pleader
    FAMILY_COURT = "family_court"           # Family Court notice to respondent to appear and file written statement; 21-day service window
    APPEAL_NOTICE = "appeal_notice"         # Order XLI CPC notice that an appeal is registered and hearing fixed
    PRODUCE_DOCUMENTS = "produce_documents" # Order XVI CPC production summons to a custodian


@dataclass(frozen=True)
class CourtNoticeResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> CourtNoticeResult:
    return CourtNoticeResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="court_notice", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    kind: NoticeKind,
    case_ref: str,
    applicant_or_petitioner_name: str,
    addressee_name: str,
    place: str,
    court_place: Optional[str] = None,
    application_or_relief: Optional[str] = None,   # nature of the application/relief
    appearance_date: Optional[date] = None,
    documents_description: Optional[str] = None,   # produce_documents
    written_statement_date: Optional[date] = None, # family_court
    seal_date: Optional[date] = None,
) -> CourtNoticeResult:
    """Assemble the court-issued notice draft for the court's issue, or refuse."""

    # 1. the addressee must be named.
    if not addressee_name.strip():
        return _refuse(
            "a court notice must name the addressee to whom it is directed; it is "
            "absent",
            code="court_notice_addressee_missing",
            fields=("addressee_name",),
        )

    # 2. the application/appeal/relief the addressee must answer must be identified.
    if kind in (NoticeKind.SHOW_CAUSE, NoticeKind.APPEAR_PERSON,
                NoticeKind.APPEAL_NOTICE, NoticeKind.FAMILY_COURT):
        if not (application_or_relief or "").strip():
            return _refuse(
                "the notice must identify the application/appeal/relief the addressee "
                "is called to answer; it is absent",
                code="court_notice_application_not_identified",
                fields=("application_or_relief",),
            )

    # 3. a production summons must identify the documents to be produced.
    if kind is NoticeKind.PRODUCE_DOCUMENTS:
        if not (documents_description or "").strip():
            return _refuse(
                "a production summons must identify the documents to be produced; they "
                "are not described",
                code="court_notice_documents_not_identified",
                fields=("documents_description",),
            )

    context: Dict[str, Any] = {
        "court_issues": True,
        "kind": kind.value,
        "case_ref": case_ref,
        "applicant_or_petitioner_name": applicant_or_petitioner_name,
        "addressee_name": addressee_name,
        "place": place,
        "court_place": court_place,
        "application_or_relief": application_or_relief,
        "appearance_date": appearance_date.isoformat() if appearance_date else None,
        "documents_description": documents_description,
        "written_statement_date": (written_statement_date.isoformat()
                                   if written_statement_date else None),
        "seal_date": seal_date.isoformat() if seal_date else None,
    }
    return CourtNoticeResult(refused=False, context=context)
