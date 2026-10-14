"""Tests for src.rules.limitation — Limitation Act 1963.

Covers: Schedule period computation, s.12 (exclusion of the starting day and
copy time), s.4 (court-closed reopening), s.5 (condonation *availability*, not
adjudication), s.14 (exclusion of bona fide proceedings), s.18 (fresh period on
acknowledgement).

Boundary dates are tested explicitly: day before expiry, day of, day after.

The module is deterministic. It never decides "sufficient cause" under s.5 — it
reports the computed delay and whether s.5 is *available* for the proceeding
class. Discretion belongs to the court, not the engine.
"""

from datetime import date

import pytest

from src.rules import limitation as lim


# --------------------------------------------------------------------------
# Core period computation + s.12(1): the day the cause arises is excluded.
# --------------------------------------------------------------------------

class TestPeriodComputation:
    def test_expiry_excludes_starting_day_s12_1(self):
        """s.12(1): the day *from which* the period runs is excluded.

        A 3-year period from an accrual on 2020-01-01 expires on 2023-01-01,
        not 2022-12-31 — because 2020-01-01 itself is not counted.
        """
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
        )
        assert result.expiry_date == date(2023, 1, 1)

    def test_period_in_days(self):
        result = lim.compute(accrual_date=date(2023, 1, 1), period_days=30)
        # 2023-01-01 excluded; 30 clear days -> expiry 2023-01-31.
        assert result.expiry_date == date(2023, 1, 31)

    def test_period_in_months(self):
        result = lim.compute(accrual_date=date(2023, 1, 15), period_months=3)
        assert result.expiry_date == date(2023, 4, 15)

    def test_leap_year_month_end_clamps(self):
        """A month/year add that lands on a non-existent day clamps to month end."""
        result = lim.compute(accrual_date=date(2020, 2, 29), period_years=1)
        assert result.expiry_date == date(2021, 2, 28)


# --------------------------------------------------------------------------
# Boundary: is a filing on a given date within time? (day before / of / after)
# --------------------------------------------------------------------------

class TestFilingBoundary:
    @pytest.fixture
    def three_year(self):
        # Expiry computes to 2023-01-01.
        return lim.compute(accrual_date=date(2020, 1, 1), period_years=3)

    def test_day_before_expiry_in_time(self, three_year):
        assert lim.is_within_time(three_year, filing_date=date(2022, 12, 31)) is True

    def test_day_of_expiry_in_time(self, three_year):
        """Filing ON the expiry date is in time — the period includes its last day."""
        assert lim.is_within_time(three_year, filing_date=date(2023, 1, 1)) is True

    def test_day_after_expiry_barred(self, three_year):
        assert lim.is_within_time(three_year, filing_date=date(2023, 1, 2)) is False

    def test_days_of_delay_after_expiry(self, three_year):
        assert lim.days_of_delay(three_year, filing_date=date(2023, 1, 6)) == 5

    def test_days_of_delay_zero_when_in_time(self, three_year):
        assert lim.days_of_delay(three_year, filing_date=date(2022, 12, 31)) == 0


# --------------------------------------------------------------------------
# s.12(2): exclusion of copy-obtaining time — APPEALS, REVISIONS, REVIEWS ONLY.
# It does NOT apply to suits. A plaint must not be handed time it isn't due.
# --------------------------------------------------------------------------

class TestSection12CopyTime:
    def test_copy_time_extends_expiry_for_appeal(self):
        """s.12(2): time requisite for obtaining the certified copy is excluded.

        90-day appeal from a decree dated 2023-01-01. Copy applied 2023-01-10,
        ready 2023-01-25 -> 15 clear days excluded. Base expiry 2023-04-01
        moves out by 15 days to 2023-04-16.
        """
        result = lim.compute(
            accrual_date=date(2023, 1, 1),
            period_days=90,
            proceeding_class=lim.ProceedingClass.APPEAL,
            copy_applied=date(2023, 1, 10),
            copy_ready=date(2023, 1, 25),
        )
        base = lim.compute(accrual_date=date(2023, 1, 1), period_days=90,
                           proceeding_class=lim.ProceedingClass.APPEAL)
        assert (result.expiry_date - base.expiry_date).days == 15

    def test_copy_time_applies_to_revision(self):
        result = lim.compute(
            accrual_date=date(2023, 1, 1), period_days=90,
            proceeding_class=lim.ProceedingClass.REVISION,
            copy_applied=date(2023, 1, 10), copy_ready=date(2023, 1, 25),
        )
        base = lim.compute(accrual_date=date(2023, 1, 1), period_days=90,
                           proceeding_class=lim.ProceedingClass.REVISION)
        assert (result.expiry_date - base.expiry_date).days == 15

    def test_copy_time_applies_to_review(self):
        result = lim.compute(
            accrual_date=date(2023, 1, 1), period_days=90,
            proceeding_class=lim.ProceedingClass.REVIEW,
            copy_applied=date(2023, 1, 10), copy_ready=date(2023, 1, 25),
        )
        base = lim.compute(accrual_date=date(2023, 1, 1), period_days=90,
                           proceeding_class=lim.ProceedingClass.REVIEW)
        assert (result.expiry_date - base.expiry_date).days == 15

    def test_copy_time_rejected_for_suit(self):
        """A suit gets no s.12(2) copy exclusion. Supplying copy dates for a
        suit is an input error — it must not silently hand the plaint extra time."""
        with pytest.raises(lim.LimitationInputError):
            lim.compute(
                accrual_date=date(2023, 1, 1),
                period_years=3,
                proceeding_class=lim.ProceedingClass.SUIT,
                copy_applied=date(2023, 1, 10),
                copy_ready=date(2023, 1, 25),
            )

    def test_copy_time_requires_both_dates(self):
        with pytest.raises(lim.LimitationInputError):
            lim.compute(
                accrual_date=date(2023, 1, 1),
                period_days=90,
                proceeding_class=lim.ProceedingClass.APPEAL,
                copy_applied=date(2023, 1, 10),
                # copy_ready missing
            )


# --------------------------------------------------------------------------
# s.4: period expiring on a court holiday -> filing on reopening is in time.
# --------------------------------------------------------------------------

class TestSection4CourtClosed:
    def test_expiry_on_closed_day_moves_to_reopening(self):
        result = lim.compute(accrual_date=date(2020, 1, 1), period_years=3)
        # Expiry 2023-01-01 is (say) a court holiday; court reopens 2023-01-03.
        effective = lim.effective_last_date(
            result,
            court_closed_dates={date(2023, 1, 1), date(2023, 1, 2)},
            reopening_date=date(2023, 1, 3),
        )
        assert effective == date(2023, 1, 3)
        assert lim.is_within_time(result, filing_date=date(2023, 1, 3),
                                  court_closed_dates={date(2023, 1, 1), date(2023, 1, 2)},
                                  reopening_date=date(2023, 1, 3)) is True

    def test_open_day_expiry_unchanged(self):
        result = lim.compute(accrual_date=date(2020, 1, 1), period_years=3)
        effective = lim.effective_last_date(
            result,
            court_closed_dates=set(),
            reopening_date=None,
        )
        assert effective == date(2023, 1, 1)


# --------------------------------------------------------------------------
# s.18: acknowledgement of liability before expiry -> FRESH period from the
# acknowledgement date. It does NOT extend the existing period. The distinction
# matters most with multiple acknowledgements: each valid one restarts the clock
# from itself; the periods are not additive.
# --------------------------------------------------------------------------

class TestSection18Acknowledgement:
    def test_fresh_period_runs_from_acknowledgement_not_extends(self):
        """A 3-year period accruing 2020-01-01 (base expiry 2023-01-01) with an
        acknowledgement on 2022-06-01 yields a fresh 3-year period from
        2022-06-01 -> 2025-06-01. NOT base-expiry-plus-something."""
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2022, 6, 1), in_writing=True, signed=True)
            ],
        )
        assert result.expiry_date == date(2025, 6, 1)
        assert result.acknowledgement_applied is True

    def test_acknowledgement_on_expiry_day_still_valid(self):
        """Boundary: acknowledgement made ON the last day is 'before expiry'."""
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2023, 1, 1), in_writing=True, signed=True)
            ],
        )
        assert result.expiry_date == date(2026, 1, 1)

    def test_acknowledgement_after_expiry_ignored(self):
        """s.18 cannot revive an already-barred claim."""
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2023, 1, 2), in_writing=True, signed=True)
            ],
        )
        assert result.expiry_date == date(2023, 1, 1)
        assert result.acknowledgement_applied is False

    def test_multiple_acknowledgements_each_restarts_from_itself(self):
        """Two valid acknowledgements. Each must fall within the period running
        at its own time. First (2022-06-01) restarts -> fresh expiry 2025-06-01;
        the second (2024-06-01) is within THAT fresh period, so it restarts again
        -> 2027-06-01. Periods are NOT summed."""
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2022, 6, 1), in_writing=True, signed=True),
                lim.Acknowledgement(date=date(2024, 6, 1), in_writing=True, signed=True),
            ],
        )
        assert result.expiry_date == date(2027, 6, 1)

    def test_second_acknowledgement_after_first_period_lapsed_is_ignored(self):
        """If a later acknowledgement falls after the (already restarted) period
        has itself lapsed, it cannot revive it. First ack 2022-06-01 -> fresh
        expiry 2025-06-01. A second 'acknowledgement' on 2025-07-01 is too late;
        expiry stays 2025-06-01."""
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2022, 6, 1), in_writing=True, signed=True),
                lim.Acknowledgement(date=date(2025, 7, 1), in_writing=True, signed=True),
            ],
        )
        assert result.expiry_date == date(2025, 6, 1)

    def test_unsigned_acknowledgement_ignored(self):
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2022, 6, 1), in_writing=True, signed=False)
            ],
        )
        assert result.expiry_date == date(2023, 1, 1)

    def test_oral_acknowledgement_ignored(self):
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            acknowledgements=[
                lim.Acknowledgement(date=date(2022, 6, 1), in_writing=False, signed=True)
            ],
        )
        assert result.expiry_date == date(2023, 1, 1)


# --------------------------------------------------------------------------
# s.14: exclusion of time bona fide spent prosecuting the same matter in a court
# unable to entertain it "for defect of jurisdiction or other cause of a like
# nature." NOT any wrong forum. The interval must assert BOTH good faith AND a
# like-nature defect; a bare wrong-forum fact does not qualify.
# --------------------------------------------------------------------------

class TestSection14ExclusionWrongForum:
    def test_bona_fide_like_nature_defect_excluded(self):
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            excluded_intervals=[
                lim.ExcludedInterval(
                    start=date(2021, 1, 1), end=date(2021, 4, 1),  # 90 days
                    ground="s.14",
                    good_faith=True,
                    defect=lim.Section14Defect.JURISDICTION,
                )
            ],
        )
        base = lim.compute(accrual_date=date(2020, 1, 1), period_years=3)
        assert (result.expiry_date - base.expiry_date).days == 90

    def test_bare_wrong_forum_without_like_nature_defect_rejected(self):
        """A wrong-forum interval that does not assert a defect of jurisdiction or
        a like-nature cause is not a valid s.14 exclusion -> input error. The
        section is narrower than 'any wrong court'."""
        with pytest.raises(lim.LimitationInputError):
            lim.compute(
                accrual_date=date(2020, 1, 1),
                period_years=3,
                excluded_intervals=[
                    lim.ExcludedInterval(
                        start=date(2021, 1, 1), end=date(2021, 4, 1),
                        ground="s.14",
                        good_faith=True,
                        defect=lim.Section14Defect.NONE,   # merely the wrong forum
                    )
                ],
            )

    def test_absence_of_good_faith_rejected(self):
        """Good faith is a statutory precondition; without it the exclusion fails."""
        with pytest.raises(lim.LimitationInputError):
            lim.compute(
                accrual_date=date(2020, 1, 1),
                period_years=3,
                excluded_intervals=[
                    lim.ExcludedInterval(
                        start=date(2021, 1, 1), end=date(2021, 4, 1),
                        ground="s.14",
                        good_faith=False,
                        defect=lim.Section14Defect.JURISDICTION,
                    )
                ],
            )

    def test_multiple_valid_intervals_sum(self):
        result = lim.compute(
            accrual_date=date(2020, 1, 1),
            period_years=3,
            excluded_intervals=[
                lim.ExcludedInterval(start=date(2021, 1, 1), end=date(2021, 1, 11),
                                     ground="s.14", good_faith=True,
                                     defect=lim.Section14Defect.JURISDICTION),
                lim.ExcludedInterval(start=date(2021, 3, 1), end=date(2021, 3, 6),
                                     ground="s.14", good_faith=True,
                                     defect=lim.Section14Defect.LIKE_NATURE),
            ],
        )
        base = lim.compute(accrual_date=date(2020, 1, 1), period_years=3)
        assert (result.expiry_date - base.expiry_date).days == 15


# --------------------------------------------------------------------------
# s.5: condonation *availability*, never adjudication.
# --------------------------------------------------------------------------

class TestSection5Availability:
    def test_s5_available_for_appeal(self):
        result = lim.compute(accrual_date=date(2020, 1, 1), period_days=90,
                             proceeding_class=lim.ProceedingClass.APPEAL)
        report = lim.condonation_report(result, filing_date=date(2020, 5, 1))
        assert report.delay_days > 0
        assert report.s5_available is True
        # The engine must NOT decide the outcome.
        assert report.condoned is None

    def test_s5_not_available_for_suit(self):
        """s.5 does not apply to suits. A time-barred suit is barred, full stop."""
        result = lim.compute(accrual_date=date(2020, 1, 1), period_years=3,
                             proceeding_class=lim.ProceedingClass.SUIT)
        report = lim.condonation_report(result, filing_date=date(2023, 6, 1))
        assert report.s5_available is False

    def test_no_delay_no_condonation_needed(self):
        result = lim.compute(accrual_date=date(2020, 1, 1), period_years=3,
                             proceeding_class=lim.ProceedingClass.APPEAL)
        report = lim.condonation_report(result, filing_date=date(2022, 12, 31))
        assert report.delay_days == 0
        assert report.s5_available is False  # nothing to condone
