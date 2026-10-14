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

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "s138_reply.docx"
SPEC = "dpc-132-133"


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
        "opposing_advocate": opposing_advocate,
        "notice_date": notice_date,
        "defence_slot": defence_narrative,
        "liability_denied": liability_denied,
        "cheque_in_discharge_denied": cheque_in_discharge_denied,
        "place": place,
    }
    return S138ReplyResult(refused=False, context=context)
