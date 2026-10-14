"""Notice of ejectment under s.106 of the Transfer of Property Act, 1882
— document pipeline (DPC book p.127).

An advocate's letter terminating a month-to-month (or year-to-year) tenancy and
calling on the tenant to quit. The book (p.127) has the letterhead / REGD A/D
block, the ownership + tenancy recital, the termination with effect from the last
day of the tenancy month, and the demand for vacant possession.

Hard requirements (each refuses, no partial output):
  - The tenancy-termination date must be given, and the notice must expire with the
    end of a tenancy period (s.106 requires a clear 15 days' notice ending with the
    month/year of the tenancy). We enforce the clear-15-days interval from the
    notice date to the quit date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "s106_notice.docx"
SPEC = "dpc-127"

_NOTICE_CLEAR_DAYS = 15


@dataclass(frozen=True)
class S106NoticeResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> S106NoticeResult:
    return S106NoticeResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="s106_notice", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    advocate: str,
    client: str,
    recipient_name: str,
    recipient_address: str,
    property_desc: str,
    monthly_rent: int,
    notice_date: date,
    quit_date: Optional[date],
    damages_rate_note: str,
    place: str,
    advocate_chamber: Optional[str] = None,
    advocate_phone: Optional[str] = None,
    dispatch_line: Optional[str] = None,
    client_parentage: Optional[str] = None,
    client_address: Optional[str] = None,
) -> S106NoticeResult:
    """Assemble the s.106 TPA ejectment notice, or refuse."""

    if quit_date is None:
        return _refuse(
            "the date by which the tenant is required to quit (the last day of the "
            "tenancy month/year) must be given; it is absent",
            code="s106_notice_quit_date_missing", fields=("quit_date",),
        )
    clear_days = (quit_date - notice_date).days
    if clear_days < _NOTICE_CLEAR_DAYS:
        return _refuse(
            f"a notice under s.106 TPA must give the tenant clear {_NOTICE_CLEAR_DAYS} "
            f"days: notice dated {notice_date}, quit date {quit_date} ({clear_days} "
            f"days); the notice would be invalid",
            code="s106_notice_short",
            fields=("notice_date", "quit_date"),
            computation=f"notice={notice_date}, quit={quit_date}, "
                        f"clear_days={clear_days} (< {_NOTICE_CLEAR_DAYS})",
        )

    context: Dict[str, Any] = {
        "advocate": advocate,
        "advocate_chamber": advocate_chamber,
        "advocate_phone": advocate_phone,
        "dispatch_line": dispatch_line,
        "client": client,
        "client_parentage": client_parentage,
        "client_address": client_address,
        "recipient": {"name": recipient_name, "address": recipient_address},
        "property_desc": property_desc,
        "monthly_rent": monthly_rent,
        "notice_date": notice_date,
        "quit_date": quit_date,
        "clear_days": clear_days,
        "damages_rate_note": damages_rate_note,
        "place": place,
    }
    return S106NoticeResult(refused=False, context=context)
