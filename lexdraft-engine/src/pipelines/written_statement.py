"""Written Statement on behalf of the defendant — document pipeline (DPC book pp.27-29).

The defendant's answer to a plaint. Unlike every other pipeline (which builds from a
fact sheet), a written statement is built AGAINST another pleading: it must reply,
paragraph by paragraph, to the plaint, and Order VIII Rule 5 CPC deems every
material allegation NOT specifically denied to be ADMITTED. So the coverage check
here is the load-bearing one: the number of merit-replies must cover the number of
plaint paragraphs, or the pipeline refuses (a WS that silently omits a plaint para
concedes it).

Structure (book pp.27-29): MOST RESPECTFULLY SHOWETH → PRELIMINARY OBJECTIONS
(numbered points of law: limitation, jurisdiction, valuation, no-cause-of-action,
non-joinder/mis-joinder, res judicata, s.80 notice, s.69 Partnership Act, etc.) →
ON MERITS (para-wise reply mirroring the plaint's numbering) → PRAYER (dismiss the
suit, costs) → VERIFICATION (personal knowledge vs legal advice) → [NOTE: counter-
claim / set-off may be joined].

Hard requirements (each refuses, no partial output):
  - The plaint being answered must be identified (its paragraph count) — there is
    nothing to reply to otherwise.
  - O8 R5 COVERAGE: every plaint paragraph must have a merit-reply. A gap = a deemed
    admission of an un-replied allegation = a defective, self-defeating WS -> refuse.
  - Each merit-reply must carry a stance (admitted / denied / not-admitted-for-want-
    of-knowledge); a reply with no stance is not a reply.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "written_statement.docx"
SPEC = "dpc-27-29"


class Stance(Enum):
    ADMITTED = "admitted"
    DENIED = "denied"
    NOT_ADMITTED = "not_admitted"      # denied for want of knowledge (strict proof)


@dataclass(frozen=True)
class MeritReply:
    plaint_para: int
    stance: Stance
    text: str                          # the reply, e.g. "It is specifically denied…"


@dataclass(frozen=True)
class PreliminaryObjection:
    text: str                          # a point of law, e.g. limitation / jurisdiction


@dataclass(frozen=True)
class WrittenStatementResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> WrittenStatementResult:
    return WrittenStatementResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="written_statement",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    plaintiff_name: str,
    defendant_name: str,
    suit_ref: str,
    plaint_para_count: int,
    preliminary_objections: Sequence[PreliminaryObjection],
    merit_replies: Sequence[MeritReply],
    filing_date: date,
    place: str,
    counter_claim_or_setoff: bool = False,
    # cause-title header. Optional.
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> WrittenStatementResult:
    """Assemble the written statement, or refuse."""

    # 1. the plaint being answered must be identified.
    if plaint_para_count <= 0:
        return _refuse(
            "a written statement replies to a plaint; the number of paragraphs in "
            "the plaint being answered must be known and is absent or non-positive",
            code="written_statement_plaint_not_identified",
            fields=("plaint_para_count",),
        )

    # 2. each merit-reply must carry a real stance (the Stance enum guarantees this),
    #    and must point at a valid plaint paragraph.
    replied_paras = set()
    for mr in merit_replies:
        if mr.plaint_para < 1 or mr.plaint_para > plaint_para_count:
            return _refuse(
                f"a reply is addressed to plaint paragraph {mr.plaint_para}, which is "
                f"outside the plaint's {plaint_para_count} paragraphs",
                code="written_statement_reply_out_of_range",
                fields=("merit_replies", "plaint_para_count"),
            )
        if not mr.text.strip():
            return _refuse(
                f"the reply to plaint paragraph {mr.plaint_para} is empty; a reply "
                f"must state the defendant's answer, not merely a stance label",
                code="written_statement_reply_empty",
                fields=("merit_replies",),
            )
        replied_paras.add(mr.plaint_para)

    # 3. O8 R5 COVERAGE — every plaint paragraph must be replied to. A gap is a
    #    deemed admission of the un-replied allegation; the WS is self-defeating.
    missing = [n for n in range(1, plaint_para_count + 1) if n not in replied_paras]
    if missing:
        return _refuse(
            "Order VIII Rule 5 CPC deems every material allegation in the plaint that "
            "is not specifically denied to be admitted; the following plaint "
            "paragraphs have no reply and would be deemed admitted: "
            + ", ".join(str(n) for n in missing)
            + ". The written statement will not be generated with these gaps",
            code="written_statement_o8r5_uncovered_paragraphs",
            fields=("merit_replies", "plaint_para_count"),
            computation=f"plaint_paras=1..{plaint_para_count}; "
                        f"replied={sorted(replied_paras)}; missing={missing}",
        )

    # merit-reply paragraph numbering mirrors the plaint (sorted by plaint_para).
    ordered = sorted(merit_replies, key=lambda m: m.plaint_para)
    denied_or_not_admitted = [m.plaint_para for m in ordered
                              if m.stance in (Stance.DENIED, Stance.NOT_ADMITTED)]
    admitted = [m.plaint_para for m in ordered if m.stance is Stance.ADMITTED]

    context: Dict[str, Any] = {
        "plaintiff": {"name": plaintiff_name},
        "defendant": {"name": defendant_name},
        "civil_court": civil_court,
        "city": city,
        "suit_ref": suit_ref,
        "case_year": filing_date.year,
        "ws_date": filing_date.isoformat(),
        "plaint_para_count": plaint_para_count,
        "preliminary_objections": [{"text": o.text}
                                   for o in preliminary_objections],
        "merit_replies": [{"plaint_para": m.plaint_para, "stance": m.stance.value,
                           "text": m.text} for m in ordered],
        "admitted_paras": admitted,
        "denied_paras": denied_or_not_admitted,
        "counter_claim_or_setoff": counter_claim_or_setoff,
        "has_ws_verification": True,
        "place": place,
    }
    return WrittenStatementResult(refused=False, context=context)
