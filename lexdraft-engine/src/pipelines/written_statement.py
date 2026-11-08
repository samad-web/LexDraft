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

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..components.date_format import body_date
from ..verify.refusals import Refusal, Severity

TEMPLATE = "written_statement.docx"
SPEC = "dpc-27-29"

_LIMITATION = re.compile(r"limitation|time[- ]barred|out of time", re.I)
_NO_ACKNOWLEDGMENT = (
    "The defendant never made any acknowledgment of liability in writing signed by him "
    "within the meaning of Section 18 of the Limitation Act, 1963, and no payment by him "
    "was acknowledged in writing in his handwriting or signed by him, as Section 19 of that "
    "Act requires for a fresh period of limitation. No fresh period of limitation has "
    "therefore begun, and the suit is barred by limitation.")
# The Article the claim falls under, from the claim itself (Schedule, Limitation Act).
_ARTICLES = (
    (re.compile(r"promissory\s+note|pro-?note", re.I),
     "Article 35 of the Schedule to the Limitation Act, 1963, which allows three years "
     "from the date of the promissory note"),
    (re.compile(r"\blent\b|\bloan\b|\bborrow", re.I),
     "Article 19 of the Schedule to the Limitation Act, 1963, which allows three years "
     "from the date the loan was made"),
)


def _with_article(objection: str, claim: str) -> str:
    """A limitation objection names the Article that bars the suit (r16)."""
    if not _LIMITATION.search(objection) or re.search(r"\bArticle\s+\d", objection, re.I):
        return objection
    art = next((a for rx, a in _ARTICLES if rx.search(claim)), None)
    return f"{objection.rstrip(' .')}. The claim is governed by {art}." if art else objection


# "with interest at 24% p.a." / "interest at the rate of 18 per cent per annum" (r17).
_INTEREST_RATE = re.compile(
    r"\binterest\b[^.;%]{0,40}?\b(\d{1,2}(?:\.\d+)?)\s*(?:%|per\s*cent)"
    r"(\s*(?:p\.?\s*a\.?|per\s+annum|p\.?\s*m\.?|per\s+month))?", re.I)


def _interest_denial(*texts: str) -> Optional[str]:
    """A plaint claiming interest at a rate: that rate is specifically denied."""
    m = next((m for t in texts if t for m in [_INTEREST_RATE.search(t)] if m), None)
    if not m:
        return None
    unit = (m.group(2) or "").strip().lower().replace(" ", "")
    unit = {"pa": " p.a.", "p.a": " p.a.", "p.a.": " p.a.", "perannum": " p.a.",
            "pm": " p.m.", "p.m": " p.m.", "p.m.": " p.m.", "permonth": " p.m."}.get(unit, "")
    rate = f"{m.group(1)}%{unit}"
    return (f"The plaintiff's claim for interest at {rate} is denied as excessive and not agreed. "
            f"The defendant never agreed to pay interest at {rate}, and the plaintiff is not "
            "entitled to interest at that rate or at any rate.")


def _o8r1_delay(served: date, filed: date) -> Optional[str]:
    """Order VIII Rule 1 CPC: a WS after 30 days from service explains the delay."""
    days = (filed - served).days
    if days <= 30:
        return None
    late = days - 30
    within = ("within the outer limit of 90 days allowed by its proviso"
              if days <= 90 else "and beyond the 90 days allowed by its proviso")
    return (f"The summons in the suit was served on the defendant on {body_date(served)}, and "
            f"this written statement is filed on {body_date(filed)}, {days} days after service: "
            f"{late} day{'s' if late != 1 else ''} beyond the 30 days in Order VIII Rule 1 of "
            f"the Code of Civil Procedure, 1908, {within}. The delay was caused by [cause of "
            "the delay in filing the written statement to be provided], and was neither wilful "
            "nor wanton. The defendant prays that this Hon'ble Court may be pleased to condone "
            "the delay and receive this written statement on file.")


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
    additional_pleas: Sequence[str] = (),
    summons_served_date: Optional[date] = None,
    # what the plaint claims ("Rs. 3,50,000 with interest at 24% p.a.") (r17).
    plaint_claims: str = "",
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

    # r12: ADDITIONAL PLEAS — the defendant's own case, numbered on from the plaint's
    # paragraphs; a limitation objection also denies what alone could save the suit
    # (a written acknowledgment, s.18, or a payment acknowledged in writing, s.19).
    pleas = [p.strip() for p in additional_pleas if p.strip()]
    if any(_LIMITATION.search(o.text) for o in preliminary_objections):
        pleas.append(_NO_ACKNOWLEDGMENT)
    interest = _interest_denial(plaint_claims or "", *(m.text for m in ordered), *pleas)
    if interest and not any(re.search(r"\binterest\b.*\bdenied\b.*\bexcessive", p, re.I) for p in pleas):
        pleas.append(interest)
    delay = _o8r1_delay(summons_served_date, filing_date) if summons_served_date else None
    if delay:
        pleas.append(delay)
    claim = " ".join([*(o.text for o in preliminary_objections), *(m.text for m in ordered), *pleas])
    first = max([plaint_para_count] + [m.plaint_para for m in ordered]) + 1

    context: Dict[str, Any] = {
        "additional_pleas": [{"n": first + i, "text": t} for i, t in enumerate(pleas)],
        "plaintiff": {"name": plaintiff_name},
        "defendant": {"name": defendant_name},
        "civil_court": civil_court,
        "city": city,
        "suit_ref": suit_ref,
        "case_year": filing_date.year,
        "ws_date": filing_date.isoformat(),
        "plaint_para_count": plaint_para_count,
        "preliminary_objections": [{"text": _with_article(o.text, claim)}
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
