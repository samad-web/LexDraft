"""Reply to a legal notice under s.138 NI Act — document pipeline (DPC book pp.132-133).

The drawer's advocate replies to the payee's s.138 demand notice, denying the debt
and the issuance-in-discharge, and setting up the defence (e.g. blank/misused
cheque, no liability). The book (pp.132-133) has the advocate letterhead, a general
denial (paras A-D), then a para-wise reply on merits (paras 1-6) answering the
notice's numbered paragraphs.

Hard requirements (each refuses, no partial output):
  - The notice being replied to must be identified (its date) — a reply in the air
    is meaningless.
  - A defence must be pleaded (the reply must set up SOME denial/defence; an empty
    reply generates nothing useful and risks being read as an admission).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "s138_reply.docx"
SPEC = "dpc-132-133"

_UNNAMED_ADVOCATE = re.compile(r"\s*(?:the\s+)?(?:learned\s+)?(?:advocate|counsel|lawyer)s?\b", re.I)


@dataclass(frozen=True)
class S138ReplyResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> S138ReplyResult:
    return S138ReplyResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="s138_reply", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def _one_paragraph(text: str) -> str:
    """Join a one-per-line narrative into one paragraph, each line a sentence."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return " ".join(ln if ln[-1] in ".;:!?" else ln + "." for ln in lines)


def build(
    *,
    advocate: str,
    client: str,
    opposing_advocate: str,
    notice_date: Optional[date],
    defence_narrative: str,
    liability_denied: bool,
    cheque_in_discharge_denied: bool,
    place: str,
    advocate_chamber: Optional[str] = None,
    advocate_phone: Optional[str] = None,
    dispatch_line: Optional[str] = None,
    client_address: Optional[str] = None,
    reply_date: Optional[date] = None,
    # the cheques the drawer demands back (e.g. "both the signed blank cheques,
    # including Cheque No. 204517") and the days allowed to return them.
    cheques_to_return: Optional[str] = None,
    return_within_days: int = 7,
) -> S138ReplyResult:
    """Assemble the reply to a s.138 legal notice, or refuse."""

    if notice_date is None:
        return _refuse(
            "the legal notice being replied to must be identified (its date); it is "
            "absent",
            code="s138_reply_notice_not_identified", fields=("notice_date",),
        )
    if not defence_narrative.strip():
        return _refuse(
            "a reply to a s.138 notice must set up the drawer's defence (the facts on "
            "which the debt / issuance-in-discharge is denied); an empty reply is "
            "refused",
            code="s138_reply_no_defence", fields=("defence_narrative",),
        )

    context: Dict[str, Any] = {
        "advocate": advocate,
        "advocate_chamber": advocate_chamber,
        "advocate_phone": advocate_phone,
        "dispatch_line": dispatch_line,
        "client": client,
        "client_address": client_address,
        # r12: "To, the advocate for Mr. R. Kannappan, Advocate" — a description, not
        # a name: the addressee is named as the gap it is.
        "opposing_advocate": (f"[name of {opposing_advocate.strip()} to be provided]"
                              if _UNNAMED_ADVOCATE.match(opposing_advocate) else opposing_advocate),
        "notice_date": notice_date,
        # the reply's own date: as given, else the day it is drawn
        "reply_date": reply_date or date.today(),
        # one paragraph: a one-per-line textarea rendered as separate lines broke
        # the lettered A-D block, so compose rewrote only A-B and the brief's lines
        # plus orphan "C."/"D." reached the reply verbatim (suite r10).
        "defence_slot": _one_paragraph(defence_narrative),
        # The value follows "to return ..." mid-sentence.
        "cheques_to_return": re.sub(r"^(?:Both|The|All|Said)\b", lambda m: m[0].lower(), (cheques_to_return or "").strip()) or None,
        "return_within_days": return_within_days if return_within_days > 0 else 7,
        "liability_denied": liability_denied,
        "cheque_in_discharge_denied": cheque_in_discharge_denied,
        "place": place,
    }
    return S138ReplyResult(refused=False, context=context)
