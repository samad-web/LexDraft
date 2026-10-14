"""Tests for src.pipelines.mact_claim — MACT claim petition, MV Act s.166 (spec 7.2).

Consumes src.rules.compensation_multiplier (Sarla Verma / Pranay Sethi).

Hard checks / behaviours:
  - Rash and negligent driving pleaded expressly — jurisdictional; refuse without.
  - Arithmetic recomputed end to end; claimed total must equal the computation.
    Mismatch -> refuse.
  - Policy validity checked against the accident date. Invalid/lapsed -> still
    GENERATE, but the pleading must address it (claim proceeds against owner and
    driver regardless).
  - Income proof: income asserted without proof -> the computation must SAY SO,
    not silently treat it as established.
  - Computed figures carry a visible unverified marker (like court fee).

LLM slot at paragraph 2 (accident narrative) only.
"""

from datetime import date

import pytest

from src.pipelines import mact_claim as mact
from src.rules import compensation_multiplier as cm


def _death_total():
    r = cm.compute_death(age=35, annual_income=300000, dependants=3,
                         employment=cm.Employment.PERMANENT_SALARIED)
    return r.total


def _base(**over):
    kw = dict(
        claim_kind=mact.ClaimKind.DEATH,
        claimants=["Widow", "Child 1", "Child 2"],
        accident_date=date(2024, 3, 1),
        rash_negligent_pleaded=True,
        fir_ref="Crime No. 45/2024, B1 Traffic PS",
        vehicle_number="TN01AB1234", owner="Owner", driver="Driver",
        insurer="XYZ Insurance", policy_no="POL-1", policy_valid_on_accident=True,
        # victim
        victim_age=35, victim_annual_income=300000, income_proof_present=True,
        employment=cm.Employment.PERMANENT_SALARIED, dependants=3,
        # injury-only fields
        disability_pct=None, permanent=None,
        treatment_expenses=0, attendant_expenses=0,
        # claim
        claimed_total=None,   # None -> use the computed total
        jurisdiction_basis="the accident occurred within this Tribunal's "
                           "jurisdiction (s.166(2))",
        place="Chennai",
        accident_narrative="",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Rash and negligent driving — jurisdictional.
# --------------------------------------------------------------------------

class TestRashNegligent:
    def test_pleaded_builds(self):
        result = mact.build(**_base(rash_negligent_pleaded=True,
                                    claimed_total=round(_death_total())))
        assert result.refused is False

    def test_not_pleaded_refused(self):
        result = mact.build(**_base(rash_negligent_pleaded=False))
        assert result.refused is True
        assert result.context is None
        assert "rash" in result.reason.lower() or "negligent" in result.reason.lower()


# --------------------------------------------------------------------------
# Death computation wired from compensation_multiplier.
# --------------------------------------------------------------------------

class TestDeathComputation:
    def test_uses_compensation_module(self):
        result = mact.build(**_base(claim_kind=mact.ClaimKind.DEATH,
                                    claimed_total=round(_death_total())))
        assert result.context["computation"]["total"] == pytest.approx(_death_total())

    def test_multiplier_and_multiplicand_in_context(self):
        result = mact.build(**_base(claimed_total=round(_death_total())))
        comp = result.context["computation"]
        assert comp["multiplier"] == cm.multiplier_for_age(35)
        assert comp["multiplicand"] > 0


# --------------------------------------------------------------------------
# Injury computation uses the DIFFERENT formula.
# --------------------------------------------------------------------------

class TestInjuryComputation:
    def _injury_total(self):
        r = cm.compute_injury(age=35, annual_income=300000, disability_pct=40,
                              permanent=True, treatment_expenses=50000,
                              attendant_expenses=20000)
        return r.total

    def test_injury_builds(self):
        result = mact.build(**_base(
            claim_kind=mact.ClaimKind.INJURY,
            disability_pct=40, permanent=True,
            treatment_expenses=50000, attendant_expenses=20000,
            claimed_total=round(self._injury_total()),
        ))
        assert result.refused is False
        assert "loss_of_earning_capacity" in result.context["computation"]

    def test_injury_has_no_conventional_heads(self):
        result = mact.build(**_base(
            claim_kind=mact.ClaimKind.INJURY,
            disability_pct=40, permanent=True,
            treatment_expenses=50000, attendant_expenses=20000,
            claimed_total=round(self._injury_total()),
        ))
        assert "conventional_heads" not in result.context["computation"]


# --------------------------------------------------------------------------
# Arithmetic — claimed total must equal the computation.
# --------------------------------------------------------------------------

class TestArithmetic:
    def test_matching_total_builds(self):
        result = mact.build(**_base(claimed_total=round(_death_total())))
        assert result.refused is False

    def test_mismatch_refused(self):
        result = mact.build(**_base(claimed_total=round(_death_total()) + 100000))
        assert result.refused is True
        assert "arithmetic" in result.reason.lower() or "total" in result.reason.lower()

    def test_none_claimed_total_uses_computation(self):
        result = mact.build(**_base(claimed_total=None))
        assert result.refused is False
        assert result.context["claimed_total"] == round(_death_total())


# --------------------------------------------------------------------------
# Policy validity — invalid still generates but must be addressed.
# --------------------------------------------------------------------------

class TestPolicyValidity:
    def test_valid_policy_builds(self):
        result = mact.build(**_base(policy_valid_on_accident=True,
                                    claimed_total=round(_death_total())))
        assert result.refused is False
        assert result.context["policy_valid"] is True

    def test_invalid_policy_still_generates(self):
        """Lapsed/invalid policy does NOT refuse — the claim proceeds against
        owner and driver regardless."""
        result = mact.build(**_base(policy_valid_on_accident=False,
                                    claimed_total=round(_death_total())))
        assert result.refused is False

    def test_invalid_policy_pleading_addresses_it(self):
        result = mact.build(**_base(policy_valid_on_accident=False,
                                    claimed_total=round(_death_total())))
        assert result.context["policy_addressed"] is True
        assert result.context["policy_valid"] is False


# --------------------------------------------------------------------------
# Income proof — say so when absent.
# --------------------------------------------------------------------------

class TestIncomeProof:
    def test_proof_present_marked_established(self):
        result = mact.build(**_base(income_proof_present=True,
                                    claimed_total=round(_death_total())))
        assert result.context["income_established"] is True

    def test_no_proof_says_so(self):
        result = mact.build(**_base(income_proof_present=False,
                                    claimed_total=round(_death_total())))
        assert result.context["income_established"] is False
        assert result.context["income_note"]  # explicit note that proof is absent


# --------------------------------------------------------------------------
# Unverified marker on rendered figures.
# --------------------------------------------------------------------------

class TestUnverifiedMarker:
    def test_computation_carries_unverified_marker(self):
        result = mact.build(**_base(claimed_total=round(_death_total())))
        assert result.context["computation_unverified"] is True
        assert result.context["unverified_marker"]


# --------------------------------------------------------------------------
# LLM slot (para 2).
# --------------------------------------------------------------------------

class TestLlmSlot:
    def test_accident_narrative_named_when_empty(self):
        result = mact.build(**_base(accident_narrative="",
                                    claimed_total=round(_death_total())))
        assert result.context["accident_slot"] == "[to be drafted]"

    def test_prewritten_narrative_accepted(self):
        result = mact.build(**_base(accident_narrative="On 01-03-2024 at 8pm ...",
                                    claimed_total=round(_death_total())))
        assert result.context["accident_slot"] == "On 01-03-2024 at 8pm ..."
