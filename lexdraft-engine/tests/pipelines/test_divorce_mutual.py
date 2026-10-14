"""Tests for src.pipelines.divorce_mutual — mutual-consent divorce HMA s.13B (spec 6.2).

TWO SEPARATE documents sharing a fact sheet: first motion and second motion.
Built as two functions (build_first_motion / build_second_motion), NOT one with
a flag.

First motion:
  - Separation >= 1 year (hard check).
  - Settlement covers maintenance, custody and property, or expressly records
    that a head does not arise; silence on a head refuses.
  - Joint affidavit by BOTH parties.

Second motion:
  - 6 to 18 months from the first-motion order.
  - Before 6 months -> refuse UNLESS a waiver application is attached.
  - After 18 months -> refuse.
  - Waiver (Amardeep Singh): settlement must already be implemented; a waiver
    with outstanding settlement terms refuses.
"""

from datetime import date

import pytest

from src.pipelines import divorce_mutual as dm


def _settlement(**over):
    kw = dict(maintenance="Rs.10,000 per month to the wife",
              custody="with the mother", property="flat retained by the wife")
    kw.update(over)
    return dm.Settlement(**kw)


def _first(**over):
    kw = dict(
        party_a="Anita", party_b="Rakesh",
        marriage_date=date(2015, 1, 1), marriage_place="Chennai",
        living_separately_since=date(2022, 1, 1),   # ~2 years before 2024
        first_motion_date=date(2024, 1, 1),
        settlement=_settlement(),
        joint_affidavit=True,
        place="Chennai",
    )
    kw.update(over)
    return kw


def _second(**over):
    kw = dict(
        party_a="Anita", party_b="Rakesh",
        first_motion_order_date=date(2024, 1, 1),
        second_motion_date=date(2024, 9, 1),        # 8 months later
        settlement_implemented=True,
        waiver_sought=False,
        place="Chennai",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# FIRST MOTION.
# --------------------------------------------------------------------------

class TestFirstMotionSeparation:
    def test_over_one_year_builds(self):
        result = dm.build_first_motion(**_first(
            living_separately_since=date(2022, 1, 1)))
        assert result.refused is False

    def test_under_one_year_refused(self):
        result = dm.build_first_motion(**_first(
            living_separately_since=date(2024, 1, 1),
            first_motion_date=date(2024, 6, 1)))
        assert result.refused is True
        assert "one year" in result.reason.lower() or "1 year" in result.reason.lower()

    def test_exactly_one_year_boundary(self):
        result = dm.build_first_motion(**_first(
            living_separately_since=date(2023, 1, 1),
            first_motion_date=date(2024, 1, 1)))
        assert result.refused is False


class TestFirstMotionSettlement:
    def test_all_heads_covered_builds(self):
        result = dm.build_first_motion(**_first(settlement=_settlement()))
        assert result.refused is False

    def test_head_absence_expressly_recorded_ok(self):
        """A head that does not arise may be expressly recorded as such."""
        result = dm.build_first_motion(**_first(settlement=_settlement(
            custody="not applicable — no children of the marriage")))
        assert result.refused is False

    def test_silent_maintenance_refused(self):
        result = dm.build_first_motion(**_first(settlement=_settlement(maintenance="")))
        assert result.refused is True
        assert "maintenance" in result.reason.lower()

    def test_silent_custody_refused(self):
        result = dm.build_first_motion(**_first(settlement=_settlement(custody="")))
        assert result.refused is True
        assert "custody" in result.reason.lower()

    def test_silent_property_refused(self):
        result = dm.build_first_motion(**_first(settlement=_settlement(property="")))
        assert result.refused is True
        assert "property" in result.reason.lower()


class TestFirstMotionJointAffidavit:
    def test_joint_affidavit_required(self):
        result = dm.build_first_motion(**_first(joint_affidavit=False))
        assert result.refused is True
        assert "joint affidavit" in result.reason.lower()

    def test_joint_affidavit_present_builds(self):
        result = dm.build_first_motion(**_first(joint_affidavit=True))
        assert result.refused is False
        assert result.context["joint_affidavit"] is True
        # both deponents named
        assert result.context["deponents"] == ["Anita", "Rakesh"]


# --------------------------------------------------------------------------
# SECOND MOTION — window + waiver.
# --------------------------------------------------------------------------

class TestSecondMotionWindow:
    def test_within_window_builds(self):
        result = dm.build_second_motion(**_second(
            first_motion_order_date=date(2024, 1, 1),
            second_motion_date=date(2024, 9, 1)))   # 8 months
        assert result.refused is False

    def test_before_six_months_without_waiver_refused(self):
        result = dm.build_second_motion(**_second(
            first_motion_order_date=date(2024, 1, 1),
            second_motion_date=date(2024, 4, 1),     # 3 months
            waiver_sought=False))
        assert result.refused is True
        assert "six-month" in result.reason.lower() or "cooling-off" in result.reason.lower()

    def test_before_six_months_with_waiver_builds(self):
        result = dm.build_second_motion(**_second(
            first_motion_order_date=date(2024, 1, 1),
            second_motion_date=date(2024, 4, 1),
            waiver_sought=True, settlement_implemented=True))
        assert result.refused is False
        assert result.context["waiver_attached"] is True

    def test_after_eighteen_months_refused(self):
        result = dm.build_second_motion(**_second(
            first_motion_order_date=date(2024, 1, 1),
            second_motion_date=date(2025, 8, 1)))    # 19 months
        assert result.refused is True
        assert "eighteen months" in result.reason.lower() or "18 month" in result.reason.lower()

    def test_exactly_six_months_boundary(self):
        result = dm.build_second_motion(**_second(
            first_motion_order_date=date(2024, 1, 1),
            second_motion_date=date(2024, 7, 1)))    # exactly 6 months
        assert result.refused is False

    def test_exactly_eighteen_months_boundary(self):
        result = dm.build_second_motion(**_second(
            first_motion_order_date=date(2024, 1, 1),
            second_motion_date=date(2025, 7, 1)))    # exactly 18 months
        assert result.refused is False


class TestWaiver:
    def test_waiver_with_settlement_implemented_builds(self):
        result = dm.build_second_motion(**_second(
            second_motion_date=date(2024, 4, 1),
            waiver_sought=True, settlement_implemented=True))
        assert result.refused is False

    def test_waiver_with_outstanding_settlement_refused(self):
        """Amardeep Singh: a waiver requires the settlement to be already
        implemented. Outstanding terms -> refuse the waiver."""
        result = dm.build_second_motion(**_second(
            second_motion_date=date(2024, 4, 1),
            waiver_sought=True, settlement_implemented=False))
        assert result.refused is True
        assert "settlement" in result.reason.lower() or "implemented" in result.reason.lower()


# --------------------------------------------------------------------------
# Two separate documents.
# --------------------------------------------------------------------------

class TestSeparateDocuments:
    def test_two_separate_entry_points(self):
        assert callable(dm.build_first_motion)
        assert callable(dm.build_second_motion)

    def test_first_and_second_use_own_templates(self):
        assert dm.TEMPLATE_FIRST == "divorce_mutual_first.docx"
        assert dm.TEMPLATE_SECOND == "divorce_mutual_second.docx"
        assert dm.TEMPLATE_FIRST != dm.TEMPLATE_SECOND

    def test_second_motion_references_first(self):
        result = dm.build_second_motion(**_second())
        assert result.context["first_motion_order_date"] == date(2024, 1, 1)
