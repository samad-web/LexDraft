"""Tests for src.pipelines.general_notice — general demand notice (spec 2.1).

LLM slots are paragraphs 4, 6, 7, 8 ONLY (transaction narrative, breach, prior
demands, loss). Demand and consequence are rule-driven, never model-written.

Validation:
  - Compliance period must meet the statutory minimum where a statute applies;
    refuse if short.
  - Amount in figures and words must match (reuse amount_words).
  - Client authority averment present.
  - Dispatch proof placeholder present.
"""

from datetime import date

import pytest

from src.pipelines import general_notice as gn


def _base(**over):
    kw = dict(
        client="Ramesh", advocate="Adv. Kannan", advocate_enrolment="MS/1234/2010",
        recipient_name="Suresh", recipient_address="8 South St, Chennai 600001",
        recipient_mode="Registered Post AD",
        demand_amount=50000,
        act_required="pay the outstanding sum",
        compliance_days=15,
        statutory_minimum_days=None,   # no statute -> any reasonable period
        civil_consequence="a civil suit for recovery with interest and costs",
        criminal_consequence=None,
        dispatch_tracking_placeholder="{{ rpad_tracking }}",
        # LLM slots (4, 6, 7, 8)
        transaction_narrative="",
        breach_narrative="",
        prior_demands_narrative="",
        loss_narrative="",
        notice_date=date(2024, 5, 1),
        place="Chennai",
    )
    kw.update(over)
    return kw


class TestLlmSlots:
    def test_slots_4_6_7_8_named_when_empty(self):
        result = gn.build(**_base())
        assert result.context["transaction_slot"] == "[to be drafted]"
        assert result.context["breach_slot"] == "[to be drafted]"
        assert result.context["prior_demands_slot"] == "[to be drafted]"
        assert result.context["loss_slot"] == "[to be drafted]"

    def test_prewritten_slots_accepted(self):
        result = gn.build(**_base(transaction_narrative="On 01-01-2024 ..."))
        assert result.context["transaction_slot"] == "On 01-01-2024 ..."

    def test_demand_is_rule_driven_not_a_slot(self):
        """Demand text is assembled from fields, not an LLM slot."""
        result = gn.build(**_base(demand_amount=50000,
                                  act_required="pay the outstanding sum"))
        assert result.context["demand_amount"] == 50000
        assert "act" not in result.context or result.context.get("act_required")


class TestComplianceMinimum:
    def test_meets_statutory_minimum_ok(self):
        result = gn.build(**_base(compliance_days=15, statutory_minimum_days=15))
        assert result.refused is False

    def test_below_statutory_minimum_refused(self):
        result = gn.build(**_base(compliance_days=7, statutory_minimum_days=15))
        assert result.refused is True
        assert result.context is None
        assert "minimum" in result.reason.lower() or "15" in result.reason

    def test_above_minimum_ok(self):
        result = gn.build(**_base(compliance_days=30, statutory_minimum_days=15))
        assert result.refused is False

    def test_no_statute_any_period_ok(self):
        result = gn.build(**_base(compliance_days=7, statutory_minimum_days=None))
        assert result.refused is False


class TestAmountFiguresAndWords:
    def test_amount_words_match_figures(self):
        result = gn.build(**_base(demand_amount=125000))
        assert result.context["demand_amount"] == 125000
        assert "one lakh twenty-five thousand" in result.context["demand_words"].lower()

    def test_zero_demand_refused(self):
        """A demand notice with no sum demanded is not a demand."""
        result = gn.build(**_base(demand_amount=0))
        assert result.refused is True


class TestMandatoryAverments:
    def test_client_authority_present(self):
        result = gn.build(**_base())
        assert result.context["under_instructions"] is True
        assert result.context["client"] == "Ramesh"

    def test_dispatch_placeholder_required(self):
        result = gn.build(**_base(dispatch_tracking_placeholder=""))
        assert result.refused is True
        assert "dispatch" in result.reason.lower()

    def test_specific_consequence_present(self):
        result = gn.build(**_base())
        assert result.context["civil_consequence"]

    def test_vague_consequence_refused(self):
        """A specific consequence is mandatory; an empty/vague one is refused."""
        result = gn.build(**_base(civil_consequence="", criminal_consequence=None))
        assert result.refused is True
        assert "consequence" in result.reason.lower()
