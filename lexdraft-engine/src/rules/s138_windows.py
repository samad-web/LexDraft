"""s.138 NI Act — presentation / notice / filing windows. Deterministic. No LLM.

Windows:
  - Presentation: cheque presented within its validity (3 months from the date
    on the cheque).
  - Notice: within 30 days of RECEIPT of the bank's dishonour memo.   [HARD STOP]
    notice_date > memo_received + 30 -> refuse.
  - Demand in the notice must equal the cheque amount.                [HARD STOP]
  - Drawer has 15 days from receipt of notice to pay (proviso (c)).
  - Cause of action arises on the 16th day — the day after the 15-day period
    expires (Saketh India Ltd v. India Securities Ltd).
  - Complaint: within ONE CALENDAR MONTH of the cause of action (s.142(b)). Month
    arithmetic, not 30 days — February diverges.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from ._result import Assessment
from ..verify.refusals import Refusal, Severity

# Statutory constants.
_PRESENTATION_VALIDITY_MONTHS = 3   # cheque currency
_NOTICE_WINDOW_DAYS = 30            # from memo receipt
_PAY_PERIOD_DAYS = 15              # drawer's time to pay from notice receipt


@dataclass(frozen=True)
class PresentationResult:
    valid: bool
    last_valid_date: date


def check_presentation(*, cheque_date: date, presented_date: date) -> PresentationResult:
    """Cheque must be presented within its currency (3 months from cheque date)."""
    last_valid = cheque_date + relativedelta(months=_PRESENTATION_VALIDITY_MONTHS)
    return PresentationResult(
        valid=presented_date <= last_valid,
        last_valid_date=last_valid,
    )


def check_notice(
    *,
    memo_received: date,
    notice_date: date,
    cheque_amount: int,
    demand_amount: int,
) -> Assessment:
    """Hard stops on the statutory notice: demand amount and 30-day window.

    Both defects refuse. Demand-amount is checked first; either defect alone is
    sufficient to refuse.
    """
    deadline = memo_received + timedelta(days=_NOTICE_WINDOW_DAYS)
    computation = (
        f"memo received {memo_received}; notice window {_NOTICE_WINDOW_DAYS} days "
        f"-> deadline {deadline}; notice dated {notice_date}. "
        f"cheque amount {cheque_amount}; demand {demand_amount}."
    )

    if demand_amount != cheque_amount:
        reason = (
            f"Demand amount ({demand_amount}) does not equal the cheque amount "
            f"({cheque_amount}). The statutory notice must demand the cheque "
            f"amount."
        )
        return Assessment.refuse(
            reason=reason,
            computation=computation,
            refusal=Refusal(
                code="s138_notice_demand_not_equal_cheque_amount",
                severity=Severity.HARD, reason=reason, computation=computation,
                pipeline="s138_notice", spec="2.2",
                fields=("demand_amount", "cheque_amount"),
            ),
        )

    if notice_date > deadline:
        reason = (
            f"Statutory notice issued out of time: {notice_date} is beyond the "
            f"{_NOTICE_WINDOW_DAYS}-day window from memo receipt "
            f"({memo_received}), which closed on {deadline}."
        )
        return Assessment.refuse(
            reason=reason,
            computation=computation,
            refusal=Refusal(
                code="s138_notice_out_of_30_day_window",
                severity=Severity.HARD, reason=reason, computation=computation,
                pipeline="s138_notice", spec="2.2",
                fields=("notice_date", "memo_received_date"),
            ),
        )

    return Assessment.allow(computation=computation)


def cause_of_action_date(*, notice_received: date) -> date:
    """Cause of action arises on the 16th day: the day after the 15-day pay
    period (which itself runs from the day after notice receipt).

    Notice received day D. Pay period is the 15 days D+1 .. D+15. It expires at
    the end of D+15; the cause of action arises on D+16 (Saketh India Ltd).
    """
    return notice_received + timedelta(days=_PAY_PERIOD_DAYS + 1)


@dataclass(frozen=True)
class ComplaintWindow:
    cause_of_action: date
    filing_deadline: date


def complaint_window(*, notice_received: date) -> ComplaintWindow:
    """The s.142(b) filing window: one CALENDAR MONTH from the cause of action.

    relativedelta(months=1) gives calendar-month arithmetic and clamps a
    non-existent target day to the month end (e.g. 31 Jan + 1 month -> 29/28 Feb),
    which is why this diverges from a naive +30 days.
    """
    coa = cause_of_action_date(notice_received=notice_received)
    deadline = coa + relativedelta(months=1)
    return ComplaintWindow(cause_of_action=coa, filing_deadline=deadline)


def complaint_in_time(window: ComplaintWindow, *, filing_date: date) -> bool:
    """In time iff the complaint is filed on/after the cause of action and on/
    before the one-month deadline. Filing before the cause of action is premature."""
    return window.cause_of_action <= filing_date <= window.filing_deadline
