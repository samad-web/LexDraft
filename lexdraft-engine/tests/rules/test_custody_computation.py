"""Tests for src.rules.custody_computation — bail custody math + hard stops.

TWO DISTINCT COMPUTATIONS (do not merge — merging produces a wrong default-bail
answer):

  days_in_custody()      inclusive day count. Narrative use only. Recomputed at
                         generation time, so it takes an explicit `as_on` date.

  default_bail_period()  the statutory period under s.167(2) CrPC / s.187 BNSS
                         (or a special statute), running from FIRST REMAND, not
                         arrest (Chaganti Satyanarayana v. State of AP). Returns
                         the applicable period and the accrual date.

DEFAULT-BAIL RIGHT is a SEQUENCE test, not a date test (Uday Mohanlal Acharya;
M. Ravindran v. Intelligence Officer, DRI): the right accrues on expiry of the
period and is AVAILED by filing the application. A chargesheet filed AFTER the
application — even later the same day, even before the court rules — does not
defeat it. Application-before-chargesheet survives; chargesheet-before-
application extinguishes. Same-day turns on which came first IN TIME, so the
assessment takes timestamps, not dates, and exposes which preceded the other.

Availing the right also requires the express averment of readiness to furnish
bail — surfaced here as a precondition, not merely a template field.

Hard stops from CLAUDE.md are asserted as REFUSALS (not warnings). Boundary
dates/timestamps (day/instant before, of, after) are tested throughout.
"""

from datetime import date, datetime

import pytest

from src.rules import custody_computation as cc


# --------------------------------------------------------------------------
# days_in_custody: inclusive arithmetic, narrative use only.
# --------------------------------------------------------------------------

class TestCustodyDays:
    def test_same_day_is_one_day(self):
        assert cc.days_in_custody(
            custody_start=date(2024, 1, 1), as_on=date(2024, 1, 1)
        ) == 1

    def test_day_after_is_two_days(self):
        assert cc.days_in_custody(
            custody_start=date(2024, 1, 1), as_on=date(2024, 1, 2)
        ) == 2

    def test_ninety_days(self):
        assert cc.days_in_custody(
            custody_start=date(2024, 1, 1), as_on=date(2024, 3, 30)
        ) == 90

    def test_as_on_before_custody_start_raises(self):
        with pytest.raises(cc.CustodyInputError):
            cc.days_in_custody(custody_start=date(2024, 1, 2), as_on=date(2024, 1, 1))

    def test_recompute_changes_with_as_on(self):
        """Proves the count is recomputed, not stored."""
        start = date(2024, 1, 1)
        assert cc.days_in_custody(start, as_on=date(2024, 1, 10)) == 10
        assert cc.days_in_custody(start, as_on=date(2024, 1, 20)) == 20


# --------------------------------------------------------------------------
# default_bail_period: statutory period from FIRST REMAND.
# Nothing downstream may compare a count to a hardcoded 60/90 — the period
# comes from here, keyed on offence + statute.
# --------------------------------------------------------------------------

class TestDefaultBailPeriod:
    def test_general_serious_offence_is_90(self):
        """Death / life / imprisonment not less than 10 years -> 90 days."""
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=10, punishable_with_death=False,
                               punishable_with_life=False),
        )
        assert p.period_days == 90
        assert p.statute == "CrPC s.167(2)"

    def test_life_offence_is_90(self):
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=None, punishable_with_life=True),
        )
        assert p.period_days == 90

    def test_ten_year_boundary_is_90_not_60(self):
        """'not less than ten years' — exactly 10 falls in the 90-day bucket."""
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=10),
        )
        assert p.period_days == 90

    def test_below_ten_years_is_60(self):
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=7),
        )
        assert p.period_days == 60
        assert p.statute == "CrPC s.167(2)"

    def test_accrual_runs_from_first_remand_not_arrest(self):
        """Chaganti Satyanarayana: the period runs from first remand.
        Remand 2024-01-02; 60-day period accrues (expires) on 2024-03-02."""
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 2),
            offence=cc.Offence(max_punishment_years=7),
        )
        assert p.accrual_date == date(2024, 3, 2)

    # -- Special statutes override the general 60/90. --

    def test_ndps_is_180(self):
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=10),
            special_statute=cc.SpecialStatute.NDPS,
        )
        assert p.period_days == 180
        assert "NDPS" in p.statute
        assert p.extension_procedure == "s.36A(4)"

    def test_pmla_is_60(self):
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=7),
            special_statute=cc.SpecialStatute.PMLA,
        )
        assert p.period_days == 60
        assert "PMLA" in p.statute

    def test_uapa_base_is_90_extensible(self):
        """UAPA: 90 days, extensible to 180 (90+90) on a reasoned report."""
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=10),
            special_statute=cc.SpecialStatute.UAPA,
        )
        assert p.period_days == 90
        assert p.extendable_to == 180
        assert "reasoned report" in p.extension_procedure.lower()

    def test_special_statute_not_compared_to_hardcoded_90(self):
        """Regression guard: an NDPS count of 100 days is NOT past the period."""
        p = cc.default_bail_period(
            first_remand_date=date(2024, 1, 1),
            offence=cc.Offence(max_punishment_years=10),
            special_statute=cc.SpecialStatute.NDPS,
        )
        # 100 days elapsed < 180-day NDPS period -> right has NOT accrued.
        assert p.period_days == 180


# --------------------------------------------------------------------------
# HARD STOP: default bail — SEQUENCE test on timestamps, not dates.
# --------------------------------------------------------------------------

class TestDefaultBailSequence:
    def _readiness(self):
        return True  # express averment of readiness to furnish bail present

    def test_application_before_chargesheet_survives(self):
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 10, 0, 0),
            chargesheet_filed_ts=datetime(2024, 4, 1, 15, 0, 0),
            readiness_to_furnish_bail=self._readiness(),
        )
        assert result.refused is False
        assert result.may_generate is True
        assert result.application_preceded_chargesheet is True

    def test_chargesheet_before_application_extinguishes(self):
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 15, 0, 0),
            chargesheet_filed_ts=datetime(2024, 4, 1, 10, 0, 0),
            readiness_to_furnish_bail=self._readiness(),
        )
        assert result.refused is True
        assert result.may_generate is False
        assert result.application_preceded_chargesheet is False
        assert result.reason_code == cc.DefaultBailCode.EXTINGUISHED
        assert "extinguished" in result.reason.lower()
        assert result.computation is not None

    def test_same_instant_tie_is_indeterminate_not_extinguished(self):
        """Identical timestamps: which came first cannot be determined. The spec
        requires a DISTINCT reason code (indeterminate), not extinguished — the
        pleading and the advocate's follow-up differ between the two."""
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 10, 0, 0),
            chargesheet_filed_ts=datetime(2024, 4, 1, 10, 0, 0),
            readiness_to_furnish_bail=self._readiness(),
        )
        assert result.refused is True
        assert result.reason_code == cc.DefaultBailCode.INDETERMINATE
        assert result.reason_code != cc.DefaultBailCode.EXTINGUISHED
        assert "indeterminate" in result.reason.lower()

    def test_missing_application_timestamp_is_indeterminate(self):
        """Missing application timestamp -> precedence cannot be established ->
        indeterminate (distinct from extinguished)."""
        result = cc.assess_default_bail(
            application_ts=None,
            chargesheet_filed_ts=datetime(2024, 4, 1, 10, 0, 0),
            readiness_to_furnish_bail=self._readiness(),
        )
        assert result.refused is True
        assert result.reason_code == cc.DefaultBailCode.INDETERMINATE

    def test_survives_has_no_refusal_code(self):
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 10, 0, 0),
            chargesheet_filed_ts=datetime(2024, 4, 1, 15, 0, 0),
            readiness_to_furnish_bail=self._readiness(),
        )
        assert result.refused is False
        assert result.reason_code == cc.DefaultBailCode.SURVIVES

    def test_chargesheet_not_yet_filed_survives(self):
        """No chargesheet on record yet is NOT indeterminate — the application is
        made before any final report, so the right survives."""
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 10, 0, 0),
            chargesheet_filed_ts=None,
            readiness_to_furnish_bail=self._readiness(),
        )
        assert result.refused is False
        assert result.reason_code == cc.DefaultBailCode.SURVIVES
        assert result.application_preceded_chargesheet is True

    def test_sequence_field_is_exposed_for_pleading(self):
        """The precedence gets pleaded in the application, so it must be an
        explicit field on the result — not merely implied by `refused`."""
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 9, 0, 0),
            chargesheet_filed_ts=datetime(2024, 4, 2, 9, 0, 0),
            readiness_to_furnish_bail=self._readiness(),
        )
        assert hasattr(result, "application_preceded_chargesheet")
        assert result.application_ts == datetime(2024, 4, 1, 9, 0, 0)
        assert result.chargesheet_filed_ts == datetime(2024, 4, 2, 9, 0, 0)

    # -- readiness-to-furnish-bail precondition --

    def test_missing_readiness_blocks_even_if_sequence_ok(self):
        """Availing the right requires the express averment of readiness to
        furnish bail. Absent it, the application is not made out."""
        result = cc.assess_default_bail(
            application_ts=datetime(2024, 4, 1, 10, 0, 0),
            chargesheet_filed_ts=None,
            readiness_to_furnish_bail=False,
        )
        assert result.refused is True
        assert result.may_generate is False
        assert result.reason_code == cc.DefaultBailCode.NO_READINESS
        assert "readiness" in result.reason.lower()


# --------------------------------------------------------------------------
# SC/ST Act s.18 / 18A — anticipatory bail bar (for the 3.3 pipeline).
# --------------------------------------------------------------------------

class TestScStAnticipatoryBar:
    def test_scst_offence_bars_anticipatory_bail(self):
        a = cc.assess_anticipatory_bail(already_arrested=False, is_scst_offence=True)
        assert a.refused is True
        assert a.may_generate is False
        assert "18" in a.reason  # s.18 / 18A explanation
        assert a.route_to is None  # not a routing case; it's a bar

    def test_non_scst_offence_not_barred(self):
        a = cc.assess_anticipatory_bail(already_arrested=False, is_scst_offence=False)
        assert a.refused is False

    def test_already_arrested_takes_precedence_routes_to_regular(self):
        """If already arrested, route to regular bail regardless of SC/ST — the
        anticipatory remedy is moot once arrested."""
        a = cc.assess_anticipatory_bail(already_arrested=True, is_scst_offence=True)
        assert a.refused is True
        assert a.route_to == "regular_bail"


# --------------------------------------------------------------------------
# HARD STOP: anticipatory bail when the applicant is already arrested.
# --------------------------------------------------------------------------

class TestAnticipatoryBailHardStop:
    def test_not_arrested_allowed(self):
        result = cc.assess_anticipatory_bail(already_arrested=False)
        assert result.refused is False
        assert result.may_generate is True

    def test_already_arrested_refused_and_routed(self):
        result = cc.assess_anticipatory_bail(already_arrested=True)
        assert result.refused is True
        assert result.may_generate is False
        assert result.route_to == "regular_bail"
