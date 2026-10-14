"""Tests for src.pipelines.plaint — plaint for money recovery (spec 4.1).

Consumes standalone rules: court_fee, jurisdiction, limitation (reused, not
reimplemented). Enforces:
  - Cause of action needs date AND place; missing either -> refuse.
  - Jurisdiction pleaded expressly, both limbs (pecuniary + territorial).
  - Limitation: article + trigger + computation; s.18 acknowledgements restart
    (delegated to the limitation module).
  - Arithmetic recomputed: principal + interest == claimed total, else refuse.
  - Contractual interest rate needs a document reference; without one, fall back
    to statutory and say so in the pleading.
  - Government defendant -> s.80 CPC notice averment mandatory.
  - Commercial suit -> s.12A mediation certificate/exemption + statement of truth.
  - LLM slots at paragraphs 3, 5, 6, 9 only.
"""

from datetime import date

import pytest

from src.pipelines import plaint as pl
from src.rules import jurisdiction as jur
from src.rules import court_fee as cf


def _base(**over):
    kw = dict(
        plaintiff_name="Ramesh", defendant_names=["Suresh"],
        variant=pl.Variant.INDIVIDUAL,
        # cause of action
        cause_of_action_date=date(2021, 6, 1),
        cause_of_action_place="Chennai",
        # jurisdiction
        forum=jur.Forum.SUBORDINATE_JUDGE,
        territorial_bases=[jur.TerritorialBasis.DEFENDANT_RESIDES,
                           jur.TerritorialBasis.CAUSE_PART_AROSE],
        # money
        principal=100000,
        interest_amount=18000,
        claimed_total=118000,
        # interest
        interest_rate=18.0,
        interest_is_contractual=True,
        interest_document_ref="loan agreement dated 01-01-2021, clause 4",
        # limitation
        limitation_article="19",
        limitation_trigger_date=date(2021, 6, 1),
        acknowledgements=[],
        filing_date=date(2024, 5, 1),
        # conditional
        is_government_defendant=False,
        s80_notice_ref=None,
        is_commercial_suit=False,
        s12a_ref=None,
        # narrative slots (3,5,6,9)
        transaction_narrative="",
        performance_narrative="",
        default_narrative="",
        notice_narrative="",
        place="Chennai",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Cause of action — date AND place.
# --------------------------------------------------------------------------

class TestCauseOfAction:
    def test_complete_builds(self):
        result = pl.build(**_base())
        assert result.refused is False

    def test_missing_date_refused(self):
        result = pl.build(**_base(cause_of_action_date=None))
        assert result.refused is True
        assert result.context is None
        assert "cause of action" in result.reason.lower()

    def test_missing_place_refused(self):
        result = pl.build(**_base(cause_of_action_place=""))
        assert result.refused is True
        assert "place" in result.reason.lower()

    def test_both_appear_in_context(self):
        result = pl.build(**_base())
        assert result.context["cause_of_action_date"] == date(2021, 6, 1)
        assert result.context["cause_of_action_place"] == "Chennai"


# --------------------------------------------------------------------------
# Jurisdiction — both limbs, expressly.
# --------------------------------------------------------------------------

class TestJurisdiction:
    def test_over_pecuniary_limit_refused_names_forum(self):
        result = pl.build(**_base(principal=100_000_000, interest_amount=0,
                                  claimed_total=100_000_000,
                                  forum=jur.Forum.DISTRICT_MUNSIF))
        assert result.refused is True
        assert "pecuniary" in result.reason.lower() or "forum" in result.reason.lower()

    def test_no_territorial_basis_refused(self):
        result = pl.build(**_base(territorial_bases=[]))
        assert result.refused is True
        assert "territorial" in result.reason.lower() or "s.20" in result.reason

    def test_both_limbs_pleaded_in_context(self):
        result = pl.build(**_base())
        assert result.context["pecuniary_basis"]
        assert len(result.context["territorial_bases"]) == 2


# --------------------------------------------------------------------------
# Limitation — reuse the limitation module; s.18 restart.
# --------------------------------------------------------------------------

class TestLimitation:
    def test_within_time_builds(self):
        result = pl.build(**_base(limitation_trigger_date=date(2021, 6, 1),
                                  filing_date=date(2024, 5, 1)))  # 3-yr art, in time
        assert result.refused is False
        assert result.context["limitation_article"] == "19"

    def test_time_barred_refused(self):
        result = pl.build(**_base(limitation_trigger_date=date(2018, 1, 1),
                                  acknowledgements=[],
                                  filing_date=date(2024, 5, 1)))
        assert result.refused is True
        assert "limitation" in result.reason.lower() or "barred" in result.reason.lower()

    def test_s18_acknowledgement_restarts_and_saves_suit(self):
        """A within-time acknowledgement restarts the period, bringing an
        otherwise-barred suit back in time. Delegated to the limitation module."""
        result = pl.build(**_base(
            limitation_trigger_date=date(2019, 1, 1),
            acknowledgements=[pl.Acknowledgement(date=date(2021, 6, 1),
                                                 in_writing=True, signed=True)],
            filing_date=date(2024, 5, 1),
        ))
        # Fresh 3-yr period from 2021-06-01 -> expiry 2024-06-01; filing 2024-05-01 in time.
        assert result.refused is False
        assert result.context["limitation_restarted"] is True

    def test_limitation_computation_stated(self):
        result = pl.build(**_base())
        assert result.context["limitation_computation"]


# --------------------------------------------------------------------------
# Arithmetic — principal + interest == claimed total.
# --------------------------------------------------------------------------

class TestArithmetic:
    def test_matching_total_builds(self):
        result = pl.build(**_base(principal=100000, interest_amount=18000,
                                  claimed_total=118000))
        assert result.refused is False

    def test_mismatch_refused(self):
        result = pl.build(**_base(principal=100000, interest_amount=18000,
                                  claimed_total=120000))
        assert result.refused is True
        assert "arithmetic" in result.reason.lower() or "total" in result.reason.lower()

    def test_account_statement_in_context(self):
        result = pl.build(**_base())
        assert result.context["principal"] == 100000
        assert result.context["interest_amount"] == 18000
        assert result.context["claimed_total"] == 118000


# --------------------------------------------------------------------------
# Interest — contractual needs a document ref; else statutory fallback.
# --------------------------------------------------------------------------

class TestInterest:
    def test_contractual_with_document_ref_ok(self):
        result = pl.build(**_base(interest_is_contractual=True,
                                  interest_document_ref="agreement clause 4"))
        assert result.refused is False
        assert result.context["interest_basis"] == "contractual"
        assert result.context["interest_document_ref"]

    def test_contractual_without_document_ref_falls_back_to_statutory(self):
        """Contractual rate claimed but no document reference -> fall back to
        statutory and SAY SO in the pleading (does not refuse)."""
        result = pl.build(**_base(interest_is_contractual=True,
                                  interest_document_ref=None))
        assert result.refused is False
        assert result.context["interest_basis"] == "statutory"
        assert result.context["interest_fallback_note"]  # explains the fallback

    def test_statutory_interest_ok(self):
        result = pl.build(**_base(interest_is_contractual=False,
                                  interest_document_ref=None))
        assert result.refused is False
        assert result.context["interest_basis"] == "statutory"


# --------------------------------------------------------------------------
# s.80 CPC — Government defendant.
# --------------------------------------------------------------------------

class TestSection80:
    def test_government_without_notice_refused(self):
        result = pl.build(**_base(variant=pl.Variant.GOVERNMENT,
                                  is_government_defendant=True, s80_notice_ref=None))
        assert result.refused is True
        assert "80" in result.reason

    def test_government_with_notice_builds(self):
        result = pl.build(**_base(variant=pl.Variant.GOVERNMENT,
                                  is_government_defendant=True,
                                  s80_notice_ref="notice dated 01-02-2024 served on the "
                                                 "Collector, Chennai"))
        assert result.refused is False
        assert result.context["s80_notice_ref"]

    def test_non_government_needs_no_s80(self):
        result = pl.build(**_base(is_government_defendant=False))
        assert result.refused is False


# --------------------------------------------------------------------------
# s.12A + statement of truth — commercial suit.
# --------------------------------------------------------------------------

class TestCommercialSuit:
    def test_commercial_without_s12a_refused(self):
        result = pl.build(**_base(is_commercial_suit=True, s12a_ref=None))
        assert result.refused is True
        assert "12A" in result.reason or "mediation" in result.reason.lower()

    def test_commercial_with_s12a_builds_and_adds_statement_of_truth(self):
        result = pl.build(**_base(is_commercial_suit=True,
                                  s12a_ref="mediation exemption: urgent interim relief sought"))
        assert result.refused is False
        assert result.context["has_statement_of_truth"] is True

    def test_non_commercial_no_statement_of_truth(self):
        result = pl.build(**_base(is_commercial_suit=False))
        assert result.context.get("has_statement_of_truth", False) is False


# --------------------------------------------------------------------------
# LLM slots at paragraphs 3, 5, 6, 9.
# --------------------------------------------------------------------------

class TestLlmSlots:
    def test_four_slots_named_when_empty(self):
        result = pl.build(**_base())
        assert result.context["transaction_slot"] == "[to be drafted]"
        assert result.context["performance_slot"] == "[to be drafted]"
        assert result.context["default_slot"] == "[to be drafted]"
        assert result.context["notice_slot"] == "[to be drafted]"

    def test_prewritten_slots_accepted(self):
        result = pl.build(**_base(transaction_narrative="On 01-01-2021 ..."))
        assert result.context["transaction_slot"] == "On 01-01-2021 ..."


# --------------------------------------------------------------------------
# Court fee — computed and pleaded.
# --------------------------------------------------------------------------

class TestCourtFee:
    def test_court_fee_and_valuation_basis_in_context(self):
        result = pl.build(**_base())
        assert result.context["court_fee"] > 0
        assert result.context["valuation_basis"]


# --------------------------------------------------------------------------
# Variants.
# --------------------------------------------------------------------------

class TestVariants:
    def test_partnership_variant(self):
        result = pl.build(**_base(variant=pl.Variant.PARTNERSHIP))
        assert result.refused is False
        assert result.context["variant"] == "partnership"

    def test_company_variant(self):
        result = pl.build(**_base(variant=pl.Variant.COMPANY))
        assert result.context["variant"] == "company"

    def test_minor_variant(self):
        result = pl.build(**_base(variant=pl.Variant.MINOR))
        assert result.context["variant"] == "minor"

    def test_summary_suit_not_a_variant_here(self):
        """O37 summary suit is a SEPARATE skeleton, not folded into this plaint."""
        assert not hasattr(pl.Variant, "SUMMARY_SUIT")
