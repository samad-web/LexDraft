"""Criminal revision petition — BNSS ss.438 & 442 (High Court) / ss.438 & 440
(Sessions Judge); formerly CrPC ss.397 & 401 / ss.397 & 399.

Madras High Court practice: "Crl.R.C. No. ___ of 20__" ("CRIMINAL REVISION CASE
filed under Sections 438 and 442 of the Bharatiya Nagarik Suraksha Sanhita,
2023"). Section labels are resolved from the dual-code router (fresh petition ->
BNSS; a revision pending before 1.7.2024 stays under CrPC — BNSS s.531(2)(a)).

VERIFIED (BNSS 2023, Gazette of India Extraordinary No. 54, 25.12.2023):
  s.438(1)  High Court / Sessions Judge may call for and examine the record of any
            inferior Criminal Court as to the "correctness, legality or propriety
            of any finding, sentence or order";
  s.438(2)  the revisional power "shall not be exercised in relation to any
            interlocutory order";
  s.438(3)  an application made by a person to the High Court OR the Sessions
            Judge bars a further application by the same person to the other;
  s.440     Sessions Judge's powers of revision (s.440(3): his decision on a
            person's revision is final as to that person);
  s.442(1)  High Court's powers of revision; s.442(4) no revision at the instance
            of a party who could have appealed and did not.
Limitation: Limitation Act Art. 131 — 90 days from the order sought to be revised
(VERIFY table appeal_revision_periods), s.12(2) copy time excluded.

Hard requirements (each refuses, no partial output):
  - The impugned order must be identified (number/description, date, court).
  - Interlocutory order -> refuse (s.438(2)).
  - A revision before the other revisional forum by the same person -> refuse
    (s.438(3) / s.440(3)).
  - An appeal lay and was not preferred -> refuse (s.442(4)).
  - Filed beyond 90 days (after s.12(2) copy time) without an accompanying
    petition to condone the delay under s.5 Limitation Act -> refuse.
  - Router refusals pass through.

LLM slots: facts (para 3) and grounds (para 5).
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
from .writ_petition import _letter

TEMPLATE = "criminal_revision.docx"
SPEC = "bnss-438-442"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_CHEQUE = re.compile(r"\bcheque", re.IGNORECASE)
_NI_138 = "Section 138 of the Negotiable Instruments Act, 1881"
_CONSUMED_TABLES = ("section_mappings", "code_appointed_day", aw.PERIODS_TABLE)


class RevisionForum(Enum):
    HIGH_COURT = "high_court"
    SESSIONS = "sessions"


@dataclass(frozen=True)
class CriminalRevisionResult:
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
            remedy_hint: str = "none") -> CriminalRevisionResult:
    return CriminalRevisionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="criminal_revision",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    forum: RevisionForum,
    petitioner_names: Sequence[str],
    respondent_names: Sequence[str],
    impugned_order_ref: str,
    impugned_order_date: Optional[date],
    lower_court: str,
    case_ref: str,
    offence_date: Optional[date],
    filing_date: date,
    place: str,
    impugned_order_is_interlocutory: bool = False,
    revision_before_other_forum: bool = False,
    appeal_lies: bool = False,
    copy_applied_date: Optional[date] = None,
    copy_ready_date: Optional[date] = None,
    condone_delay_petition_filed: bool = False,
    is_fresh_action: bool = True,
    proceeding_start_date: Optional[date] = None,
    court_name: Optional[str] = None,
    facts_narrative: str = "",
    grounds_narrative: str = "",
    grounds_list: Optional[Sequence[str]] = None,
    # a revision against a conviction (e.g. affirmed in appeal): the offences and
    # the sentence, so the prayer seeks acquittal. Optional.
    convicted_sections: Optional[Sequence[str]] = None,
    sentence_text: Optional[str] = None,
    draft_suspension_petition: bool = False,
    # a revision against an appellate judgment confirming a conviction: the trial
    # court and its judgment, so the prayer sets aside both. Optional.
    trial_court: Optional[str] = None,
    trial_judgment_date: Optional[date] = None,
) -> CriminalRevisionResult:
    """Assemble the criminal revision petition, or refuse."""

    routed = router.route(offence_date=offence_date,
                          proceeding_start_date=proceeding_start_date,
                          is_fresh_action=is_fresh_action, filing_date=filing_date)
    if routed.refused:
        return CriminalRevisionResult(refused=True, reason=routed.reason,
                                      context=None, refusal=routed.refusal)
    code_framework = routed.code_framework
    sections_map = cf.resolve_sections(code_framework)

    # 1. the impugned order must be identified.
    missing = [f for f, v in (("impugned_order_ref", impugned_order_ref),
                              ("lower_court", lower_court)) if not v.strip()]
    if impugned_order_date is None:
        missing.append("impugned_order_date")
    if missing:
        return _refuse(
            "a revision petition must identify the order sought to be revised — "
            "its description/number, its date and the court that passed it; "
            "missing: " + ", ".join(missing),
            code="criminal_revision_order_not_identified", fields=tuple(missing),
        )

    act_short = "BNSS" if code_framework == "bnss" else "CrPC"
    interlocutory_sec = "Section 438(2) BNSS" if code_framework == "bnss" else "Section 397(2) CrPC"

    # 2. interlocutory order bar.
    if impugned_order_is_interlocutory:
        return _refuse(
            f"the revisional power cannot be exercised in relation to an "
            f"interlocutory order ({interlocutory_sec}); the impugned order is "
            f"marked interlocutory",
            code="criminal_revision_interlocutory_order",
            fields=("impugned_order_is_interlocutory",),
        )

    # 3. one revisional forum only.
    if revision_before_other_forum:
        bar = ("Sections 438(3) and 440(3) BNSS" if code_framework == "bnss"
               else "Sections 397(3) and 399(3) CrPC")
        return _refuse(
            f"the petitioner has already applied in revision to the other "
            f"revisional forum against the same order; a further revision by the "
            f"same person is barred ({bar})",
            code="criminal_revision_other_forum_bar",
            fields=("revision_before_other_forum",),
        )

    # 4. appeal lay and was not brought.
    if appeal_lies:
        bar = "Section 442(4) BNSS" if code_framework == "bnss" else "Section 401(4) CrPC"
        return _refuse(
            f"an appeal lies against the impugned order; where an appeal lies and "
            f"none is brought, no revision is entertained at the instance of the "
            f"party who could have appealed ({bar}). File an appeal instead",
            code="criminal_revision_appeal_lies",
            fields=("appeal_lies",),
        )

    # 5. limitation — Art. 131, 90 days, s.12(2) copy time.
    try:
        win = aw.window(order_date=impugned_order_date, filing_date=filing_date,
                        period_days=aw.period("art131_revision"),
                        proceeding_class=lim.ProceedingClass.REVISION,
                        copy_applied=copy_applied_date, copy_ready=copy_ready_date)
    except lim.LimitationInputError as exc:
        return _refuse(str(exc), code="criminal_revision_copy_dates_invalid",
                       fields=("copy_applied_date", "copy_ready_date"))
    if not win.in_time and not condone_delay_petition_filed:
        return _refuse(
            f"the revision is filed {win.delay_days} day(s) beyond the 90-day "
            f"period (Limitation Act Art. 131; last day {win.expiry}); it must be "
            f"accompanied by a petition under Section 5 of the Limitation Act to "
            f"condone the delay",
            code="criminal_revision_time_barred_no_condonation",
            fields=("impugned_order_date", "filing_date",
                    "condone_delay_petition_filed"),
            computation=win.computation,
        )

    key = ("criminal_revision_high_court" if forum is RevisionForum.HIGH_COURT
           else "criminal_revision_sessions")
    section_label = sections_map[key]
    act_full = ("the Bharatiya Nagarik Suraksha Sanhita, 2023"
                if code_framework == "bnss" else
                "the Code of Criminal Procedure, 1973")
    default_court = ("THE HIGH COURT OF JUDICATURE AT MADRAS"
                     if forum is RevisionForum.HIGH_COURT
                     else "THE COURT OF THE PRINCIPAL SESSIONS JUDGE")
    court_name = court_name or default_court
    madurai = forum is RevisionForum.HIGH_COURT and madurai_bench(
        court_name, lower_court, case_ref, place)
    if madurai and "madurai" not in court_name.lower():
        court_name = MADURAI_COURT
    md_suffix = "(MD)" if madurai else ""
    case_label = ("CRL.R.C." if forum is RevisionForum.HIGH_COURT else "CRL.R.P.") + md_suffix
    secs = [s for s in (convicted_sections or []) if s.strip()]
    # a cheque-dishonour conviction: s.138 of the Negotiable Instruments Act. The
    # extractor may give only the offence's name ("dishonour of a cheque", r10),
    # which the prayer then recited as "the offence under Dishonour of a cheque".
    secs = list(dict.fromkeys(
        _NI_138 if (_CHEQUE.search(s) and not re.search(r"\d", s.split("Rs")[0])) else s
        for s in secs))
    ni_act = any(re.search(r"\b138\b", s) and re.search(r"\bN\.?\s?I\b|negotiable", s, re.I)
                 for s in secs)

    # r15: compose opened para 1 "By that judgment ..." with nothing before it. Para 1
    # names the impugned judgment itself - court, case number, date - and the trial
    # case it arose from, so any redraft keeps its antecedent.
    the = lambda c: c if re.match(r"(?i)the\b", c) else f"the {c}"  # noqa: E731
    on = impugned_order_date.strftime("%d.%m.%Y")
    if re.match(r"(?i)\s*(?:the\s+)?(?:judgment|order|common)\b", impugned_order_ref):
        ident = (f"{impugned_order_ref.strip()} dated {on} passed by {the(lower_court.strip())}"
                 + (f" in {case_ref.strip()}" if case_ref.strip() else ""))
    else:
        kind = ("judgment" if re.search(r"(?i)\b(?:Crl\.?\s*)?A\.|\bappeal|\bS\.?\s?T\.?\s?C\.|\bC\.\s?C\.|\bS\.\s?C\.",
                                        impugned_order_ref) else "order")
        ident = f"the {kind} dated {on} passed by {the(lower_court.strip())} in {impugned_order_ref.strip()}"
        if case_ref.strip() and case_ref.strip() not in impugned_order_ref:
            ident += (", arising out of the judgment of conviction and sentence passed by "
                      f"{the(trial_court.strip())} in {case_ref.strip()}" if secs and (trial_court or "").strip()
                      else f", arising out of {case_ref.strip()}")
    context: Dict[str, Any] = {
        "impugned_identification": ident,
        "forum": forum.value,
        "court_name": court_name,
        "md_suffix": md_suffix,
        "trial_court": (trial_court or "").strip() or None,
        "trial_judgment_date": trial_judgment_date.isoformat() if trial_judgment_date else None,
        "case_label": case_label,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "petitioners": [p for p in petitioner_names if p.strip()],
        "respondents": [r for r in respondent_names if r.strip()],
        "convicted_sections": secs,
        "against_conviction": bool(secs),
        "ni_act": ni_act,
        "suspension": {
            "draft": draft_suspension_petition,
            "year": filing_date.year,
            # revisional power includes the appellate power to suspend
            "section": (sections_map["suspension_of_sentence"] + " read with "
                        + ("Section 442 BNSS" if code_framework == "bnss"
                           else "Section 401 CrPC")),
            "main_label": case_label,
            "proceeding": "revision",
            "order_ref": f"{impugned_order_ref} dated "
                         f"{impugned_order_date.isoformat()}",
            "court": lower_court,
            "sentence": sentence_text,
        },
        "code_framework": code_framework,
        "act_short": act_short,
        "section_label": section_label,
        "act_full": act_full,
        "section_full": _full(section_label, act_full),
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date.isoformat(),
        "lower_court": lower_court,
        "case_ref": case_ref,
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
    return CriminalRevisionResult(refused=False, context=context)
