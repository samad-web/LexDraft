"""Tests for src.pipelines.writ_petition — Article 226 writ petition (spec 5.1).

Hard checks (each refuses, no partial output):
  - Writ-type <-> relief matching:
      mandamus    needs a legal right + a corresponding public duty + a prior
                  demand and refusal (all three);
      certiorari  needs a quasi-judicial order to quash;
      quo warranto needs a public office.
  - Alternative remedy must be addressed (refuse, not warn — an unaddressed
    alternative remedy is a maintainability failure).
  - Private respondent(s) with no State / public-function respondent -> refuse.
  - Impugned order identified by number AND date, and annexed.
  - Delay explained where the impugned action is not recent (threshold
    CONFIGURABLE — laches has no fixed period).
  - Respondent ordering (authority first) reuses cause_title; no-similar-petition
    reuses the verification writ variant.

LLM slots are paragraphs 3 (facts) and 6 (grounds) only.
"""

from datetime import date

import pytest

from src.pipelines import writ_petition as wp
from src.factsheet import Party, PartyRole


def _petitioner():
    return Party(role=PartyRole.PETITIONER, serial=1, name="Citizen A")


def _authority(serial=1):
    return Party(role=PartyRole.RESPONDENT, serial=serial,
                 name="State of Tamil Nadu", is_authority=True)


def _private(serial=2):
    return Party(role=PartyRole.RESPONDENT, serial=serial, name="Private Co",
                 is_authority=False)


def _base(**over):
    kw = dict(
        petitioner=_petitioner(),
        respondents=[_authority(1), _private(2)],
        court_place="Madras", court_side="Appellate",
        writ_type=wp.WritType.MANDAMUS,
        # mandamus requisites
        legal_right="the petitioner's statutory right to a trade licence",
        public_duty="the respondent's duty under s.15 of the parent Act to decide "
                    "the application",
        prior_demand_and_refusal="represented on 01-02-2024; refused on 15-02-2024",
        quasi_judicial_order=None,
        public_office=None,
        # impugned order
        impugned_order_number="Proceedings No. 45/2024",
        impugned_order_date=date(2024, 2, 15),
        impugned_order_annexed=True,
        # alternative remedy
        alternative_remedy_addressed=True,
        alternative_remedy_basis="the appellate remedy is illusory as the same "
                                 "authority decides the appeal",
        # delay
        impugned_action_recent=True,
        delay_explanation=None,
        laches_threshold_days=90,
        impugned_action_date=date(2024, 2, 15),
        filing_date=date(2024, 3, 1),
        # verification
        petitioner_name="Citizen A",
        no_similar_petition=True,
        place="Chennai", day="1", month="March", year="2024",
        # LLM slots (3, 6)
        facts_narrative="",
        grounds_narrative="",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Writ-type <-> relief matching.
# --------------------------------------------------------------------------

class TestMandamus:
    def test_complete_mandamus_builds(self):
        result = wp.build(**_base(writ_type=wp.WritType.MANDAMUS))
        assert result.refused is False

    def test_mandamus_without_legal_right_refused(self):
        result = wp.build(**_base(writ_type=wp.WritType.MANDAMUS, legal_right=""))
        assert result.refused is True
        assert "right" in result.reason.lower()

    def test_mandamus_without_public_duty_refused(self):
        result = wp.build(**_base(writ_type=wp.WritType.MANDAMUS, public_duty=""))
        assert result.refused is True
        assert "duty" in result.reason.lower()

    def test_mandamus_without_prior_demand_refused(self):
        result = wp.build(**_base(writ_type=wp.WritType.MANDAMUS,
                                  prior_demand_and_refusal=""))
        assert result.refused is True
        assert "demand" in result.reason.lower()


class TestCertiorari:
    def test_certiorari_with_quasi_judicial_order_builds(self):
        result = wp.build(**_base(
            writ_type=wp.WritType.CERTIORARI,
            quasi_judicial_order="the assessment order dated 15-02-2024",
            legal_right="", public_duty="", prior_demand_and_refusal="",
        ))
        assert result.refused is False

    def test_certiorari_without_quasi_judicial_order_refused(self):
        result = wp.build(**_base(
            writ_type=wp.WritType.CERTIORARI, quasi_judicial_order=None,
            legal_right="", public_duty="", prior_demand_and_refusal="",
        ))
        assert result.refused is True
        assert "quasi-judicial" in result.reason.lower() or "order" in result.reason.lower()


class TestQuoWarranto:
    def test_quo_warranto_with_public_office_builds(self):
        result = wp.build(**_base(
            writ_type=wp.WritType.QUO_WARRANTO,
            public_office="the office of Chairman of the statutory Board",
            legal_right="", public_duty="", prior_demand_and_refusal="",
            impugned_order_number="N/A", impugned_order_annexed=True,
        ))
        assert result.refused is False

    def test_quo_warranto_without_public_office_refused(self):
        result = wp.build(**_base(
            writ_type=wp.WritType.QUO_WARRANTO, public_office=None,
            legal_right="", public_duty="", prior_demand_and_refusal="",
        ))
        assert result.refused is True
        assert "office" in result.reason.lower()


# --------------------------------------------------------------------------
# Alternative remedy — refuse, not warn.
# --------------------------------------------------------------------------

class TestAlternativeRemedy:
    def test_unaddressed_alternative_remedy_refused(self):
        result = wp.build(**_base(alternative_remedy_addressed=False))
        assert result.refused is True
        assert result.context is None
        assert "alternative remedy" in result.reason.lower()

    def test_addressed_alternative_remedy_builds(self):
        result = wp.build(**_base(alternative_remedy_addressed=True,
                                  alternative_remedy_basis="no efficacious remedy"))
        assert result.refused is False


# --------------------------------------------------------------------------
# Maintainability — a State / public-function respondent is required.
# --------------------------------------------------------------------------

class TestMaintainability:
    def test_private_respondent_alone_refused(self):
        result = wp.build(**_base(respondents=[_private(1)]))
        assert result.refused is True
        assert "state" in result.reason.lower() or "maintainab" in result.reason.lower()

    def test_at_least_one_authority_ok(self):
        result = wp.build(**_base(respondents=[_authority(1), _private(2)]))
        assert result.refused is False

    def test_public_function_respondent_ok(self):
        """A non-'authority' respondent performing a public function also
        satisfies maintainability."""
        pub = Party(role=PartyRole.RESPONDENT, serial=1, name="Body performing "
                    "public function", is_authority=True)
        result = wp.build(**_base(respondents=[pub]))
        assert result.refused is False


# --------------------------------------------------------------------------
# Respondent ordering — reuses cause_title (authority first).
# --------------------------------------------------------------------------

class TestRespondentOrdering:
    def test_private_before_authority_refused(self):
        result = wp.build(**_base(respondents=[_private(1), _authority(2)]))
        assert result.refused is True
        assert "authority" in result.reason.lower()

    def test_authority_first_ok(self):
        result = wp.build(**_base(respondents=[_authority(1), _private(2)]))
        assert result.refused is False


# --------------------------------------------------------------------------
# Impugned order — number AND date, annexed.
# --------------------------------------------------------------------------

class TestImpugnedOrder:
    def test_missing_number_refused(self):
        result = wp.build(**_base(impugned_order_number=""))
        assert result.refused is True

    def test_missing_date_refused(self):
        result = wp.build(**_base(impugned_order_date=None))
        assert result.refused is True

    def test_not_annexed_refused(self):
        result = wp.build(**_base(impugned_order_annexed=False))
        assert result.refused is True
        assert "annex" in result.reason.lower()


# --------------------------------------------------------------------------
# Delay — explained where not recent; threshold configurable.
# --------------------------------------------------------------------------

class TestDelay:
    def test_recent_action_needs_no_explanation(self):
        result = wp.build(**_base(impugned_action_recent=True,
                                  delay_explanation=None))
        assert result.refused is False

    def test_stale_action_without_explanation_refused(self):
        """Impugned action older than the configurable laches threshold and no
        explanation -> refuse."""
        result = wp.build(**_base(
            impugned_action_recent=False,
            impugned_action_date=date(2023, 1, 1),
            filing_date=date(2024, 3, 1),   # ~14 months later
            laches_threshold_days=90,
            delay_explanation=None,
        ))
        assert result.refused is True
        assert "delay" in result.reason.lower() or "laches" in result.reason.lower()

    def test_stale_action_with_explanation_builds(self):
        result = wp.build(**_base(
            impugned_action_recent=False,
            impugned_action_date=date(2023, 1, 1),
            filing_date=date(2024, 3, 1),
            laches_threshold_days=90,
            delay_explanation="the petitioner discovered the order only recently on "
                              "obtaining certified copies",
        ))
        assert result.refused is False

    def test_threshold_is_configurable(self):
        """A longer threshold can bring the same delay within time without an
        explanation — laches has no fixed period."""
        result = wp.build(**_base(
            impugned_action_recent=False,
            impugned_action_date=date(2023, 12, 1),
            filing_date=date(2024, 3, 1),   # ~90 days
            laches_threshold_days=3650,     # 10 years — very permissive
            delay_explanation=None,
        ))
        assert result.refused is False


# --------------------------------------------------------------------------
# Verification — no-similar-petition (reuses verification writ variant).
# --------------------------------------------------------------------------

class TestVerification:
    def test_missing_no_similar_petition_refused(self):
        result = wp.build(**_base(no_similar_petition=False))
        assert result.refused is True
        assert "similar-petition" in result.reason.lower() or "similar petition" in result.reason.lower()

    def test_declaration_present_builds(self):
        result = wp.build(**_base(no_similar_petition=True))
        assert result.refused is False
        assert result.context["no_similar_petition"] is True


# --------------------------------------------------------------------------
# LLM slots (3, 6).
# --------------------------------------------------------------------------

class TestLlmSlots:
    def test_facts_and_grounds_named_when_empty(self):
        result = wp.build(**_base(facts_narrative="", grounds_narrative=""))
        assert result.context["facts_slot"] == "[to be drafted]"
        assert result.context["grounds_slot"] == "[to be drafted]"

    def test_prewritten_slots_accepted(self):
        result = wp.build(**_base(facts_narrative="On 01-01-2024 ...",
                                  grounds_narrative="A. The order is ultra vires ..."))
        assert result.context["facts_slot"] == "On 01-01-2024 ..."
        assert result.context["grounds_slot"].startswith("A.")


# --------------------------------------------------------------------------
# Grounds are LETTERED (A, B, C) by code — writ practice, not numbered.
# --------------------------------------------------------------------------

class TestLetteredGrounds:
    def test_grounds_list_lettered_by_code(self):
        result = wp.build(**_base(grounds_list=[
            "The order is ultra vires the parent statute.",
            "The order violates natural justice — no hearing.",
            "The order is non-speaking.",
        ]))
        letters = [g["letter"] for g in result.context["lettered_grounds"]]
        assert letters == ["A", "B", "C"]

    def test_lettered_grounds_carry_text(self):
        result = wp.build(**_base(grounds_list=["Ultra vires.", "Mala fides."]))
        assert result.context["lettered_grounds"][1]["text"] == "Mala fides."

    def test_no_grounds_list_falls_back_to_slot(self):
        result = wp.build(**_base(grounds_list=None, grounds_narrative=""))
        assert result.context["lettered_grounds"] == []
        assert result.context["grounds_slot"] == "[to be drafted]"

    def test_lettering_past_z_double_letters(self):
        """Regression guard: 27 grounds -> the 27th is 'AA', not a crash."""
        result = wp.build(**_base(grounds_list=[f"ground {i}" for i in range(27)]))
        assert result.context["lettered_grounds"][26]["letter"] == "AA"
