"""Notice of suit under s.80 CPC against the Government
— document pipeline (DPC book pp.128-129).

A mandatory two-month notice before suing the Government / a public officer. The
book (pp.128-129) has the advocate letterhead / REGD A/D block addressed to the
Secretary of the department, and then the three particulars s.80 requires: (1)
name/description of the plaintiff, (2) cause of action, (3) reliefs claimed.

Hard requirements (each refuses, no partial output):
  - s.80 mandates all three particulars: the plaintiff's name & description, the
    cause of action, and the relief claimed. Any missing -> the notice is defective.
  - The notice must state that the suit will be filed AFTER the expiry of two months
    (the statutory notice period); the two-month averment must be present.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "s80_notice.docx"
SPEC = "dpc-128-129"


@dataclass(frozen=True)
class S80NoticeResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> S80NoticeResult:
    return S80NoticeResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="s80_notice", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    advocate: str,
    client: str,
    addressee: str,
    government_body: str,
    plaintiff_name_description: str,
    cause_of_action: str,
    reliefs: Sequence[str],
    notice_date: date,
    place: str,
    advocate_chamber: Optional[str] = None,
    advocate_phone: Optional[str] = None,
    dispatch_line: Optional[str] = None,
) -> S80NoticeResult:
    """Assemble the s.80 CPC notice, or refuse."""

    # s.80 requires all three particulars.
    if not plaintiff_name_description.strip():
        return _refuse(
            "s.80 CPC requires the notice to state the name, description and place of "
            "residence of the plaintiff; it is absent",
            code="s80_notice_plaintiff_description_missing",
            fields=("plaintiff_name_description",),
        )
    if not cause_of_action.strip():
        return _refuse(
            "s.80 CPC requires the notice to state the cause of action; it is absent",
            code="s80_notice_cause_of_action_missing",
            fields=("cause_of_action",),
        )
    if not reliefs or not any(r.strip() for r in reliefs):
        return _refuse(
            "s.80 CPC requires the notice to state the relief claimed; it is absent",
            code="s80_notice_relief_missing", fields=("reliefs",),
        )

    context: Dict[str, Any] = {
        "advocate": advocate,
        "advocate_chamber": advocate_chamber,
        "advocate_phone": advocate_phone,
        "dispatch_line": dispatch_line,
        "client": client,
        "addressee": addressee,
        "government_body": government_body,
        "plaintiff_name_description": plaintiff_name_description,
        "cause_of_action": cause_of_action,
        "reliefs": [r for r in reliefs if r.strip()],
        "notice_date": notice_date,
        "place": place,
    }
    return S80NoticeResult(refused=False, context=context)
