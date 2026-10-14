"""Tests for src.pipelines.anticipatory_bail — anticipatory bail (spec 3.3).

Apprehension replaces custody. Validation:
  - Must state a REASONABLE APPREHENSION — a bare assertion is refused.
  - SC/ST Act s.18 / 18A bar -> refuse with explanation (delegated to
    custody_computation.assess_anticipatory_bail).
  - Already arrested -> route to regular bail, do not generate.
  - Transit anticipatory bail -> add a jurisdiction paragraph.

The [LLM] prosecution-case paragraph is a named empty slot; this layer calls no
LLM.
"""

from datetime import date

import pytest

from src.pipelines import anticipatory_bail as ab


def _base(**over):
    kw = dict(
        accused_name="Selvam", age=40, occupation="contractor",
        address="9 West St, Chennai",
        fir_no="88/2024", police_station="Guindy", district="Chennai",
        sections=["BNS s.318"],
        offence_date=date(2024, 8, 1),
        proceeding_start_date=None,
        is_fresh_action=True,
        apprehension_basis="the complainant has publicly threatened arrest and the "
                           "FIR names the applicant on a civil property dispute",
        already_arrested=False,
        is_scst_offence=False,
        is_transit=False,
        prosecution_case="",  # LLM slot, left empty
        place="Chennai",
    )
    kw.update(over)
    return kw


class TestCodeFrameworkFromRouter:
    """The framework comes from the dual-code router, not the caller. An
    anticipatory-bail move is almost always a fresh action -> BNSS."""

    def test_router_refusal_propagates(self):
        result = ab.build(**_base(offence_date=None))
        assert result.refused is True
        assert result.context is None

    def test_fresh_action_cites_bnss(self):
        result = ab.build(**_base(offence_date=date(2023, 1, 1),
                                  proceeding_start_date=None, is_fresh_action=True))
        assert result.refused is False
        assert "482" in result.context["anticipatory_bail_section"]

    def test_pending_pre_appointed_cites_crpc(self):
        result = ab.build(**_base(offence_date=date(2023, 1, 1),
                                  proceeding_start_date=date(2023, 3, 1),
                                  is_fresh_action=False))
        assert result.refused is False
        assert "438" in result.context["anticipatory_bail_section"]
        assert "482" not in result.context["anticipatory_bail_section"]


class TestReasonableApprehension:
    def test_stated_apprehension_builds(self):
        result = ab.build(**_base())
        assert result.refused is False
        assert result.context is not None

    def test_bare_assertion_refused(self):
        """An empty / boilerplate apprehension basis is refused — the section
        requires a reason to believe arrest is apprehended."""
        result = ab.build(**_base(apprehension_basis=""))
        assert result.refused is True
        assert result.context is None
        assert "apprehension" in result.reason.lower()

    def test_whitespace_only_apprehension_refused(self):
        result = ab.build(**_base(apprehension_basis="   "))
        assert result.refused is True


class TestScStBar:
    def test_scst_offence_refused_with_explanation(self):
        result = ab.build(**_base(is_scst_offence=True))
        assert result.refused is True
        assert result.may_generate is False
        assert "18" in result.reason

    def test_non_scst_ok(self):
        result = ab.build(**_base(is_scst_offence=False))
        assert result.refused is False


class TestAlreadyArrested:
    def test_already_arrested_routes_to_regular(self):
        result = ab.build(**_base(already_arrested=True))
        assert result.refused is True
        assert result.route_to == "regular_bail"
        assert result.context is None

    def test_arrested_takes_precedence_over_scst(self):
        result = ab.build(**_base(already_arrested=True, is_scst_offence=True))
        assert result.route_to == "regular_bail"


class TestTransit:
    def test_transit_adds_jurisdiction_paragraph(self):
        result = ab.build(**_base(is_transit=True))
        assert result.refused is False
        assert result.context["is_transit"] is True
        assert result.context["jurisdiction_paragraph"] is True

    def test_non_transit_no_jurisdiction_paragraph(self):
        result = ab.build(**_base(is_transit=False))
        assert result.context["jurisdiction_paragraph"] is False


class TestLlmSlot:
    def test_prosecution_case_is_named_empty_slot(self):
        result = ab.build(**_base(prosecution_case=""))
        assert result.context["prosecution_case_slot"] == "[to be drafted]"

    def test_prewritten_narrative_accepted(self):
        result = ab.build(**_base(prosecution_case="The FIR alleges X."))
        assert result.context["prosecution_case_slot"] == "The FIR alleges X."
