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

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ..components.prayer import relief_clause

TEMPLATE = "counter_affidavit.docx"
SPEC = "mhc-counter"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


_INTERIM_REF = re.compile(r"\s*(?:I\.?\s?A|C\.?\s?M\.?\s?P|W\.?\s?M\.?\s?P|M\.?\s?P)\.?\s*No", re.I)


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
    # the petition paragraph's own averment ("on 20.09.2026 the respondent started
    # building a compound wall blocking the pathway"), used to answer a blank reply.
    allegation: str = ""


_STOP = {"that", "this", "with", "from", "have", "been", "which", "their", "there", "over", "into",
         "upon", "them", "they", "were", "will", "shall", "said", "such", "petitioner", "respondent",
         "suit", "petition", "under", "before", "after", "only", "also", "said", "since", "about"}
_CONSTRUCTION = re.compile(r"\b(?:wall|construct\w*|build\w*|fenc\w*|structure|compound)\b", re.I)
_OWN_LAND = re.compile(r"\bown\s+(?:land|property|site|lands)\b", re.I)


def _words(text: str) -> set:
    return {w.lower() for w in re.findall(r"[A-Za-z]{4,}", text)} - _STOP


def _answer_from_case(allegation: str, case: Sequence[str]) -> str:
    """b2 item 6: a paragraph the extractor left blank is answered from the respondent's
    own case elsewhere in the counter (objections, other replies) that speaks to the same
    thing — and, to a construction allegation, his title to the land it stands on."""
    want = _words(allegation)
    if not want:
        return ""
    sentences = [s.strip() for c in case for s in re.split(r"(?<=[.;])\s+(?=[A-Z])", c) if s.strip()]
    hits = [s for s in sentences
            if (_words(s) & want or (_CONSTRUCTION.search(allegation) and _OWN_LAND.search(s)))
            and not re.match(r"It is (?:denied|not admitted)\b", s)]
    seen: List[str] = []
    for s in hits:
        s = s.rstrip(" .;") + "."
        if s not in seen:
            seen.append(s)
    return " ".join(seen)


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
    documents: Sequence[str] = (),
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
    case = [r.text for r in para_replies if r.text.strip()] + [o for o in preliminary_objections if o.strip()]
    for r in sorted(para_replies, key=lambda x: x.para):
        lead = _STANCE_LEAD[r.stance].format(n=r.para)
        body = (r.text.strip()
                or (_answer_from_case(r.allegation, case) if r.stance is not Stance.ADMITTED else "")
                or _LLM_SLOT_PLACEHOLDER)
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
        # r12: a sole respondent is "the respondent", never "the 1st respondent".
        "respondent_label": ("respondent" if len([r for r in respondent_names if r.strip()]) <= 1
                             else f"{_ordinal(serial)} respondent"),
        # r12: a counter to an interim application answers the triple test too.
        "is_interim": bool(_INTERIM_REF.match(petition_ref)),
        "documents": [d for d in documents if d.strip()],
        "deponent_name": deponent_name,
        # r12: a bare "[deponent description to be provided]" names what is missing.
        "deponent_description": ("[son / daughter / wife of ________, aged about ___ years, residing at ________]"
                                 if re.fullmatch(r"\[[^\]]*\]", deponent_description.strip())
                                 else deponent_description),
        "deponent_designation": deponent_designation,
        "preliminary_objections": [o for o in preliminary_objections if o.strip()],
        "para_replies": replies,
        # b2 item 11: a counter prays for costs.
        "prayer_text": (lambda p: p if re.search(r"\bcosts?\b", p, re.I) else f"{p} with costs")(
            relief_clause(prayer_text) or "dismiss the petition"),
        "place": place,
    }
    return CounterAffidavitResult(refused=False, context=context)
