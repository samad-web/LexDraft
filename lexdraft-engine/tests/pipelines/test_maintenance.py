"""Tests for src.pipelines.maintenance — maintenance under BNSS 144 / CrPC 125 (spec 6.3).

Consumes the dual_code_router for the framework (not a caller-supplied string),
same pattern as the bail pipelines.

Hard checks (each refuses, no partial output):
  - Neglect or refusal to maintain — the statutory trigger; pleaded expressly.
  - Rajnesh affidavit of assets and liabilities — mandatory; the PETITIONER's is
    the one we control and check for.
  - Divorced wife -> not-remarried averment required.
  - Child claimant >= 18 -> only maintainable if unable to maintain themselves due
    to physical or mental abnormality.
  - Quantum needs a stated computation basis, not a bare figure.

LLM slots are paragraphs 3 (neglect narrative) and 6 (quantum basis narrative).
"""

from datetime import date

import pytest

from src.pipelines import maintenance as mnt


def _base(**over):
    kw = dict(
        petitioner_name="Lakshmi", relationship=mnt.Relationship.WIFE,
        respondent_name="Murugan",
        # router inputs
        offence_date=date(2024, 8, 1),
        proceeding_start_date=None, is_fresh_action=True,
        # statutory trigger
        neglect_or_refusal_pleaded=True,
        # Rajnesh affidavit (petitioner's)
        petitioner_rajnesh_affidavit=True,
        # respondent means / petitioner inability
        respondent_means="the respondent is employed and earns Rs.60,000 per month",
        petitioner_inability="the petitioner has no independent income",
        # quantum
        quantum=25000,
        quantum_basis="one-third of the respondent's monthly income, per the "
                      "standard of living during cohabitation",
        # conditional
        divorced_not_remarried=None,
        child_age=None,
        child_unable_due_to_abnormality=None,
        # court
        jurisdiction_basis="the respondent resides within this court's jurisdiction",
        place="Chennai",
        # LLM slots (3, 6)
        neglect_narrative="",
        quantum_narrative="",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Code framework via the router.
# --------------------------------------------------------------------------

class TestCodeFramework:
    def test_fresh_action_cites_bnss_144(self):
        result = mnt.build(**_base(offence_date=date(2024, 8, 1),
                                   proceeding_start_date=None, is_fresh_action=True))
        assert result.refused is False
        assert "144" in result.context["maintenance_section"]

    def test_pending_pre_appointed_cites_crpc_125(self):
        result = mnt.build(**_base(offence_date=date(2023, 1, 1),
                                   proceeding_start_date=date(2023, 3, 1),
                                   is_fresh_action=False))
        assert result.refused is False
        assert "125" in result.context["maintenance_section"]
        assert "144" not in result.context["maintenance_section"]

    def test_router_refusal_propagates(self):
        result = mnt.build(**_base(offence_date=None))
        assert result.refused is True
        assert result.context is None


# --------------------------------------------------------------------------
# Neglect or refusal — the statutory trigger.
# --------------------------------------------------------------------------

class TestNeglectTrigger:
    def test_pleaded_builds(self):
        result = mnt.build(**_base(neglect_or_refusal_pleaded=True))
        assert result.refused is False

    def test_not_pleaded_refused(self):
        result = mnt.build(**_base(neglect_or_refusal_pleaded=False))
        assert result.refused is True
        assert "neglect" in result.reason.lower() or "refus" in result.reason.lower()


# --------------------------------------------------------------------------
# Rajnesh affidavit — petitioner's is mandatory.
# --------------------------------------------------------------------------

class TestRajneshAffidavit:
    def test_missing_petitioner_affidavit_refused(self):
        result = mnt.build(**_base(petitioner_rajnesh_affidavit=False))
        assert result.refused is True
        assert "rajnesh" in result.reason.lower() or "assets and liabilities" in result.reason.lower()

    def test_present_builds(self):
        result = mnt.build(**_base(petitioner_rajnesh_affidavit=True))
        assert result.refused is False
        assert result.context["petitioner_rajnesh_affidavit"] is True


# --------------------------------------------------------------------------
# Divorced wife — not-remarried averment.
# --------------------------------------------------------------------------

class TestDivorcedWife:
    def test_divorced_wife_without_not_remarried_refused(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.DIVORCED_WIFE,
                                   divorced_not_remarried=None))
        assert result.refused is True
        assert "remarried" in result.reason.lower()

    def test_divorced_wife_with_not_remarried_builds(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.DIVORCED_WIFE,
                                   divorced_not_remarried=True))
        assert result.refused is False

    def test_divorced_wife_who_remarried_refused(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.DIVORCED_WIFE,
                                   divorced_not_remarried=False))
        assert result.refused is True

    def test_non_divorced_wife_needs_no_averment(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.WIFE,
                                   divorced_not_remarried=None))
        assert result.refused is False


# --------------------------------------------------------------------------
# Adult child claimant — only if unable due to abnormality.
# --------------------------------------------------------------------------

class TestAdultChild:
    def test_minor_child_builds(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.CHILD,
                                   child_age=10, child_unable_due_to_abnormality=None))
        assert result.refused is False

    def test_adult_child_without_abnormality_refused(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.CHILD,
                                   child_age=22,
                                   child_unable_due_to_abnormality=False))
        assert result.refused is True
        assert "abnormality" in result.reason.lower() or "18" in result.reason

    def test_adult_child_with_abnormality_builds(self):
        result = mnt.build(**_base(relationship=mnt.Relationship.CHILD,
                                   child_age=22,
                                   child_unable_due_to_abnormality=True))
        assert result.refused is False

    def test_adult_child_boundary_18_needs_abnormality(self):
        """Exactly 18 is an adult claimant -> abnormality required."""
        result = mnt.build(**_base(relationship=mnt.Relationship.CHILD,
                                   child_age=18,
                                   child_unable_due_to_abnormality=False))
        assert result.refused is True


# --------------------------------------------------------------------------
# Quantum — stated computation basis.
# --------------------------------------------------------------------------

class TestQuantum:
    def test_with_basis_builds(self):
        result = mnt.build(**_base(quantum=25000, quantum_basis="one-third of income"))
        assert result.refused is False

    def test_bare_figure_without_basis_refused(self):
        result = mnt.build(**_base(quantum=25000, quantum_basis=""))
        assert result.refused is True
        assert "basis" in result.reason.lower() or "computation" in result.reason.lower()

    def test_zero_quantum_refused(self):
        result = mnt.build(**_base(quantum=0))
        assert result.refused is True


# --------------------------------------------------------------------------
# LLM slots (3, 6).
# --------------------------------------------------------------------------

class TestLlmSlots:
    def test_slots_named_when_empty(self):
        result = mnt.build(**_base(neglect_narrative="", quantum_narrative=""))
        assert result.context["neglect_slot"] == "[to be drafted]"
        assert result.context["quantum_slot"] == "[to be drafted]"

    def test_prewritten_slots_accepted(self):
        result = mnt.build(**_base(neglect_narrative="Since 01-01-2024 ..."))
        assert result.context["neglect_slot"] == "Since 01-01-2024 ..."
