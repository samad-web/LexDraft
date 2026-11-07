"""Criminal appeal against conviction — BNSS s.415(2) (to the High Court) /
s.415(3) (to the Court of Session); formerly CrPC s.374(2) / s.374(3).

Madras High Court practice: "Crl.A. No. ___ of 20__" — "CRIMINAL APPEAL filed
under Section 415(2) of the Bharatiya Nagarik Suraksha Sanhita, 2023 against the
judgment of conviction and sentence dated __ in S.C. No. __". The memorandum is
a petition in writing accompanied by a copy of the judgment (s.423). Section
labels come from the dual-code router.

VERIFIED (BNSS 2023, Gazette of India Extraordinary No. 54, 25.12.2023):
  s.413   no appeal except as provided (victim's proviso);
  s.415(2) conviction on a trial by a Sessions Judge / Additional Sessions Judge,
           or by any other court passing a sentence of more than seven years ->
           appeal to the High Court;
  s.415(3) conviction by a Magistrate of the first or second class (save as in
           s.415(2)) -> appeal to the Court of Session;
  s.416   no appeal on a plea of guilty, except as to the extent or legality of
           the sentence (conviction by Sessions / Magistrate);
  s.423   petition of appeal + copy of the judgment;
  s.424   appellant in jail presents through the officer in charge of the jail;
  s.430   suspension of sentence pending appeal; release on bail.
Limitation: Limitation Act Art. 115(b) — 60 days to the High Court, 30 days to
any other court; Art. 115(a) — 30 days from a sentence of death (VERIFY table
appeal_revision_periods), s.12(2) copy time excluded.

Hard requirements (each refuses, no partial output):
  - The judgment appealed against must be identified (case no., court, date).
  - FORUM (s.415): a Sessions trial, or any sentence above seven years, appeals
    to the High Court; a Magistrate's conviction (sentence <= 7 years) appeals to
    the Court of Session. A mismatch is refused.
  - Plea of guilty -> appeal only on the extent/legality of sentence (s.416).
  - Out of time without a s.5 condone-delay petition -> refuse.
  - Router refusals pass through.

LLM slots: facts / prosecution case (para 3) and grounds (para 5).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..rules import dual_code_router as router
from ..rules import limitation as lim
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _appeal_window as aw
from . import _code_framework as cf
from ._bench import MADURAI_COURT, madurai_bench
from ._state_party import with_state
from .writ_petition import _letter

TEMPLATE = "criminal_appeal.docx"
SPEC = "bnss-415"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_CONSUMED_TABLES = ("section_mappings", "code_appointed_day", aw.PERIODS_TABLE)


class AppealForum(Enum):
    HIGH_COURT = "high_court"
    SESSIONS = "sessions"


class TrialCourt(Enum):
    SESSIONS = "sessions"                  # Sessions / Additional Sessions Judge
    MAGISTRATE = "magistrate"              # Magistrate of the first / second class


@dataclass(frozen=True)
class CriminalAppealResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _full(label: str, act_full: str) -> str:
    """'Section 528 BNSS' -> 'Section 528 of the Bharatiya Nagarik Suraksha
    Sanhita, 2023' (the full citation used in the petition's title)."""
    return re.sub(r"\s+(BNSS|CrPC)$", "", label) + " of " + act_full


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> CriminalAppealResult:
    return CriminalAppealResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="criminal_appeal",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    forum: AppealForum,
    trial_court_level: TrialCourt,
    appellant_names: Sequence[str],
    respondent_names: Sequence[str],
    trial_case_ref: str,
    trial_court: str,
    judgment_date: Optional[date],
    convicted_sections: Sequence[str],
    sentence_text: str,
    max_sentence_years: int,
    offence_date: Optional[date],
    filing_date: date,
    place: str,
    death_sentence: bool = False,
    pleaded_guilty: bool = False,
    appeal_limited_to_sentence: bool = False,
    appellant_in_custody: bool = False,
    copy_applied_date: Optional[date] = None,
    copy_ready_date: Optional[date] = None,
    condone_delay_petition_filed: bool = False,
    suspension_petition_filed: bool = True,
    is_fresh_action: bool = True,
    proceeding_start_date: Optional[date] = None,
    court_name: Optional[str] = None,
    facts_narrative: str = "",
    grounds_narrative: str = "",
    grounds_list: Optional[Sequence[str]] = None,
    # the State is arrayed in a police case (rep. by the Inspector of Police of
    # the investigating station); a private-complaint case is between the parties.
    police_station: Optional[str] = None,
    crime_no: Optional[str] = None,
    private_complaint: bool = False,
    # append the companion s.430 BNSS / s.389 CrPC petition to suspend the
    # sentence. Optional.
    draft_suspension_petition: bool = False,
    # the suspension petition's custody ground and its supporting affidavit.
    custody_since: Optional[date] = None,
    deponent_description: Optional[str] = None,
) -> CriminalAppealResult:
    """Assemble the criminal appeal against conviction, or refuse."""

    routed = router.route(offence_date=offence_date,
                          proceeding_start_date=proceeding_start_date,
                          is_fresh_action=is_fresh_action, filing_date=filing_date)
    if routed.refused:
        return CriminalAppealResult(refused=True, reason=routed.reason,
                                    context=None, refusal=routed.refusal)
    code_framework = routed.code_framework
    sections_map = cf.resolve_sections(code_framework)
    bnss = code_framework == "bnss"

    # 1. the judgment appealed against.
    missing = [f for f, v in (("trial_case_ref", trial_case_ref),
                              ("trial_court", trial_court),
                              ("sentence_text", sentence_text)) if not v.strip()]
    if judgment_date is None:
        missing.append("judgment_date")
    if missing:
        return _refuse(
            "an appeal against conviction must identify the judgment appealed "
            "against — the case number, the trial court, the date of the judgment "
            "and the sentence imposed; missing: " + ", ".join(missing),
            code="criminal_appeal_judgment_not_identified", fields=tuple(missing),
        )
    secs = [s for s in convicted_sections if s.strip()]
    if not secs:
        return _refuse(
            "the offences of which the appellant stands convicted must be stated",
            code="criminal_appeal_no_sections", fields=("convicted_sections",),
        )

    # 2. forum (s.415(2) / s.415(3)).
    to_high_court = (trial_court_level is TrialCourt.SESSIONS
                     or max_sentence_years > 7 or death_sentence)
    hc_sec = "Section 415(2) BNSS" if bnss else "Section 374(2) CrPC"
    ses_sec = "Section 415(3) BNSS" if bnss else "Section 374(3) CrPC"
    if to_high_court and forum is not AppealForum.HIGH_COURT:
        return _refuse(
            f"a conviction on a trial held by a Sessions Judge, or one carrying a "
            f"sentence of more than seven years, is appealable to the High Court "
            f"({hc_sec}), not to the Court of Session",
            code="criminal_appeal_wrong_forum_high_court",
            fields=("forum", "trial_court_level", "max_sentence_years"),
        )
    if not to_high_court and forum is not AppealForum.SESSIONS:
        return _refuse(
            f"a conviction by a Magistrate with a sentence not exceeding seven years "
            f"is appealable to the Court of Session ({ses_sec}), not directly to "
            f"the High Court",
            code="criminal_appeal_wrong_forum_sessions",
            fields=("forum", "trial_court_level", "max_sentence_years"),
        )

    # 3. plea of guilty (s.416 / s.375).
    if pleaded_guilty and not appeal_limited_to_sentence:
        bar = "Section 416 BNSS" if bnss else "Section 375 CrPC"
        return _refuse(
            f"the appellant was convicted on his own plea of guilty; an appeal lies "
            f"only as to the extent or legality of the sentence ({bar}). Limit the "
            f"appeal to the sentence",
            code="criminal_appeal_plea_of_guilty",
            fields=("pleaded_guilty", "appeal_limited_to_sentence"),
        )

    # 4. limitation — Art. 115.
    if death_sentence:
        period_key, art = "art115_death_sentence", "Art. 115(a)"
    elif forum is AppealForum.HIGH_COURT:
        period_key, art = "art115_high_court", "Art. 115(b)(i)"
    else:
        period_key, art = "art115_other_court", "Art. 115(b)(ii)"
    period_days = aw.period(period_key)
    try:
        win = aw.window(order_date=judgment_date, filing_date=filing_date,
                        period_days=period_days,
                        proceeding_class=lim.ProceedingClass.APPEAL,
                        copy_applied=copy_applied_date, copy_ready=copy_ready_date)
    except lim.LimitationInputError as exc:
        return _refuse(str(exc), code="criminal_appeal_copy_dates_invalid",
                       fields=("copy_applied_date", "copy_ready_date"))
    if not win.in_time and not condone_delay_petition_filed:
        return _refuse(
            f"the appeal is filed {win.delay_days} day(s) beyond the {period_days}-"
            f"day period (Limitation Act {art}; last day {win.expiry}); it must be "
            f"accompanied by a petition under Section 5 of the Limitation Act to "
            f"condone the delay",
            code="criminal_appeal_time_barred_no_condonation",
            fields=("judgment_date", "filing_date", "condone_delay_petition_filed"),
            computation=win.computation,
        )

    key = ("criminal_appeal_high_court" if forum is AppealForum.HIGH_COURT
           else "criminal_appeal_sessions")
    act_full = ("the Bharatiya Nagarik Suraksha Sanhita, 2023" if bnss
                else "the Code of Criminal Procedure, 1973")
    default_court = ("THE HIGH COURT OF JUDICATURE AT MADRAS"
                     if forum is AppealForum.HIGH_COURT
                     else "THE COURT OF THE PRINCIPAL SESSIONS JUDGE")
    court_name = court_name or default_court
    madurai = forum is AppealForum.HIGH_COURT and madurai_bench(
        court_name, trial_court, police_station, place)
    if madurai and "madurai" not in court_name.lower():
        court_name = MADURAI_COURT
    md_suffix = "(MD)" if madurai else ""

    context: Dict[str, Any] = {
        "forum": forum.value,
        "court_name": court_name,
        "md_suffix": md_suffix,
        "appeal_year": filing_date.year,
        "appeal_date": filing_date.isoformat(),
        "appellants": [a for a in appellant_names if a.strip()],
        "respondents": ([r for r in respondent_names if r.strip()]
                        if private_complaint else
                        with_state(respondent_names, police_station, crime_no)),
        "suspension": {
            "draft": draft_suspension_petition,
            "year": filing_date.year,
            "section": sections_map["suspension_of_sentence"],
            "main_label": ("CRL.A." if forum is AppealForum.HIGH_COURT else "Crl.A.") + md_suffix,
            # a fixed term (not death / life) is the classic ground for suspension
            "fixed_term": not death_sentence and "life" not in sentence_text.lower(),
            "custody_since": custody_since.isoformat() if custody_since else None,
            "deponent_description": (deponent_description or "").strip() or None,
            "proceeding": "appeal",
            "order_ref": f"the judgment dated {judgment_date.isoformat()} in "
                         f"{trial_case_ref}",
            "court": trial_court,
            "sentence": sentence_text,
        },
        "code_framework": code_framework,
        "section_label": sections_map[key],
        "suspension_section": sections_map["suspension_of_sentence"],
        "act_full": act_full,
        "section_full": _full(sections_map[key], act_full),
        "trial_case_ref": trial_case_ref,
        "trial_court": trial_court,
        "judgment_date": judgment_date.isoformat(),
        "convicted_sections": secs,
        "sentence_text": sentence_text,
        "pleaded_guilty": pleaded_guilty,
        "appellant_in_custody": appellant_in_custody,
        "suspension_petition_filed": suspension_petition_filed,
        "limitation_article": art,
        "limitation_expiry": win.expiry.isoformat(),
        "delay_days": win.delay_days,
        "in_time": win.in_time,
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "lettered_grounds": [{"letter": _letter(i), "text": g} for i, g in
                             enumerate([g for g in (grounds_list or []) if g.strip()])],
        "grounds_slot": grounds_narrative if grounds_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "computation": f"{routed.computation}; {win.computation}",
    }
    return CriminalAppealResult(refused=False, context=context)
