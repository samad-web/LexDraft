"""Quash petition — Criminal Original Petition under Section 528 BNSS (formerly
Section 482 CrPC) to quash an FIR / final report (charge sheet) / private
complaint / pending criminal proceedings.

Filed in the High Court (Madras High Court practice: "Crl.O.P. No. ___ of 20__",
"CRIMINAL ORIGINAL PETITION filed under Section 528 of the Bharatiya Nagarik
Suraksha Sanhita, 2023"). The section label is NOT hardcoded: it is resolved from
the dual-code router (a fresh petition takes BNSS s.528 even on a pre-1.7.2024
FIR; a proceeding pending before the appointed day stays under CrPC s.482 —
BNSS s.531(2)(a)).

VERIFIED (BNSS 2023, Gazette of India Extraordinary No. 54, 25.12.2023): s.528
"Saving of inherent powers of High Court" — "to give effect to any order under
this Sanhita, or to prevent abuse of the process of any Court or otherwise to
secure the ends of justice".

Hard requirements (each refuses, no partial output):
  - The impugned proceeding must be identified (its number AND the police station
    / court where it stands) — the High Court is asked to call for that record.
  - The offences alleged must be stated.
  - Quash on COMPROMISE: the de facto complainant must be arrayed as a respondent
    and the joint compromise memo / affidavit annexed (the court records the
    complainant's consent before quashing).
  - A petitioner whose revision against the same order already failed cannot use
    s.528 as a second revision unless special circumstances are pleaded.
  - The framework router's own refusals (no offence date; pending proceeding of
    unknown provenance) pass through unchanged.

LLM slots: facts (para 3) and grounds (para 5). Everything else is deterministic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..rules import dual_code_router as router
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _code_framework as cf
from .writ_petition import _letter

TEMPLATE = "quash_petition.docx"
SPEC = "bnss-528"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_CONSUMED_TABLES = ("section_mappings", "code_appointed_day")


class QuashTarget(Enum):
    FIR = "fir"
    FINAL_REPORT = "final_report"          # charge sheet / police report
    PRIVATE_COMPLAINT = "private_complaint"
    PROCEEDINGS = "proceedings"            # pending C.C. / S.C. generally


class QuashBasis(Enum):
    MERITS = "merits"          # no offence made out / abuse of process
    COMPROMISE = "compromise"  # settlement with the de facto complainant


_TARGET_LABEL = {
    QuashTarget.FIR: "the First Information Report",
    QuashTarget.FINAL_REPORT: "the Final Report (charge sheet)",
    QuashTarget.PRIVATE_COMPLAINT: "the private complaint",
    QuashTarget.PROCEEDINGS: "the proceedings",
}


@dataclass(frozen=True)
class QuashPetitionResult:
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
            remedy_hint: str = "none") -> QuashPetitionResult:
    return QuashPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="quash_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_names: Sequence[str],
    respondent_names: Sequence[str],
    target: QuashTarget,
    proceeding_ref: str,
    proceeding_forum: str,
    sections: Sequence[str],
    offence_date: Optional[date],
    filing_date: date,
    place: str,
    quash_basis: QuashBasis = QuashBasis.MERITS,
    is_fresh_action: bool = True,
    proceeding_start_date: Optional[date] = None,
    de_facto_complainant_is_respondent: bool = False,
    compromise_memo_annexed: bool = False,
    prior_revision_dismissed: bool = False,
    special_circumstances: Optional[str] = None,
    stay_sought: bool = True,
    high_court: str = "THE HIGH COURT OF JUDICATURE AT MADRAS",
    bench: Optional[str] = None,
    facts_narrative: str = "",
    grounds_narrative: str = "",
    grounds_list: Optional[Sequence[str]] = None,
) -> QuashPetitionResult:
    """Assemble the s.528 BNSS / s.482 CrPC quash petition, or refuse."""

    # 0. procedural framework via the dual-code router (cites s.528 or s.482).
    routed = router.route(offence_date=offence_date,
                          proceeding_start_date=proceeding_start_date,
                          is_fresh_action=is_fresh_action, filing_date=filing_date, sections=sections)
    if routed.refused:
        return QuashPetitionResult(refused=True, reason=routed.reason,
                                   context=None, refusal=routed.refusal)
    code_framework = routed.code_framework
    sections_map = cf.resolve_sections(code_framework)

    # 1. the impugned proceeding must be identified.
    missing = [f for f, v in (("proceeding_ref", proceeding_ref),
                              ("proceeding_forum", proceeding_forum)) if not v.strip()]
    if missing:
        return _refuse(
            "a quash petition asks the High Court to call for and quash a specific "
            "record; the proceeding (its number, e.g. 'Crime No. 123 of 2025', and "
            "the police station or court where it stands) must be identified; "
            "missing: " + ", ".join(missing),
            code="quash_petition_proceeding_not_identified", fields=tuple(missing),
        )

    # 2. the offences alleged.
    secs = [s for s in sections if s.strip()]
    if not secs:
        return _refuse(
            "the offences alleged in the impugned proceeding (sections and Act) "
            "must be stated",
            code="quash_petition_no_sections", fields=("sections",),
        )

    # 3. quash on compromise: complainant arrayed + compromise annexed.
    if quash_basis is QuashBasis.COMPROMISE:
        if not de_facto_complainant_is_respondent:
            return _refuse(
                "a petition to quash on the basis of a compromise must array the de "
                "facto complainant as a respondent so that the court can record the "
                "complainant's consent",
                code="quash_petition_compromise_complainant_not_party",
                fields=("de_facto_complainant_is_respondent", "respondent_names"),
            )
        if not compromise_memo_annexed:
            return _refuse(
                "a petition to quash on the basis of a compromise must annex the "
                "joint compromise memo / affidavit of the de facto complainant",
                code="quash_petition_compromise_memo_not_annexed",
                fields=("compromise_memo_annexed",),
            )

    # 4. not a disguised second revision.
    if prior_revision_dismissed and not (special_circumstances and special_circumstances.strip()):
        return _refuse(
            "the petitioner's revision against the same order has already been "
            "dismissed; the inherent power cannot be invoked as a second revision "
            "unless special circumstances (a gross miscarriage of justice or abuse "
            "of process) are pleaded",
            code="quash_petition_second_revision_bar",
            fields=("prior_revision_dismissed", "special_circumstances"),
        )

    section_label = sections_map["quash_petition"]
    act_full = ("the Bharatiya Nagarik Suraksha Sanhita, 2023"
                if code_framework == "bnss" else
                "the Code of Criminal Procedure, 1973")
    target_label = _TARGET_LABEL[target]
    petitioners = [p for p in petitioner_names if p.strip()]
    respondents = [r for r in respondent_names if r.strip()]

    context: Dict[str, Any] = {
        "high_court": high_court,
        "bench": bench,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "petitioners": petitioners,
        "respondents": respondents,
        "code_framework": code_framework,
        "section_label": section_label,
        "act_full": act_full,
        "section_full": _full(section_label, act_full),
        "target": target.value,
        "target_label": target_label,
        "proceeding_ref": proceeding_ref,
        "proceeding_forum": proceeding_forum,
        "sections": secs,
        "quash_basis": quash_basis.value,
        "is_compromise": quash_basis is QuashBasis.COMPROMISE,
        "special_circumstances": special_circumstances,
        "stay_sought": stay_sought,
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "lettered_grounds": [
            {"letter": _letter(i), "text": g}
            for i, g in enumerate([g for g in (grounds_list or []) if g.strip()])
        ],
        "grounds_slot": grounds_narrative if grounds_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "computation": routed.computation,
    }
    return QuashPetitionResult(refused=False, context=context)
