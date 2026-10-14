"""Tests for src.rules.court_fee — TN Court Fees and Suits Valuation Act 1955.

Three computation modes:
  - AD VALOREM on money claims (slab/percentage of the claim value).
  - FIXED fee where the Act prescribes a fixed amount for the relief.
  - RELIEF-LINKED where a suit seeks multiple reliefs — fee is the sum of the
    per-relief fees.

Every result returns BOTH the computed fee AND the valuation basis, because the
plaint must plead both (para 13 of 4.1).

The slab table is VERIFY (advocate review) — these tests pin the STRUCTURE and
dispatch, not the exact statutory numbers, which advocates replace.
"""

import pytest

from src.rules import court_fee as cf


class TestAdValorem:
    def test_money_claim_returns_fee_and_basis(self):
        r = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=100000)])
        assert r.fee > 0
        assert r.valuation_basis  # non-empty string pleadable in the plaint
        assert r.mode == cf.FeeMode.AD_VALOREM

    def test_ad_valorem_scales_with_value(self):
        low = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=100000)])
        high = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=500000)])
        assert high.fee > low.fee

    def test_valuation_basis_names_the_claim_value(self):
        r = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=250000)])
        assert "250000" in r.valuation_basis or "2,50,000" in r.valuation_basis


class TestFixedFee:
    def test_fixed_relief_returns_fixed_fee(self):
        r = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.DECLARATION_FIXED)])
        assert r.mode == cf.FeeMode.FIXED
        assert r.fee > 0

    def test_fixed_fee_independent_of_value(self):
        r1 = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.DECLARATION_FIXED)])
        r2 = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.DECLARATION_FIXED,
                                           value=999999)])
        assert r1.fee == r2.fee


class TestReliefLinked:
    def test_multiple_reliefs_sum_per_relief(self):
        money = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=100000)])
        fixed = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.DECLARATION_FIXED)])
        both = cf.compute(reliefs=[
            cf.Relief(kind=cf.ReliefKind.MONEY, value=100000),
            cf.Relief(kind=cf.ReliefKind.DECLARATION_FIXED),
        ])
        assert both.mode == cf.FeeMode.RELIEF_LINKED
        assert both.fee == money.fee + fixed.fee

    def test_relief_linked_lists_each_component(self):
        both = cf.compute(reliefs=[
            cf.Relief(kind=cf.ReliefKind.MONEY, value=100000),
            cf.Relief(kind=cf.ReliefKind.DECLARATION_FIXED),
        ])
        assert len(both.components) == 2


class TestGuards:
    def test_no_reliefs_raises(self):
        with pytest.raises(cf.CourtFeeInputError):
            cf.compute(reliefs=[])

    def test_money_relief_without_value_raises(self):
        with pytest.raises(cf.CourtFeeInputError):
            cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=None)])

    def test_negative_value_raises(self):
        with pytest.raises(cf.CourtFeeInputError):
            cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=-1)])


class TestVerifyMarked:
    def test_slab_table_is_exposed_and_marked_verify(self):
        """The slab table must be inspectable so advocates can verify/replace it."""
        assert hasattr(cf, "AD_VALOREM_SLABS")
        assert cf.SLABS_ARE_VERIFY is True
