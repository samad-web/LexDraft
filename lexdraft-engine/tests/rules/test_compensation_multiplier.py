"""Tests for src.rules.compensation_multiplier — MACT compensation (Sarla Verma /
Pranay Sethi). Deterministic. No LLM.

DEATH and INJURY are computed by DIFFERENT formulae and must not be conflated:

  DEATH:  multiplicand = (annual income + future prospects) - personal-expenses
          deduction; award = multiplicand * multiplier + conventional heads
          (loss of estate, consortium, funeral).

  INJURY: award = loss of earning capacity (income * disability%, * multiplier
          where the disability is permanent) + treatment + attendant/special
          expenses. NO personal-expenses deduction, NO conventional death heads.

Every table (multiplier bands, future-prospects slabs, deduction fractions,
conventional-head figures) is VERIFY. These tests pin the STRUCTURE, the
death/injury separation, and the arithmetic wiring — not the exact statutory
figures, which advocates replace. `TABLES_ARE_VERIFY` is True.
"""

import pytest

from src.rules import compensation_multiplier as cm


class TestVerifyMarked:
    def test_tables_exposed_and_marked_verify(self):
        assert cm.TABLES_ARE_VERIFY is True
        assert hasattr(cm, "MULTIPLIER_BANDS")
        assert hasattr(cm, "FUTURE_PROSPECTS")
        assert hasattr(cm, "PERSONAL_EXPENSE_DEDUCTION")
        assert hasattr(cm, "CONVENTIONAL_HEADS")


# --------------------------------------------------------------------------
# Sarla Verma multiplier bands by age of the deceased.
# --------------------------------------------------------------------------

class TestMultiplierBands:
    def test_multiplier_selected_by_age(self):
        # Structure: a young deceased gets a higher multiplier than an older one.
        young = cm.multiplier_for_age(30)
        old = cm.multiplier_for_age(60)
        assert young > old

    def test_known_band_boundaries(self):
        """Sarla Verma bands step at 5-year boundaries; the multiplier must be
        constant within a band and change across it."""
        assert cm.multiplier_for_age(26) == cm.multiplier_for_age(30)  # same band 26-30
        assert cm.multiplier_for_age(30) != cm.multiplier_for_age(31)  # crosses band

    def test_age_out_of_table_raises(self):
        with pytest.raises(cm.CompensationInputError):
            cm.multiplier_for_age(-1)


# --------------------------------------------------------------------------
# Pranay Sethi future-prospects — salaried vs self-employed/fixed-wage differ.
# --------------------------------------------------------------------------

class TestFutureProspects:
    def test_salaried_and_self_employed_differ(self):
        """The percentages differ between permanent-salaried and self-employed /
        fixed-wage for the same age."""
        salaried = cm.future_prospects_pct(age=35, employment=cm.Employment.PERMANENT_SALARIED)
        self_emp = cm.future_prospects_pct(age=35, employment=cm.Employment.SELF_EMPLOYED)
        assert salaried != self_emp

    def test_prospects_decrease_with_age(self):
        young = cm.future_prospects_pct(age=35, employment=cm.Employment.PERMANENT_SALARIED)
        older = cm.future_prospects_pct(age=55, employment=cm.Employment.PERMANENT_SALARIED)
        assert young > older

    def test_fixed_wage_uses_self_employed_slab(self):
        self_emp = cm.future_prospects_pct(age=35, employment=cm.Employment.SELF_EMPLOYED)
        fixed = cm.future_prospects_pct(age=35, employment=cm.Employment.FIXED_WAGE)
        assert fixed == self_emp


# --------------------------------------------------------------------------
# Personal-expenses deduction by number of dependants.
# --------------------------------------------------------------------------

class TestPersonalExpenseDeduction:
    def test_deduction_fraction_by_dependants(self):
        """More dependants -> smaller personal-expenses deduction fraction."""
        few = cm.personal_expense_fraction(dependants=2)
        many = cm.personal_expense_fraction(dependants=6)
        assert many < few

    def test_deduction_bands(self):
        # 2-3 dependants: 1/3; 4-6: 1/4; >6: 1/5 (Sarla Verma structure).
        assert cm.personal_expense_fraction(dependants=3) == pytest.approx(1/3)
        assert cm.personal_expense_fraction(dependants=5) == pytest.approx(1/4)
        assert cm.personal_expense_fraction(dependants=8) == pytest.approx(1/5)

    def test_zero_dependants_raises(self):
        with pytest.raises(cm.CompensationInputError):
            cm.personal_expense_fraction(dependants=0)


# --------------------------------------------------------------------------
# Death computation — end to end.
# --------------------------------------------------------------------------

class TestDeathComputation:
    def test_death_award_structure(self):
        result = cm.compute_death(
            age=35, annual_income=300000, dependants=3,
            employment=cm.Employment.PERMANENT_SALARIED,
        )
        # multiplicand = (income + prospects) - deduction; award = mult*multiplier + heads
        assert result.multiplicand > 0
        assert result.multiplier == cm.multiplier_for_age(35)
        assert result.loss_of_dependency == result.multiplicand * result.multiplier
        assert result.total == result.loss_of_dependency + result.conventional_total

    def test_future_prospects_added_before_deduction(self):
        """Prospects are added to income, then the personal-expenses deduction is
        applied to the enhanced income (Pranay Sethi)."""
        result = cm.compute_death(
            age=35, annual_income=300000, dependants=3,
            employment=cm.Employment.PERMANENT_SALARIED,
        )
        pct = cm.future_prospects_pct(35, cm.Employment.PERMANENT_SALARIED)
        enhanced = 300000 * (1 + pct)
        frac = cm.personal_expense_fraction(3)
        assert result.multiplicand == pytest.approx(enhanced * (1 - frac))

    def test_conventional_heads_present(self):
        result = cm.compute_death(
            age=35, annual_income=300000, dependants=3,
            employment=cm.Employment.PERMANENT_SALARIED,
        )
        heads = {h.name for h in result.conventional_heads}
        assert "loss_of_estate" in heads
        assert "loss_of_consortium" in heads
        assert "funeral_expenses" in heads

    def test_periodic_enhancement_note_present(self):
        """Pranay Sethi conventional heads carry a periodic-enhancement note."""
        result = cm.compute_death(
            age=35, annual_income=300000, dependants=3,
            employment=cm.Employment.PERMANENT_SALARIED,
        )
        assert result.enhancement_note
        assert "enhance" in result.enhancement_note.lower()


# --------------------------------------------------------------------------
# Injury computation — a DIFFERENT formula.
# --------------------------------------------------------------------------

class TestInjuryComputation:
    def test_injury_uses_disability_against_income(self):
        result = cm.compute_injury(
            age=35, annual_income=300000, disability_pct=40,
            permanent=True, treatment_expenses=50000, attendant_expenses=20000,
        )
        assert result.loss_of_earning_capacity > 0
        assert result.treatment_expenses == 50000
        assert result.attendant_expenses == 20000
        assert result.total == (result.loss_of_earning_capacity + 50000 + 20000)

    def test_injury_has_no_personal_expense_deduction(self):
        """Injury must NOT apply the death personal-expenses deduction."""
        result = cm.compute_injury(
            age=35, annual_income=300000, disability_pct=40, permanent=True,
            treatment_expenses=0, attendant_expenses=0,
        )
        assert not hasattr(result, "personal_expense_fraction")
        assert not hasattr(result, "conventional_heads")

    def test_permanent_disability_applies_multiplier(self):
        permanent = cm.compute_injury(
            age=35, annual_income=300000, disability_pct=40, permanent=True,
            treatment_expenses=0, attendant_expenses=0,
        )
        temporary = cm.compute_injury(
            age=35, annual_income=300000, disability_pct=40, permanent=False,
            treatment_expenses=0, attendant_expenses=0,
        )
        # permanent capitalises the loss via the multiplier; temporary does not.
        assert permanent.loss_of_earning_capacity > temporary.loss_of_earning_capacity

    def test_injury_and_death_are_separate_entry_points(self):
        assert callable(cm.compute_death)
        assert callable(cm.compute_injury)


# --------------------------------------------------------------------------
# Unverified marker on rendered figures.
# --------------------------------------------------------------------------

class TestUnverifiedMarker:
    def test_result_carries_unverified_flag(self):
        result = cm.compute_death(
            age=35, annual_income=300000, dependants=3,
            employment=cm.Employment.PERMANENT_SALARIED,
        )
        assert result.unverified is True

    def test_marker_string_available(self):
        assert cm.UNVERIFIED_MARKER
        assert "verif" in cm.UNVERIFIED_MARKER.lower()
