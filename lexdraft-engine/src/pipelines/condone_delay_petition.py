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
import re
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..rules import limitation as lim
from ..verify.refusals import Refusal, Severity
from . import _appeal_window as aw
from .conveyancing import party

TEMPLATE = "condone_delay_petition.docx"
SPEC = "lim-5"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# an appeal from the decree in an original suit: Art. 116 fixes the period
_DECREE = re.compile(r"\bO\.\s?S\.|\bdecree\b|\boriginal suit\b", re.I)
_LEAD_WORD = re.compile(r"^(?:Appeal|Revision|Review|Application|Petition)\b")
_PRONOUN_LEAD = re.compile(r"^(?:Her|His|Their|The|She|He|They|Its)\b")


def _impugned(ref: str, decree_appeal: bool) -> str:
    """'O.S. No. 73 of 2023, ...' -> 'the judgment and decree in O.S. No. 73 of 2023, ...'."""
    ref = ref.strip()
    if re.match(r"(?i)(the\s+)?(judgment|decree|order|award)\b", ref):
        return ref
    return ("the judgment and decree in " if decree_appeal else "the order in ") + ref


def _mid_sentence(text: str, pattern: re.Pattern) -> str:
    """'Her earlier counsel ...' reads 'her earlier counsel ...' after 'because'."""
    text = text.strip().rstrip(".")
    return text[:1].lower() + text[1:] if pattern.match(text) else text


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
    # what the petitioner's affidavit annexes in proof (e.g. the hospital records).
    supporting_documents: str = "",
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

    # Art. 116 is the only period for an appeal from a decree under the CPC: 90 days to
    # the High Court, 30 days to any other court. A different figure (e.g. the delay
    # itself, read as the period) is replaced, never pleaded.
    decree_appeal = (main_proceeding is MainProceeding.APPEAL
                     and bool(_DECREE.search(f"{impugned_order_ref} {main_proceeding_desc}")))
    article = None
    if decree_appeal:
        hc = "high court" in court_name.lower()
        period_days = aw.period("art116_high_court" if hc else "art116_other_court")
        article = "Article 116(a)" if hc else "Article 116(b)"
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
        # "Appeal against ..." reads "the appeal against ..." inside a sentence
        "proceeding_in_text": ("the " + _mid_sentence(main_proceeding_desc, _LEAD_WORD)
                               if _LEAD_WORD.match(main_proceeding_desc.strip())
                               else main_proceeding_desc.strip()),
        "decree_appeal": decree_appeal,
        "impugned_in_text": _impugned(impugned_order_ref, decree_appeal),
        # the description already names the order ("appeal against ... O.S. No. 73 of 2023")
        "desc_names_order": bool((m := re.search(r"No\.\s*\d+\s+of\s+\d{4}", impugned_order_ref))
                                 and m.group(0) in main_proceeding_desc),
        "period_article": article,
        "deponent_his": party(petitioner_name)["his"],
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date.isoformat(),
        "period_days": period_days,
        "copy_applied_date": copy_applied_date.isoformat() if copy_applied_date else None,
        "copy_ready_date": copy_ready_date.isoformat() if copy_ready_date else None,
        "copy_excluded": win.copy_excluded,
        "limitation_expiry": win.expiry.isoformat(),
        "delay_days": win.delay_days,
        "sufficient_cause": _mid_sentence(sufficient_cause, _PRONOUN_LEAD),
        "delay_slot": delay_narrative if delay_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "place": place,
        # the affidavit cannot annex itself
        "supporting_documents": "; ".join(
            d.strip() for d in re.split(r";", supporting_documents)
            if d.strip() and not re.match(r"(?i)affidavit\b", d.strip())),
        "computation": win.computation,
    }
    return CondoneDelayResult(refused=False, context=context)
