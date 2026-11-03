"""Petition to condone delay — Section 5 of the Limitation Act, 1963.

Accompanies an appeal / revision / review / application presented after the
prescribed period (for a civil first appeal it is the application required by
Order XLI Rule 3A CPC, supported by an affidavit). The engine COMPUTES the
delay — never the advocate's guess — from the order date, the prescribed period
and the s.12(2) copy time, and refuses where s.5 cannot apply. Whether the cause
shown is "sufficient" is the court's discretion; the engine never adjudicates it.

Statute: Limitation Act 1963, s.5 — "Any appeal or any application, other than an
application under any of the provisions of Order XXI of the Code of Civil
Procedure, 1908, may be admitted after the prescribed period if the appellant or
the applicant satisfies the court that he had sufficient cause for not
preferring the appeal or making the application within such period." s.5 does
not apply to suits.

Hard requirements (each refuses, no partial output):
  - s.5 is unavailable for a suit, and for an application under Order XXI CPC.
  - The main proceeding being presented late must be identified.
  - There must be a delay: filed within time -> refuse (nothing to condone).
  - The cause for the delay must be pleaded (the advocate's facts — the compose
    pass then explains the period day by day).

LLM slot: the explanation of the delay (para 4).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..rules import limitation as lim
from ..verify.refusals import Refusal, Severity
from . import _appeal_window as aw

TEMPLATE = "condone_delay_petition.docx"
SPEC = "lim-5"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class MainProceeding(Enum):
    APPEAL = "appeal"
    REVISION = "revision"
    REVIEW = "review"
    APPLICATION = "application"
    SUIT = "suit"


_CLASS = {
    MainProceeding.APPEAL: lim.ProceedingClass.APPEAL,
    MainProceeding.REVISION: lim.ProceedingClass.REVISION,
    MainProceeding.REVIEW: lim.ProceedingClass.REVIEW,
    MainProceeding.APPLICATION: lim.ProceedingClass.APPLICATION,
}


@dataclass(frozen=True)
class CondoneDelayResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> CondoneDelayResult:
    return CondoneDelayResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="condone_delay_petition",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    main_proceeding: MainProceeding,
    main_proceeding_desc: str,
    petitioner_name: str,
    respondent_names: Sequence[str],
    court_name: str,
    impugned_order_ref: str,
    impugned_order_date: Optional[date],
    period_days: int,
    filing_date: date,
    sufficient_cause: str,
    place: str,
    is_order_xxi_application: bool = False,
    copy_applied_date: Optional[date] = None,
    copy_ready_date: Optional[date] = None,
    petitioner_role: str = "Petitioner",
    case_ref: str = "",
    delay_narrative: str = "",
) -> CondoneDelayResult:
    """Assemble the s.5 Limitation Act petition, or refuse."""

    if main_proceeding is MainProceeding.SUIT:
        return _refuse(
            "Section 5 of the Limitation Act applies to appeals and applications "
            "only; the delay in instituting a suit cannot be condoned",
            code="condone_delay_petition_suit", fields=("main_proceeding",),
        )
    if is_order_xxi_application:
        return _refuse(
            "Section 5 of the Limitation Act does not apply to an application under "
            "any of the provisions of Order XXI of the Code of Civil Procedure",
            code="condone_delay_petition_order_xxi",
            fields=("is_order_xxi_application",),
        )

    missing = [f for f, v in (("main_proceeding_desc", main_proceeding_desc),
                              ("impugned_order_ref", impugned_order_ref))
               if not v.strip()]
    if impugned_order_date is None:
        missing.append("impugned_order_date")
    if period_days <= 0:
        missing.append("period_days")
    if missing:
        return _refuse(
            "the petition must identify the proceeding presented late, the order it "
            "is directed against (with its date) and the prescribed period; "
            "missing: " + ", ".join(missing),
            code="condone_delay_petition_particulars_missing", fields=tuple(missing),
        )

    try:
        win = aw.window(order_date=impugned_order_date, filing_date=filing_date,
                        period_days=period_days,
                        proceeding_class=_CLASS[main_proceeding],
                        copy_applied=copy_applied_date, copy_ready=copy_ready_date)
    except lim.LimitationInputError as exc:
        return _refuse(str(exc), code="condone_delay_petition_copy_dates_invalid",
                       fields=("copy_applied_date", "copy_ready_date"))
    if win.in_time:
        return _refuse(
            f"the {main_proceeding.value} is within time (last day {win.expiry}); "
            f"there is no delay to condone",
            code="condone_delay_petition_no_delay",
            fields=("impugned_order_date", "filing_date", "period_days"),
            computation=win.computation,
        )

    if not sufficient_cause.strip():
        return _refuse(
            "the cause of the delay must be pleaded; Section 5 admits a late "
            "appeal or application only on sufficient cause shown",
            code="condone_delay_petition_no_cause", fields=("sufficient_cause",),
        )

    context: Dict[str, Any] = {
        "court_name": court_name,
        "case_ref": case_ref,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "petitioner": {"name": petitioner_name, "role": petitioner_role},
        "respondents": [r for r in respondent_names if r.strip()],
        "main_proceeding": main_proceeding.value,
        "main_proceeding_desc": main_proceeding_desc,
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date.isoformat(),
        "period_days": period_days,
        "copy_applied_date": copy_applied_date.isoformat() if copy_applied_date else None,
        "copy_ready_date": copy_ready_date.isoformat() if copy_ready_date else None,
        "limitation_expiry": win.expiry.isoformat(),
        "delay_days": win.delay_days,
        "sufficient_cause": sufficient_cause,
        "delay_slot": delay_narrative if delay_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "place": place,
        "computation": win.computation,
    }
    return CondoneDelayResult(refused=False, context=context)
