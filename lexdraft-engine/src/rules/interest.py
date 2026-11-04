"""Simple interest for pleadings (pre-suit interest, decree interest, mesne
profits at a monthly rate). Deterministic. No LLM.

  simple(principal, rate_pct, start, end)  -> Interest(amount, days, text)

Days are counted from `start` to `end` (the first day excluded, the last
included), on a 365-day year; the result is rounded to the whole rupee (half
up). `text` is the one-line working printed in the pleading so the figure can be
checked: "Rs. 4,10,000 at 18% p.a. from 05.01.2026 to 03.11.2026 (302 days) =
Rs. 61,062".
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence, Tuple

from ..components.date_format import body_date


def rupees(n: int) -> str:
    """12345678 -> '1,23,45,678' (Indian grouping)."""
    s = str(abs(int(n)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        pairs = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        s = ",".join([head, *pairs, tail])
    return ("-" if n < 0 else "") + s


def _round(x: Decimal) -> int:
    return int(x.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _rate(rate_pct: float) -> str:
    return f"{Decimal(str(rate_pct)).normalize():f}"


@dataclass(frozen=True)
class Interest:
    amount: int
    days: int
    text: str


def simple(principal: int, rate_pct: float, start: date, end: date) -> Interest:
    """Simple interest on `principal` at `rate_pct` % per annum, start -> end."""
    days = max((end - start).days, 0)
    amount = _round(Decimal(principal) * Decimal(str(rate_pct)) * days
                    / Decimal(36500))
    return Interest(amount, days,
                    f"Rs. {rupees(principal)} at {_rate(rate_pct)}% p.a. from "
                    f"{body_date(start)} to {body_date(end)} ({days} days) = "
                    f"Rs. {rupees(amount)}")


def on_tranches(tranches: Sequence[Tuple[int, date]], rate_pct: float,
                end: date) -> Tuple[int, list]:
    """Interest on several sums each running from its own date (e.g. two
    invoices): (total, [Interest, ...])."""
    parts = [simple(a, rate_pct, d, end) for a, d in tranches]
    return sum(p.amount for p in parts), parts


def fill_claim(principal: int, interest_amount, claimed_total, rate_pct: float,
               start: date, end: date, tranches=None):
    """A money claim's missing figures, computed: (interest, total, working).

    A given interest is kept; a missing one (None, or 0 with no total and a
    rate) is simple interest at `rate_pct` from `start` (or each tranche's own
    date) to `end`. A missing total (None / 0) is principal + interest. `working`
    lists the printed one-line computations (empty when nothing was computed)."""
    working: list = []
    if interest_amount is None and claimed_total:
        interest_amount = claimed_total - principal
    if interest_amount is None or (interest_amount == 0 and not claimed_total
                                   and rate_pct):
        if tranches:
            interest_amount, parts = on_tranches(tranches, rate_pct, end)
        else:
            parts = [simple(principal, rate_pct, start, end)]
            interest_amount = parts[0].amount
        working = [p.text for p in parts]
    if not claimed_total:
        claimed_total = principal + interest_amount
    return interest_amount, claimed_total, working


_MONTHS = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")


def arrears_of_rent(monthly_rent: int, start: date, end: date,
                    months: int = None) -> Interest:
    """Rent unpaid for each calendar month from `start` to `end`, both months
    counted (January to August = 8), unless `months` is given. Interest.days
    carries the month count."""
    if months is None:
        months = max((end.year - start.year) * 12 + end.month - start.month + 1, 0)
    amount = monthly_rent * months
    span = (f" ({_MONTHS[start.month - 1]} {start.year} to "
            f"{_MONTHS[end.month - 1]} {end.year})" if end >= start else "")
    return Interest(amount, months,
                    f"Rs. {rupees(monthly_rent)} per month for {months} month"
                    f"{'s' if months != 1 else ''}{span} = Rs. {rupees(amount)}")


def damages_for_period(rate: int, per: str, start: date, end: date) -> Interest:
    """Damages for use and occupation at `rate` per 'day' or per 'month' from
    `start` to `end`; a part month is taken pro rata on a 30-day month."""
    if per == "day":
        days = max((end - start).days, 0)
        amount = rate * days
        return Interest(amount, days,
                        f"Rs. {rupees(rate)} per day from {body_date(start)} to "
                        f"{body_date(end)} ({days} days) = Rs. {rupees(amount)}")
    m = months_between(start, end)
    anchor = _add_months(start, m)
    days = max((end - anchor).days, 0)
    amount = rate * m + _round(Decimal(rate) * days / Decimal(30))
    span = f"{m} month{'s' if m != 1 else ''}" + (f" and {days} days" if days else "")
    return Interest(amount, (end - start).days,
                    f"Rs. {rupees(rate)} per month from {body_date(start)} to "
                    f"{body_date(end)} ({span}) = Rs. {rupees(amount)}")


def _add_months(d: date, m: int) -> date:
    y, mo = divmod(d.month - 1 + m, 12)
    year, month = d.year + y, mo + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def months_between(start: date, end: date) -> int:
    """Whole calendar months from `start` to `end` (a part month not counted):
    01.05.2026 -> 01.11.2026 = 6."""
    m = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        m -= 1
    return max(m, 0)
