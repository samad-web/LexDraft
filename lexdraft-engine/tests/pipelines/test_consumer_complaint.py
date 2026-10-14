"""Tests for src.pipelines.consumer_complaint — consumer complaint (spec 7.1).

Hard checks / behaviours:
  - Consumer status (s.2(7)): goods/services for a COMMERCIAL PURPOSE -> refuse
    with explanation. EXCEPTION: bought for self-employment to earn a livelihood
    is NOT commercial purpose -> must NOT refuse.
  - Pecuniary tier from the CONSIDERATION PAID (not the compensation claimed):
    District / State / National. Threshold table VERIFY.
  - Limitation: 2 years from cause of action (via the limitation module).
    Exceeded -> auto-attach the condonation application, NOT refuse (same pattern
    as the s.142(b) proviso in 3.1).
  - Compensation must have a stated basis, not a bare figure.
  - Both the affidavit and the evidence affidavit are required.

LLM slots are paragraphs 4 (defect/deficiency) and 5 (complaints made and response).
"""

from datetime import date

import pytest

from src.pipelines import consumer_complaint as cc


def _base(**over):
    kw = dict(
        complainant_name="Ravi", opposite_party_name="Acme Appliances",
        # consumer status
        purpose=cc.Purpose.PERSONAL,
        # transaction
        consideration_paid=40000,
        transaction_date=date(2023, 1, 1),
        invoice_ref="invoice dated 01-01-2023",
        # cause of action + limitation
        cause_of_action_date=date(2023, 2, 1),
        filing_date=date(2024, 6, 1),
        # compensation
        compensation=15000,
        compensation_basis="cost of repair plus mental agony",
        # affidavits
        affidavit_present=True,
        evidence_affidavit_present=True,
        # jurisdiction
        territorial_basis="the opposite party carries on business within this "
                          "forum's jurisdiction",
        place="Chennai",
        # LLM slots (4, 5)
        defect_narrative="",
        complaints_narrative="",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Consumer status — s.2(7), with the self-employment exception.
# --------------------------------------------------------------------------

class TestConsumerStatus:
    def test_personal_purpose_builds(self):
        result = cc.build(**_base(purpose=cc.Purpose.PERSONAL))
        assert result.refused is False

    def test_commercial_purpose_refused(self):
        result = cc.build(**_base(purpose=cc.Purpose.COMMERCIAL))
        assert result.refused is True
        assert result.context is None
        assert "commercial" in result.reason.lower() or "2(7)" in result.reason

    def test_self_employment_livelihood_not_refused(self):
        """The statutory exception: goods/services for self-employment to earn a
        livelihood are NOT a commercial purpose."""
        result = cc.build(**_base(purpose=cc.Purpose.SELF_EMPLOYMENT_LIVELIHOOD))
        assert result.refused is False

    def test_consumer_status_in_context(self):
        result = cc.build(**_base(purpose=cc.Purpose.PERSONAL))
        assert result.context["is_consumer"] is True


# --------------------------------------------------------------------------
# Pecuniary tier — from consideration paid, not compensation claimed.
# --------------------------------------------------------------------------

class TestPecuniaryTier:
    def test_tier_from_consideration_not_compensation(self):
        """A low consideration with a huge compensation claim stays in the tier set
        by the CONSIDERATION."""
        low = cc.build(**_base(consideration_paid=40000, compensation=10_000_000))
        assert low.context["forum_tier"] == cc.ForumTier.DISTRICT

    def test_district_tier(self):
        result = cc.build(**_base(consideration_paid=100000))
        assert result.context["forum_tier"] == cc.ForumTier.DISTRICT

    def test_state_tier(self):
        limit = cc.PECUNIARY_TIERS[cc.ForumTier.DISTRICT]
        result = cc.build(**_base(consideration_paid=limit + 1))
        assert result.context["forum_tier"] == cc.ForumTier.STATE

    def test_national_tier(self):
        state_limit = cc.PECUNIARY_TIERS[cc.ForumTier.STATE]
        result = cc.build(**_base(consideration_paid=state_limit + 1))
        assert result.context["forum_tier"] == cc.ForumTier.NATIONAL

    def test_district_boundary_inclusive(self):
        limit = cc.PECUNIARY_TIERS[cc.ForumTier.DISTRICT]
        result = cc.build(**_base(consideration_paid=limit))
        assert result.context["forum_tier"] == cc.ForumTier.DISTRICT

    def test_threshold_table_verify_marked(self):
        assert cc.TIERS_ARE_VERIFY is True


# --------------------------------------------------------------------------
# Limitation — 2 years; exceeded -> auto-attach condonation, not refuse.
# --------------------------------------------------------------------------

class TestLimitation:
    def test_within_two_years_no_condonation(self):
        result = cc.build(**_base(cause_of_action_date=date(2023, 2, 1),
                                  filing_date=date(2024, 6, 1)))
        assert result.refused is False
        assert result.context["condonation_required"] is False

    def test_over_two_years_auto_attaches_condonation(self):
        """Cause of action 2021-01-01, filing 2024-06-01 (>2yr) -> condonation
        attached, NOT refused."""
        result = cc.build(**_base(cause_of_action_date=date(2021, 1, 1),
                                  filing_date=date(2024, 6, 1)))
        assert result.refused is False
        assert result.context["condonation_required"] is True

    def test_boundary_exactly_two_years_in_time(self):
        """Filing on the last day of the 2-year period is in time (inclusive)."""
        result = cc.build(**_base(cause_of_action_date=date(2022, 6, 1),
                                  filing_date=date(2024, 6, 1)))
        assert result.context["condonation_required"] is False

    def test_day_after_two_years_needs_condonation(self):
        result = cc.build(**_base(cause_of_action_date=date(2022, 6, 1),
                                  filing_date=date(2024, 6, 2)))
        assert result.context["condonation_required"] is True


# --------------------------------------------------------------------------
# Compensation — stated basis.
# --------------------------------------------------------------------------

class TestCompensation:
    def test_with_basis_builds(self):
        result = cc.build(**_base(compensation=15000, compensation_basis="repair cost"))
        assert result.refused is False

    def test_bare_figure_refused(self):
        result = cc.build(**_base(compensation=15000, compensation_basis=""))
        assert result.refused is True
        assert "basis" in result.reason.lower()

    def test_zero_compensation_allowed_if_other_relief(self):
        """A complaint may seek refund/replacement without a compensation figure;
        zero compensation is permitted when a basis is not required."""
        result = cc.build(**_base(compensation=0, compensation_basis=""))
        assert result.refused is False


# --------------------------------------------------------------------------
# Affidavits — both required.
# --------------------------------------------------------------------------

class TestAffidavits:
    def test_missing_affidavit_refused(self):
        result = cc.build(**_base(affidavit_present=False))
        assert result.refused is True
        assert "affidavit" in result.reason.lower()

    def test_missing_evidence_affidavit_refused(self):
        result = cc.build(**_base(evidence_affidavit_present=False))
        assert result.refused is True
        assert "evidence affidavit" in result.reason.lower()

    def test_both_present_builds(self):
        result = cc.build(**_base(affidavit_present=True, evidence_affidavit_present=True))
        assert result.refused is False


# --------------------------------------------------------------------------
# LLM slots (4, 5).
# --------------------------------------------------------------------------

class TestLlmSlots:
    def test_slots_named_when_empty(self):
        result = cc.build(**_base(defect_narrative="", complaints_narrative=""))
        assert result.context["defect_slot"] == "[to be drafted]"
        assert result.context["complaints_slot"] == "[to be drafted]"

    def test_prewritten_slots_accepted(self):
        result = cc.build(**_base(defect_narrative="The appliance failed within a week."))
        assert result.context["defect_slot"] == "The appliance failed within a week."
