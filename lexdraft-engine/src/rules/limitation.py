"""Limitation Act 1963 — deterministic period computation.

No LLM. All arithmetic is explicit and testable.

Implements:
  - Schedule period computation with s.12(1): the day from which the period runs
    is excluded, so filing ON the expiry date is in time.
  - s.12(2): exclusion of time requisite for the certified copy — APPEALS,
    REVISIONS and REVIEWS ONLY. Not suits.
  - s.4: period expiring on a day the court is closed -> filing on reopening is
    in time.
  - s.14: exclusion of time bona fide spent prosecuting the same matter in a
    court unable to entertain it for defect of jurisdiction or a like-nature
    cause. Narrower than 'any wrong forum'.
  - s.18: written signed acknowledgement before expiry starts a FRESH period from
    the acknowledgement date (not an extension). Multiple acknowledgements each
    restart from themselves; periods are not additive.
  - s.5: condonation AVAILABILITY reporting only. The engine never adjudicates
    'sufficient cause' — that discretion is the court's.

Order of operations in compute():
  1. base period from accrual (excluding the starting day, s.12(1))
  2. + s.12(2) copy time (appeals/revisions/reviews)
  3. + s.14 excluded intervals
  4. then s.18: if a valid acknowledgement falls within the period as computed so
     far, restart a fresh base period from it and re-apply. Iterated for multiple
     acknowledgements.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from enum import Enum
from typing import List, Optional, Set

from dateutil.relativedelta import relativedelta


class LimitationInputError(ValueError):
    """Raised when inputs are internally inconsistent or statutorily invalid."""


class ProceedingClass(Enum):
    SUIT = "suit"
    APPEAL = "appeal"
    REVISION = "revision"
    REVIEW = "review"
    APPLICATION = "application"


class Section14Defect(Enum):
    """The defect that made the prior forum unable to entertain the matter."""

    NONE = "none"                # bare wrong forum — NOT a valid s.14 ground
    JURISDICTION = "jurisdiction"
    LIKE_NATURE = "like_nature"  # 'other cause of a like nature'


# Proceeding classes to which s.12(2) copy-time exclusion applies.
_COPY_TIME_CLASSES = {
    ProceedingClass.APPEAL,
    ProceedingClass.REVISION,
    ProceedingClass.REVIEW,
}

# Proceeding classes for which s.5 condonation is available (not suits).
_S5_CLASSES = {
    ProceedingClass.APPEAL,
    ProceedingClass.REVISION,
    ProceedingClass.REVIEW,
    ProceedingClass.APPLICATION,
}


@dataclass(frozen=True)
class Acknowledgement:
    """s.18 acknowledgement of liability."""

    date: date
    in_writing: bool
    signed: bool

    @property
    def is_valid(self) -> bool:
        return self.in_writing and self.signed


@dataclass(frozen=True)
class ExcludedInterval:
    """A span excluded under s.14 (or a like provision).

    A valid s.14 interval requires BOTH good faith AND a like-nature defect
    (jurisdiction or a cause of a like nature). A bare wrong-forum fact does not
    qualify.
    """

    start: date
    end: date
    ground: str = "s.14"
    good_faith: bool = False
    defect: Section14Defect = Section14Defect.NONE

    @property
    def days(self) -> int:
        if self.end < self.start:
            raise LimitationInputError("excluded interval end precedes start")
        return (self.end - self.start).days

    def validate(self) -> None:
        if self.ground == "s.14":
            if not self.good_faith:
                raise LimitationInputError(
                    "s.14 exclusion requires prosecution in good faith"
                )
            if self.defect is Section14Defect.NONE:
                raise LimitationInputError(
                    "s.14 exclusion requires a defect of jurisdiction or other "
                    "cause of a like nature — a bare wrong forum does not qualify"
                )


@dataclass(frozen=True)
class CondonationReport:
    """s.5 availability — reporting only, never an adjudication."""

    delay_days: int
    s5_available: bool
    condoned: Optional[bool] = None  # always None: the court decides, not us


@dataclass(frozen=True)
class LimitationResult:
    accrual_date: date
    expiry_date: date
    proceeding_class: ProceedingClass
    acknowledgement_applied: bool
    computation: str

    # --- queries ---

    def _last_date(
        self,
        court_closed_dates: Optional[Set[date]],
        reopening_date: Optional[date],
    ) -> date:
        return effective_last_date(self, court_closed_dates, reopening_date)


def _add_period(
    start: date,
    period_years: Optional[int],
    period_months: Optional[int],
    period_days: Optional[int],
) -> date:
    """Add the Schedule period to `start`, which is the accrual date.

    s.12(1) excludes the accrual day itself. We model that by treating the
    expiry as accrual + period measured from the accrual date directly:
      - years/months use calendar arithmetic (relativedelta, clamps month-end).
      - days: n days from an accrual excluding the start day means accrual + n.
    """
    provided = [p for p in (period_years, period_months, period_days) if p is not None]
    if len(provided) != 1:
        raise LimitationInputError(
            "exactly one of period_years / period_months / period_days is required"
        )
    if period_years is not None:
        return start + relativedelta(years=period_years)
    if period_months is not None:
        return start + relativedelta(months=period_months)
    return start + timedelta(days=period_days)


def compute(
    *,
    accrual_date: date,
    period_years: Optional[int] = None,
    period_months: Optional[int] = None,
    period_days: Optional[int] = None,
    proceeding_class: ProceedingClass = ProceedingClass.SUIT,
    copy_applied: Optional[date] = None,
    copy_ready: Optional[date] = None,
    excluded_intervals: Optional[List[ExcludedInterval]] = None,
    acknowledgements: Optional[List[Acknowledgement]] = None,
) -> LimitationResult:
    """Compute the limitation expiry date with all applicable exclusions."""
    steps: List[str] = []

    # --- s.12(2) copy-time validation up front ---
    copy_days = 0
    if copy_applied is not None or copy_ready is not None:
        if copy_applied is None or copy_ready is None:
            raise LimitationInputError(
                "s.12(2) copy exclusion requires both copy_applied and copy_ready"
            )
        if proceeding_class not in _COPY_TIME_CLASSES:
            raise LimitationInputError(
                "s.12(2) copy time applies only to appeals, revisions and reviews "
                f"— not to {proceeding_class.value}"
            )
        if copy_ready < copy_applied:
            raise LimitationInputError("copy_ready precedes copy_applied")
        copy_days = (copy_ready - copy_applied).days
        steps.append(
            f"s.12(2): copy applied {copy_applied}, ready {copy_ready} "
            f"-> {copy_days} days excluded"
        )

    # --- s.14 excluded intervals validation ---
    intervals = excluded_intervals or []
    for iv in intervals:
        iv.validate()
    s14_days = sum(iv.days for iv in intervals)
    if s14_days:
        steps.append(f"s.14: {s14_days} days excluded across {len(intervals)} interval(s)")

    # --- base period (s.12(1): starting day excluded) ---
    base_expiry = _add_period(accrual_date, period_years, period_months, period_days)
    steps.append(
        f"base period from {accrual_date} (starting day excluded, s.12(1)) "
        f"-> {base_expiry}"
    )

    # exclusions push the expiry out by the excluded number of days
    expiry = base_expiry + timedelta(days=copy_days + s14_days)

    # --- s.18 acknowledgements: fresh period from each valid ack that falls
    #     within the period running at its own time. Applied in date order.
    ack_applied = False
    acks = sorted(
        (a for a in (acknowledgements or []) if a.is_valid),
        key=lambda a: a.date,
    )
    for ack in acks:
        # Valid only if made on or before the current expiry (i.e. before the
        # running period lapses). s.18 cannot revive a barred claim.
        if ack.date <= expiry:
            fresh = _add_period(ack.date, period_years, period_months, period_days)
            steps.append(
                f"s.18: valid acknowledgement {ack.date} within running period "
                f"-> fresh period to {fresh}"
            )
            expiry = fresh
            ack_applied = True
        else:
            steps.append(
                f"s.18: acknowledgement {ack.date} after expiry {expiry} — ignored"
            )

    return LimitationResult(
        accrual_date=accrual_date,
        expiry_date=expiry,
        proceeding_class=proceeding_class,
        acknowledgement_applied=ack_applied,
        computation="; ".join(steps),
    )


def effective_last_date(
    result: LimitationResult,
    court_closed_dates: Optional[Set[date]] = None,
    reopening_date: Optional[date] = None,
) -> date:
    """s.4: if the period expires on a day the court is closed, the effective
    last day is the day the court reopens."""
    closed = court_closed_dates or set()
    if result.expiry_date in closed:
        if reopening_date is None:
            raise LimitationInputError(
                "expiry falls on a closed day but no reopening_date supplied"
            )
        return reopening_date
    return result.expiry_date


def is_within_time(
    result: LimitationResult,
    filing_date: date,
    court_closed_dates: Optional[Set[date]] = None,
    reopening_date: Optional[date] = None,
) -> bool:
    """Filing on or before the effective last date is in time (inclusive)."""
    last = effective_last_date(result, court_closed_dates, reopening_date)
    return filing_date <= last


def days_of_delay(result: LimitationResult, filing_date: date) -> int:
    """Days by which filing overshoots the expiry (0 if in time)."""
    if filing_date <= result.expiry_date:
        return 0
    return (filing_date - result.expiry_date).days


def condonation_report(result: LimitationResult, filing_date: date) -> CondonationReport:
    """s.5 AVAILABILITY only. Reports the delay and whether s.5 relief is a
    category open to this proceeding class. Never decides 'sufficient cause'."""
    delay = days_of_delay(result, filing_date)
    available = delay > 0 and result.proceeding_class in _S5_CLASSES
    return CondonationReport(delay_days=delay, s5_available=available, condoned=None)
