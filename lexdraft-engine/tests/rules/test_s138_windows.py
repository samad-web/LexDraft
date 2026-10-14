"""Tests for src.rules.s138_windows — s.138 NI Act presentation/notice/filing.

Windows (from the bare Act + CLAUDE.md hard-stop table):
  - Presentation: cheque presented within its validity (3 months / date on it).
  - Notice: within 30 days of receipt of the bank's dishonour memo.        [HARD STOP]
  - Demand in the notice must equal the cheque amount.                      [HARD STOP]
  - Drawer has 15 days from receipt of notice to pay.
  - Cause of action arises on the 16th day (day after the 15-day period).
  - Complaint: within 1 month of the cause of action (s.142(b)).

Hard stops are asserted as REFUSALS, not warnings. Boundary dates (day before /
of / after) are tested for the notice window and the presentation validity.
"""

from datetime import date

import pytest

from src.rules import s138_windows as s138


# --------------------------------------------------------------------------
# Presentation validity: cheque must be presented within its currency.
# --------------------------------------------------------------------------

class TestPresentationWindow:
    def test_presented_within_validity(self):
        result = s138.check_presentation(
            cheque_date=date(2024, 1, 1), presented_date=date(2024, 3, 15)
        )
        assert result.valid is True

    def test_presented_on_last_valid_day(self):
        """Boundary (day of): cheque dated 2024-01-01 is valid up to 2024-04-01
        (3 months). Presentation that day is in time."""
        result = s138.check_presentation(
            cheque_date=date(2024, 1, 1), presented_date=date(2024, 4, 1)
        )
        assert result.valid is True

    def test_presented_day_after_validity_stale(self):
        """Boundary (day after): 2024-04-02 is stale."""
        result = s138.check_presentation(
            cheque_date=date(2024, 1, 1), presented_date=date(2024, 4, 2)
        )
        assert result.valid is False


# --------------------------------------------------------------------------
# HARD STOP: demand amount must equal cheque amount.
# --------------------------------------------------------------------------

class TestDemandAmountHardStop:
    def test_matching_demand_ok(self):
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 1, 10),
            cheque_amount=100000,
            demand_amount=100000,
        )
        assert result.refused is False

    def test_demand_mismatch_refused(self):
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 1, 10),
            cheque_amount=100000,
            demand_amount=95000,
        )
        assert result.refused is True
        assert result.may_generate is False
        assert "amount" in result.reason.lower()

    def test_demand_exceeds_cheque_refused(self):
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 1, 10),
            cheque_amount=100000,
            demand_amount=100001,
        )
        assert result.refused is True


# --------------------------------------------------------------------------
# HARD STOP: notice must issue within 30 days of memo receipt.
# notice_date > memo_received + 30 days  ->  REFUSE.
# --------------------------------------------------------------------------

class TestNoticeWindowHardStop:
    def test_notice_day_before_deadline_ok(self):
        """Boundary (day before): memo 2024-01-01, deadline 2024-01-31.
        Notice on 2024-01-30 is in time."""
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 1, 30),
            cheque_amount=100000,
            demand_amount=100000,
        )
        assert result.refused is False

    def test_notice_on_deadline_day_ok(self):
        """Boundary (day of): 30th day (2024-01-31) is still in time."""
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 1, 31),
            cheque_amount=100000,
            demand_amount=100000,
        )
        assert result.refused is False

    def test_notice_day_after_deadline_refused(self):
        """Boundary (day after): the 31st day (2024-02-01) is out of time -> REFUSE."""
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 2, 1),
            cheque_amount=100000,
            demand_amount=100000,
        )
        assert result.refused is True
        assert result.may_generate is False
        assert result.computation is not None
        assert "30" in result.reason

    def test_both_defects_still_refuses(self):
        result = s138.check_notice(
            memo_received=date(2024, 1, 1),
            notice_date=date(2024, 2, 5),
            cheque_amount=100000,
            demand_amount=90000,
        )
        assert result.refused is True


# --------------------------------------------------------------------------
# Cause of action + complaint filing window (s.142(b)): within ONE CALENDAR
# MONTH, not 30 days. Month arithmetic — February diverges from a 30-day count.
# 15 days to pay from receipt of notice; cause of action on day 16
# (Saketh India Ltd v. India Securities).
# --------------------------------------------------------------------------

class TestComplaintFilingWindow:
    def test_cause_of_action_is_sixteenth_day(self):
        """Notice received 2024-01-10; 15-day pay period ends 2024-01-25;
        cause of action arises 2024-01-26."""
        coa = s138.cause_of_action_date(notice_received=date(2024, 1, 10))
        assert coa == date(2024, 1, 26)

    def test_complaint_filing_deadline_one_calendar_month(self):
        window = s138.complaint_window(notice_received=date(2024, 1, 10))
        assert window.cause_of_action == date(2024, 1, 26)
        # ONE CALENDAR MONTH from 2024-01-26 -> 2024-02-26 (not +30 days = 02-25).
        assert window.filing_deadline == date(2024, 2, 26)

    def test_month_arithmetic_diverges_from_thirty_days_in_february(self):
        """Cause of action 2024-01-31. One calendar month -> 2024-02-29 (2024 is
        a leap year), which clamps to month end. A naive +30 days would give
        2024-03-01 — a different, wrong answer. This case pins month arithmetic."""
        # Notice received 2024-01-15 -> pay period ends 01-30 -> CoA 01-31.
        window = s138.complaint_window(notice_received=date(2024, 1, 15))
        assert window.cause_of_action == date(2024, 1, 31)
        assert window.filing_deadline == date(2024, 2, 29)

    def test_complaint_on_deadline_in_time(self):
        window = s138.complaint_window(notice_received=date(2024, 1, 10))
        assert s138.complaint_in_time(window, filing_date=date(2024, 2, 26)) is True

    def test_complaint_day_after_deadline_barred(self):
        window = s138.complaint_window(notice_received=date(2024, 1, 10))
        assert s138.complaint_in_time(window, filing_date=date(2024, 2, 27)) is False

    def test_complaint_before_cause_of_action_premature(self):
        """A complaint filed before the cause of action arises is premature."""
        window = s138.complaint_window(notice_received=date(2024, 1, 10))
        assert s138.complaint_in_time(window, filing_date=date(2024, 1, 20)) is False
