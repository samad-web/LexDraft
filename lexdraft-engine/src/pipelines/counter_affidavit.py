"""Counter affidavit on behalf of a respondent — in a writ petition or an
interlocutory application (para-wise reply).

Madras High Court practice: "COUNTER AFFIDAVIT FILED ON BEHALF OF THE
[n]th RESPONDENT" in "W.P. No. ___ of 20__" (or "W.M.P. / I.A. No. ___"): the
deponent's description and authority to swear (for an official respondent, his
designation and that he is acquainted with the facts from the records), the
preliminary submissions / objections, then a PARA-WISE REPLY mirroring the
petition's paragraph numbers, a prayer to dismiss, and the jurat ("Solemnly
affirmed at ___ on this ___ day of ___ and signed his name in my presence")
before an advocate / notary / commissioner.

Like the written statement (O.VIII R.5 for plaints), an averment in the petition
that the counter does not traverse is liable to be treated as admitted, so the
COVERAGE check is load-bearing: every petition paragraph must have a reply.

Hard requirements (each refuses, no partial output):
  - The petition answered must be identified (its number and paragraph count).
  - The deponent must be identified (name and, for an official, designation).
  - Every petition paragraph must have a reply carrying a stance (admitted /
    denied / not admitted); an uncovered paragraph is refused.

A reply's TEXT may be left blank for the compose pass: the paragraph then carries
its stance and "[to be drafted]" (the draft stays un-signable until written).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "counter_affidavit.docx"
SPEC = "mhc-counter"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class Stance(Enum):
    ADMITTED = "admitted"
    DENIED = "denied"
    NOT_ADMITTED = "not_admitted"


_STANCE_LEAD = {
    Stance.ADMITTED: "The averments in paragraph {n} are admitted.",
    Stance.DENIED: "The averments in paragraph {n} are denied.",
    Stance.NOT_ADMITTED: ("The averments in paragraph {n} are not admitted, and the "
                          "petitioner is put to strict proof of the same."),
}


@dataclass(frozen=True)
class ParaReply:
    para: int
    stance: Stance
    text: str = ""


@dataclass(frozen=True)
class CounterAffidavitResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> CounterAffidavitResult:
    return CounterAffidavitResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="counter_affidavit",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def build(
    *,
    petition_ref: str,
    petitioner_names: Sequence[str],
    respondent_names: Sequence[str],
    answering_respondent_serial: int,
    deponent_name: str,
    deponent_description: str,
    petition_para_count: int,
    para_replies: Sequence[ParaReply],
    affirm_date: date,
    place: str,
    deponent_designation: str = "",
    preliminary_objections: Sequence[str] = (),
    main_case_ref: str = "",
    court_name: str = "THE HIGH COURT OF JUDICATURE AT MADRAS",
    jurisdiction_line: str = "",
    prayer_text: str = "",
) -> CounterAffidavitResult:
    """Assemble the counter affidavit, or refuse."""

    if not petition_ref.strip() or petition_para_count <= 0:
        fields = tuple(f for f, bad in (("petition_ref", not petition_ref.strip()),
                                        ("petition_para_count", petition_para_count <= 0))
                       if bad)
        return _refuse(
            "a counter affidavit replies to a specific petition; its number and the "
            "number of its paragraphs must be given",
            code="counter_affidavit_petition_not_identified", fields=fields,
        )
    if not deponent_name.strip() or not deponent_description.strip():
        return _refuse(
            "the deponent must be identified — name and description (parentage, "
            "age, address, or the official's designation and office)",
            code="counter_affidavit_deponent_not_identified",
            fields=("deponent_name", "deponent_description"),
        )

    replied = set()
    for r in para_replies:
        if r.para < 1 or r.para > petition_para_count:
            return _refuse(
                f"a reply is addressed to paragraph {r.para}, outside the petition's "
                f"{petition_para_count} paragraphs",
                code="counter_affidavit_reply_out_of_range",
                fields=("para_replies", "petition_para_count"),
            )
        replied.add(r.para)
    missing = [n for n in range(1, petition_para_count + 1) if n not in replied]
    if missing:
        return _refuse(
            "every averment of the petition must be traversed; an averment not "
            "denied is liable to be treated as admitted. No reply is given to "
            "paragraph(s): " + ", ".join(str(n) for n in missing),
            code="counter_affidavit_uncovered_paragraphs",
            fields=("para_replies", "petition_para_count"),
            computation=f"petition_paras=1..{petition_para_count}; "
                        f"replied={sorted(replied)}; missing={missing}",
        )

    replies: List[Dict[str, Any]] = []
    for r in sorted(para_replies, key=lambda x: x.para):
        lead = _STANCE_LEAD[r.stance].format(n=r.para)
        body = r.text.strip() or _LLM_SLOT_PLACEHOLDER
        replies.append({"para": r.para, "stance": r.stance.value,
                        "text": f"{lead} {body}"})

    serial = answering_respondent_serial if answering_respondent_serial > 0 else 1
    context: Dict[str, Any] = {
        "court_name": court_name,
        "jurisdiction_line": jurisdiction_line,
        "petition_ref": petition_ref,
        "main_case_ref": main_case_ref,
        "affirm_year": affirm_date.year,
        "affirm_date": affirm_date.isoformat(),
        "petitioners": [p for p in petitioner_names if p.strip()],
        "respondents": [r for r in respondent_names if r.strip()],
        "respondent_ordinal": _ordinal(serial),
        "deponent_name": deponent_name,
        "deponent_description": deponent_description,
        "deponent_designation": deponent_designation,
        "preliminary_objections": [o for o in preliminary_objections if o.strip()],
        "para_replies": replies,
        "prayer_text": prayer_text.strip() or "dismiss the petition",
        "place": place,
    }
    return CounterAffidavitResult(refused=False, context=context)
