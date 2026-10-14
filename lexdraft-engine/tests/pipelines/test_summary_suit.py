"""Tests for src.pipelines.summary_suit — O37 summary suit (spec 4.1, separate skeleton).

A SEPARATE skeleton from the ordinary plaint, not a variant. Distinguishing
features (each enforced):
  - The claim must arise on a written contract, a bill of exchange, a promissory
    note, or a debt/liquidated demand arising from an enactment. Any other basis
    -> refuse (O37 is not available).
  - The plaint must STATE that it is filed under Order XXXVII and that no relief
    outside the Order's scope is claimed — both are structural averments the
    engine emits.
  - Summons for judgment follows institution — the skeleton carries that step.
  - The defendant has NO right to defend without leave — pleaded expressly.

Reuses the same rules as the ordinary plaint: court_fee, jurisdiction, limitation.
LLM narrative slots follow the named-empty-slot convention.
"""

from datetime import date

import pytest

from src.pipelines import summary_suit as ss
from src.rules import jurisdiction as jur


def _base(**over):
    kw = dict(
        plaintiff_name="Ramesh", defendant_names=["Suresh"],
        claim_basis=ss.ClaimBasis.PROMISSORY_NOTE,
        instrument_ref="promissory note dated 01-01-2023",
        cause_of_action_date=date(2023, 1, 1),
        cause_of_action_place="Chennai",
        forum=jur.Forum.SUBORDINATE_JUDGE,
        territorial_bases=[jur.TerritorialBasis.DEFENDANT_RESIDES],
        principal=100000, interest_amount=12000, claimed_total=112000,
        interest_rate=12.0, interest_is_contractual=True,
        interest_document_ref="promissory note dated 01-01-2023",
        limitation_article="35", limitation_trigger_date=date(2023, 1, 1),
        acknowledgements=[], filing_date=date(2024, 5, 1),
        transaction_narrative="",
        place="Chennai",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Claim basis — must be within O37 scope.
# --------------------------------------------------------------------------

class TestClaimBasis:
    def test_promissory_note_builds(self):
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.PROMISSORY_NOTE))
        assert result.refused is False

    def test_claim_basis_renders_human_readable(self):
        """The claim basis prints as 'promissory note', not the raw enum
        'promissory_note'."""
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.PROMISSORY_NOTE))
        assert result.context["claim_basis"] == "promissory note"
        assert "_" not in result.context["claim_basis"]

    def test_bill_of_exchange_renders_human_readable(self):
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.BILL_OF_EXCHANGE))
        assert result.context["claim_basis"] == "bill of exchange"

    def test_bill_of_exchange_builds(self):
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.BILL_OF_EXCHANGE))
        assert result.refused is False

    def test_written_contract_builds(self):
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.WRITTEN_CONTRACT))
        assert result.refused is False

    def test_enactment_debt_builds(self):
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.ENACTMENT_DEBT))
        assert result.refused is False

    def test_out_of_scope_basis_refused(self):
        """A claim not within O37 R1(2) cannot be brought as a summary suit."""
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.OTHER))
        assert result.refused is True
        assert result.context is None
        assert "order xxxvii" in result.reason.lower() or "o37" in result.reason.lower()

    def test_instrument_ref_required_for_instrument_claims(self):
        result = ss.build(**_base(claim_basis=ss.ClaimBasis.PROMISSORY_NOTE,
                                  instrument_ref=""))
        assert result.refused is True


# --------------------------------------------------------------------------
# Order XXXVII structural averments.
# --------------------------------------------------------------------------

class TestOrder37Averments:
    def test_states_filed_under_order_37(self):
        result = ss.build(**_base())
        assert result.context["under_order_37"] is True

    def test_states_no_relief_outside_order_scope(self):
        result = ss.build(**_base())
        assert result.context["no_relief_outside_scope"] is True

    def test_summons_for_judgment_step_present(self):
        result = ss.build(**_base())
        assert result.context["summons_for_judgment"] is True

    def test_no_defence_without_leave_pleaded(self):
        result = ss.build(**_base())
        assert result.context["no_defence_without_leave"] is True


# --------------------------------------------------------------------------
# Reused rules (same as the ordinary plaint).
# --------------------------------------------------------------------------

class TestReusedRules:
    def test_arithmetic_mismatch_refused(self):
        result = ss.build(**_base(principal=100000, interest_amount=12000,
                                  claimed_total=115000))
        assert result.refused is True
        assert "total" in result.reason.lower() or "arithmetic" in result.reason.lower()

    def test_over_pecuniary_limit_refused(self):
        result = ss.build(**_base(principal=100_000_000, interest_amount=0,
                                  claimed_total=100_000_000,
                                  forum=jur.Forum.DISTRICT_MUNSIF))
        assert result.refused is True

    def test_no_territorial_basis_refused(self):
        result = ss.build(**_base(territorial_bases=[]))
        assert result.refused is True

    def test_time_barred_refused(self):
        result = ss.build(**_base(limitation_trigger_date=date(2018, 1, 1),
                                  filing_date=date(2024, 5, 1)))
        assert result.refused is True

    def test_cause_of_action_needs_date_and_place(self):
        assert ss.build(**_base(cause_of_action_place="")).refused is True
        assert ss.build(**_base(cause_of_action_date=None)).refused is True

    def test_court_fee_computed(self):
        result = ss.build(**_base())
        assert result.context["court_fee"] > 0
        assert result.context["valuation_basis"]


# --------------------------------------------------------------------------
# Separateness from the ordinary plaint.
# --------------------------------------------------------------------------

class TestSeparateSkeleton:
    def test_summary_suit_is_not_a_plaint_variant(self):
        """O37 is its own module/skeleton, not folded into plaint.Variant."""
        from src.pipelines import plaint as pl
        assert not hasattr(pl.Variant, "SUMMARY_SUIT")

    def test_uses_own_template(self):
        assert ss.TEMPLATE == "summary_suit.docx"
        assert ss.TEMPLATE != "plaint.docx"


# --------------------------------------------------------------------------
# LLM slot.
# --------------------------------------------------------------------------

class TestLlmSlot:
    def test_transaction_slot_named_when_empty(self):
        result = ss.build(**_base(transaction_narrative=""))
        assert result.context["transaction_slot"] == "[to be drafted]"

    def test_prewritten_slot_accepted(self):
        result = ss.build(**_base(transaction_narrative="On 01-01-2023 ..."))
        assert result.context["transaction_slot"] == "On 01-01-2023 ..."
