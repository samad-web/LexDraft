"""First appeal from an original decree — Section 96 read with Order XLI Rule 1
of the Code of Civil Procedure, 1908.

Tamil Nadu practice: "A.S. No. ___ of 20__" (Appeal Suit) before the High Court
of Judicature at Madras or before the District Court / Principal District Judge,
depending on the pecuniary value (the appellate forum is an INPUT — the
valuation thresholds of the Tamil Nadu Civil Courts Act are not encoded here:
[verify: TN Civil Courts Act 1873 s.13 appellate pecuniary limit]). The
memorandum sets out the grounds of objection distinctly and numbered, without
argument or narrative (O.XLI R.1(2)), and is accompanied by a certified copy of
the judgment and decree.

Statute (CPC 1908): s.96(1) appeal from every original decree; s.96(3) no appeal
from a decree passed with the consent of parties; O.XLI R.1 form of appeal;
O.XLI R.3A an appeal presented after the period of limitation must be accompanied
by an application (supported by affidavit) to condone the delay.
Limitation: Limitation Act Art. 116 — 90 days to the High Court, 30 days to any
other court, from the date of the decree (VERIFY table appeal_revision_periods),
s.12(2) copy time excluded.

Hard requirements (each refuses, no partial output):
  - The decree appealed against must be identified (suit no., court, decree date).
  - Consent decree -> no appeal (s.96(3)).
  - Out of time without the O.XLI R.3A application -> refuse.

Grounds of objection (O.XLI R.1(2)) are lettered BY CODE when supplied as a list;
otherwise the grounds slot is left "[to be drafted]" for the compose pass, which
keeps the draft un-signable until they are written.

LLM slots: brief facts and grounds (when no grounds_list is given).
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..rules import limitation as lim
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _appeal_window as aw
from .writ_petition import _letter

TEMPLATE = "civil_first_appeal.docx"
SPEC = "cpc-96-o41"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
# b2 item 12: objections to a Commissioner's report left undecided -> O.XXVI R.10 CPC.
_COMMISSIONER_OBJECTIONS = re.compile(r"commissioner.{0,200}objection|objection.{0,200}commissioner", re.I | re.S)
COMMISSIONER_GROUND = (
    "The trial court failed to consider the appellant's objections to the Commissioner's report. Under "
    "Order XXVI Rule 10(2) CPC the report is evidence in the suit subject to the objections of the parties, "
    "and under Order XXVI Rule 10(3) CPC the court, if dissatisfied with the Commissioner's proceedings, may "
    "direct such further inquiry as it thinks fit; a decree resting on the report without deciding the "
    "objections cannot stand.")
_CONSUMED_TABLES = (aw.PERIODS_TABLE,)


class AppellateForum(Enum):
    HIGH_COURT = "high_court"
    DISTRICT_COURT = "district_court"


@dataclass(frozen=True)
class CivilFirstAppealResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> CivilFirstAppealResult:
    return CivilFirstAppealResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="civil_first_appeal",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    forum: AppellateForum,
    appellant_names: Sequence[str],
    respondent_names: Sequence[str],
    appellant_trial_role: str,
    suit_ref: str,
    trial_court: str,
    decree_date: Optional[date],
    filing_date: date,
    place: str,
    is_consent_decree: bool = False,
    judgment_date: Optional[date] = None,
    valuation: str = "",
    court_fee: str = "",
    copy_applied_date: Optional[date] = None,
    copy_ready_date: Optional[date] = None,
    condone_delay_application_filed: bool = False,
    court_name: Optional[str] = None,
    facts_narrative: str = "",
    grounds_narrative: str = "",
    grounds_list: Optional[Sequence[str]] = None,
) -> CivilFirstAppealResult:
    """Assemble the s.96 / O.XLI first appeal memorandum, or refuse."""

    missing = [f for f, v in (("suit_ref", suit_ref), ("trial_court", trial_court))
               if not v.strip()]
    if decree_date is None:
        missing.append("decree_date")
    if missing:
        return _refuse(
            "a first appeal must identify the decree appealed against — the suit "
            "number, the trial court and the date of the decree; missing: "
            + ", ".join(missing),
            code="civil_first_appeal_decree_not_identified", fields=tuple(missing),
        )

    if is_consent_decree:
        return _refuse(
            "no appeal lies from a decree passed by the court with the consent of "
            "the parties (Section 96(3) CPC)",
            code="civil_first_appeal_consent_decree",
            fields=("is_consent_decree",),
        )

    grounds = [g for g in (grounds_list or []) if g.strip()]
    pleaded = " ".join([facts_narrative, grounds_narrative, *grounds])
    commissioner_ground = (COMMISSIONER_GROUND if _COMMISSIONER_OBJECTIONS.search(pleaded)
                           and not re.search(r"Order\s+XXVI\s+Rule\s+10|O\.\s?XXVI\s+R\.\s?10", pleaded, re.I)
                           else "")
    if commissioner_ground and grounds:
        grounds.append(commissioner_ground)

    if forum is AppellateForum.HIGH_COURT:
        period_key, art = "art116_high_court", "Art. 116(a)"
    else:
        period_key, art = "art116_other_court", "Art. 116(b)"
    period_days = aw.period(period_key)
    try:
        win = aw.window(order_date=decree_date, filing_date=filing_date,
                        period_days=period_days,
                        proceeding_class=lim.ProceedingClass.APPEAL,
                        copy_applied=copy_applied_date, copy_ready=copy_ready_date)
    except lim.LimitationInputError as exc:
        return _refuse(str(exc), code="civil_first_appeal_copy_dates_invalid",
                       fields=("copy_applied_date", "copy_ready_date"))
    if not win.in_time and not condone_delay_application_filed:
        return _refuse(
            f"the appeal is presented {win.delay_days} day(s) after the {period_days}"
            f"-day period (Limitation Act {art}; last day {win.expiry}); Order XLI "
            f"Rule 3A CPC requires it to be accompanied by an application, supported "
            f"by affidavit, under Section 5 of the Limitation Act to condone the delay",
            code="civil_first_appeal_time_barred_no_o41r3a",
            fields=("decree_date", "filing_date", "condone_delay_application_filed"),
            computation=win.computation,
        )

    default_court = ("THE HIGH COURT OF JUDICATURE AT MADRAS"
                     if forum is AppellateForum.HIGH_COURT
                     else "THE COURT OF THE PRINCIPAL DISTRICT JUDGE")
    role = appellant_trial_role.strip().lower() or "plaintiff"
    opp_role = {"plaintiff": "defendant", "defendant": "plaintiff"}.get(role, "opposite party")

    context: Dict[str, Any] = {
        "forum": forum.value,
        "court_name": court_name or default_court,
        "appeal_year": filing_date.year,
        "appeal_date": filing_date.isoformat(),
        "appellants": [a for a in appellant_names if a.strip()],
        "respondents": [r for r in respondent_names if r.strip()],
        "appellant_trial_role": role,
        "respondent_trial_role": opp_role,
        "suit_ref": suit_ref,
        "trial_court": trial_court,
        "decree_date": decree_date.isoformat(),
        "judgment_date": (judgment_date or decree_date).isoformat(),
        "valuation": valuation,
        "court_fee": court_fee,
        "limitation_article": art,
        "limitation_expiry": win.expiry.isoformat(),
        "delay_days": win.delay_days,
        "in_time": win.in_time,
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "lettered_grounds": [{"letter": _letter(i), "text": g}
                             for i, g in enumerate(grounds)],
        "commissioner_ground": "" if grounds else commissioner_ground,
        "grounds_slot": grounds_narrative if grounds_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "computation": win.computation,
    }
    return CivilFirstAppealResult(refused=False, context=context)
