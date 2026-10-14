"""Tests for src.pipelines.default_bail — default bail application (spec 3.4).

Purely computational. The pipeline delegates the period to
custody_computation.default_bail_period and the sequence/readiness verdict to
assess_default_bail (both already boundary-tested). These tests assert the
pipeline wires them correctly, recomputes custody at generation time, and refuses
with the right DISTINCT reason on extinguished vs indeterminate.
"""

from datetime import date, datetime

import pytest

from src.pipelines import default_bail as db
from src.rules import custody_computation as cc


def _base(**over):
    kw = dict(
        accused_name="Murugan", age=34, occupation="driver",
        address="5 East St, Chennai",
        fir_no="123/2024", police_station="E4 Abiramapuram", district="Chennai",
        sections=["BNS s.318"],
        offence_date=date(2024, 8, 1),
        proceeding_start_date=date(2024, 8, 5),
        is_fresh_action=False,
        first_remand_date=date(2024, 1, 2),
        offence=cc.Offence(max_punishment_years=7),
        special_statute=None,
        as_on=date(2024, 3, 10),
        application_ts=datetime(2024, 3, 10, 11, 0, 0),
        chargesheet_filed_ts=None,
        readiness_to_furnish_bail=True,
        place="Chennai",
    )
    kw.update(over)
    return kw


class TestCodeFrameworkFromRouter:
    """The framework comes from the dual-code router (three inputs), not the
    caller. A wrong section is a wrong section in a filed document, so the router
    refuses on unknown provenance and the pipeline propagates that refusal."""

    def test_router_unknown_provenance_refused(self):
        """Pending (non-fresh) proceeding with unknown start date -> router
        refuses -> document refuses, no guessing."""
        result = db.build(**_base(proceeding_start_date=None, is_fresh_action=False))
        assert result.refused is True
        assert result.context is None

    def test_missing_offence_date_refused(self):
        result = db.build(**_base(offence_date=None))
        assert result.refused is True

    def test_new_offence_pending_cites_bnss(self):
        result = db.build(**_base(offence_date=date(2024, 8, 1),
                                  proceeding_start_date=date(2024, 8, 5),
                                  is_fresh_action=False))
        assert result.refused is False
        assert "187" in result.context["default_bail_section"]
        assert result.context["code_framework"] == "bnss"

    def test_pre_appointed_pending_cites_crpc(self):
        """A pre-July-2024 FIR in a pending proceeding must cite CrPC 167(2),
        not BNSS 187(3)."""
        result = db.build(**_base(offence_date=date(2023, 1, 1),
                                  proceeding_start_date=date(2023, 3, 1),
                                  is_fresh_action=False))
        assert result.refused is False
        assert "167" in result.context["default_bail_section"]
        assert "187" not in result.context["default_bail_section"]

    def test_fresh_action_on_old_fir_cites_bnss(self):
        """Fresh default-bail move on an old-offence matter -> BNSS procedurally."""
        result = db.build(**_base(offence_date=date(2023, 1, 1),
                                  proceeding_start_date=None,
                                  is_fresh_action=True))
        assert result.refused is False
        assert "187" in result.context["default_bail_section"]


class TestPeriodAndCustody:
    def test_general_offence_period_60(self):
        result = db.build(**_base())
        assert result.refused is False
        assert result.context["period_days"] == 60
        assert result.context["period_statute"] == "CrPC s.167(2)"

    def test_custody_recomputed_from_as_on(self):
        """Custody days come from custody_computation at generation time — moving
        as_on moves the number, proving it is never stale."""
        r1 = db.build(**_base(as_on=date(2024, 3, 10)))
        r2 = db.build(**_base(as_on=date(2024, 3, 20)))
        assert r2.context["custody_days"] == r1.context["custody_days"] + 10

    def test_ndps_period_180(self):
        result = db.build(**_base(
            offence=cc.Offence(max_punishment_years=10),
            special_statute=cc.SpecialStatute.NDPS,
        ))
        assert result.context["period_days"] == 180
        assert "NDPS" in result.context["period_statute"]

    def test_accrual_date_from_first_remand(self):
        result = db.build(**_base())
        # 60 days from first remand 2024-01-02 -> 2024-03-02.
        assert result.context["accrual_date"] == date(2024, 3, 2)


class TestSequenceRefusals:
    def test_extinguished_refused_with_code(self):
        result = db.build(**_base(
            application_ts=datetime(2024, 3, 10, 15, 0, 0),
            chargesheet_filed_ts=datetime(2024, 3, 10, 10, 0, 0),
        ))
        assert result.refused is True
        assert result.context is None
        assert result.reason_code == cc.DefaultBailCode.EXTINGUISHED
        assert result.computation is not None

    def test_indeterminate_refused_with_distinct_code(self):
        result = db.build(**_base(
            application_ts=datetime(2024, 3, 10, 10, 0, 0),
            chargesheet_filed_ts=datetime(2024, 3, 10, 10, 0, 0),
        ))
        assert result.refused is True
        assert result.reason_code == cc.DefaultBailCode.INDETERMINATE
        assert result.reason_code != cc.DefaultBailCode.EXTINGUISHED

    def test_missing_readiness_refused(self):
        result = db.build(**_base(readiness_to_furnish_bail=False))
        assert result.refused is True
        assert result.reason_code == cc.DefaultBailCode.NO_READINESS

    def test_survives_builds_context(self):
        result = db.build(**_base(
            application_ts=datetime(2024, 3, 10, 10, 0, 0),
            chargesheet_filed_ts=datetime(2024, 3, 11, 10, 0, 0),
        ))
        assert result.refused is False
        assert result.context["readiness_averred"] is True


class TestMandatoryContent:
    def test_readiness_averment_in_context(self):
        result = db.build(**_base())
        assert result.context["readiness_averred"] is True

    def test_custody_and_period_stated(self):
        result = db.build(**_base())
        assert "custody_days" in result.context
        assert "period_days" in result.context
        assert result.context["as_on"] == date(2024, 3, 10)
