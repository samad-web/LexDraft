"""Limitation window for appeals, revisions and the s.5 condone-delay petition.

Shared by the appeal / revision / condone-delay pipelines so the arithmetic lives
in ONE place (src.rules.limitation) and every document reports the same figures.
Deterministic. No LLM.

  window(order_date, filing_date, period_days, proceeding_class, copy dates)
      -> AppealWindow(expiry, delay_days, computation)

The PERIODS themselves (Limitation Act Schedule Arts. 115 / 116 / 131) are a
VERIFY table (verify/tables/appeal_revision_periods.json): a document that
consumes them shows the unverified marker until an advocate signs them off.

s.12(2) — the time requisite for obtaining a copy of the order is excluded for
appeals and revisions; the caller passes the copy-applied and copy-ready dates
when known. Only when BOTH are given is the exclusion applied (half a pair is an
input error the pipeline turns into a coded refusal).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

from ..rules import limitation as lim
from ..verify import tables as _reg

PERIODS_TABLE = "appeal_revision_periods"


def period(key: str) -> int:
    """The period (days) for a remedy key from the VERIFY table."""
    return int(_reg.values(PERIODS_TABLE)[key])


@dataclass(frozen=True)
class AppealWindow:
    expiry: date
    delay_days: int          # 0 when filed within time
    computation: str

    @property
    def in_time(self) -> bool:
        return self.delay_days <= 0


def window(
    *,
    order_date: date,
    filing_date: date,
    period_days: int,
    proceeding_class: lim.ProceedingClass,
    copy_applied: Optional[date] = None,
    copy_ready: Optional[date] = None,
) -> AppealWindow:
    """Compute the last day and the delay (if any). Raises
    lim.LimitationInputError on inconsistent copy dates."""
    res = lim.compute(
        accrual_date=order_date, period_days=period_days,
        proceeding_class=proceeding_class,
        copy_applied=copy_applied, copy_ready=copy_ready,
    )
    delay = max(0, (filing_date - res.expiry_date).days)
    computation = (f"{res.computation}; period {period_days} days; last day "
                   f"{res.expiry_date}; filed {filing_date}; delay {delay} days")
    return AppealWindow(expiry=res.expiry_date, delay_days=delay,
                        computation=computation)
