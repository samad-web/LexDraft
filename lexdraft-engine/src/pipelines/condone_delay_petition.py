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
from ._court_form import kind_of
from .conveyancing import party

TEMPLATE = "condone_delay_petition.docx"
SPEC = "lim-5"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# an appeal from the decree in an original suit: Art. 116 fixes the period
_DECREE = re.compile(r"\bO\.\s?S\.|\bdecree\b|\boriginal suit\b", re.I)
_LEAD_WORD = re.compile(r"^(?:Appeal|Revision|Review|Application|Petition)\b")
_PRONOUN_LEAD = re.compile(r"^(?:Her|His|Their|The|She|He|They|Its|Earlier|Previous|Former|Due|Owing)\b")

_PARTY = r"(?:petitioner|appellant|applicant)"
_OBJECT_LEAD = r"(?:to|for|with|by|from|told|informed|advised|assured|admitted)"


def _first_person(text: str, female: bool) -> str:
    """The deponent's own cause in the affidavit (b2 item 12): 'The petitioner was herself
    admitted ...' -> 'I was myself admitted ...'. Only the deponent's own pronouns turn
    (her/she for a woman); a male counsel's 'he' stays.
    shortcut: a male deponent's 'he/his' stays third person (ambiguous with counsel's)."""
    t = re.sub(rf"\b[Tt]he {_PARTY}'s\b", "my", text)
    t = re.sub(rf"\b({_OBJECT_LEAD}) the {_PARTY}\b", r"\1 me", t)
    t = re.sub(rf"\b[Tt]he {_PARTY}\b", "I", t)
    if female:
        t = re.sub(r"\bherself\b", "myself", t)
        t = re.sub(rf"\b({_OBJECT_LEAD}) her\b", r"\1 me", t)
        t = re.sub(r"\b[Hh]er\b", "my", t)
        t = re.sub(r"\b[Ss]he\b", "I", t)
    else:
        t = re.sub(r"(\bI\b[^.]*?)\bhimself\b", r"\1myself", t)
    t = re.sub(r"\bI (?:is)\b", "I am", t)
    t = re.sub(r"\bI has\b", "I have", t)
    t = re.sub(r"\bI does\b", "I do", t)
    return re.sub(r"(^|[.!?]\s+)my\b", lambda m: m.group(1) + "My", t)


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


_DATE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")


def _dmy(d: date) -> str:
    return f"{d.day:02d}.{d.month:02d}.{d.year}"


def unexplained_stretches(start: date, end: date, cause: str,
                          copy_applied: Optional[date] = None,
                          copy_ready: Optional[date] = None) -> list:
    """The stretches between limitation expiry and filing that no dated event in
    the cause shown covers (r14: 12.07-20.07, 02.09-25.09 and 08.10-07.11 were
    left unexplained). A "D1 to D2" range covers that span; a lone date covers its
    day; the copy application covers applied..ready. Gaps of a day or less drop."""
    spans = []
    for m in re.finditer(rf"{_DATE.pattern}(?:\s*(?:to|till|until|-|–)\s*{_DATE.pattern})?", cause):
        try:
            a = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            b = date(int(m.group(6)), int(m.group(5)), int(m.group(4))) if m.group(4) else a
        except ValueError:
            continue
        spans.append((a, b))
    if copy_applied:
        spans.append((copy_applied, copy_ready or copy_applied))
    gaps, cursor = [], start
    for a, b in sorted(spans):
        if a > cursor and (a - cursor).days > 1 and a <= end:
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    if (end - cursor).days > 1:
        gaps.append((cursor, end))
    return gaps


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

    # r13: the decree's suit ("O.S. No. 73 of 2023") is not this petition's number; a
    # delay petition in a fresh appeal is an I.A. in the A.S.
    if decree_appeal and (not case_ref.strip() or kind_of(case_ref) == "suit"):
        case_ref = f"I.A. No. ______ of {filing_date.year}"
    # r15: her role in the suit ("Plaintiff") is not her role in this petition.
    if main_proceeding is MainProceeding.APPEAL:
        petitioner_role = "Petitioner/Appellant"
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
        "affidavit_cause": _first_person(_mid_sentence(sufficient_cause, _PRONOUN_LEAD),
                                         party(petitioner_name)["his"] == "her"),
        # r15: a filled narrative slot dropped the named stretches; every stretch neither
        # the cause nor the narrative covers stays named, whoever wrote the narrative.
        "delay_slot": " ".join([delay_narrative.strip() or _LLM_SLOT_PLACEHOLDER, *(
                          f"[cause of delay from {_dmy(a)} to {_dmy(b)} to be provided]"
                          for a, b in unexplained_stretches(
                              win.expiry, filing_date, f"{sufficient_cause} {delay_narrative}",
                              copy_applied_date, copy_ready_date))]),
        "place": place,
        # the affidavit cannot annex itself
        "supporting_documents": "; ".join(
            d.strip() for d in re.split(r";", supporting_documents)
            if d.strip() and not re.match(r"(?i)affidavit\b", d.strip())),
        "computation": win.computation,
    }
    return CondoneDelayResult(refused=False, context=context)
