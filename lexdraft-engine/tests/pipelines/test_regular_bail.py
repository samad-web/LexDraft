"""Tests for src.pipelines.regular_bail — regular bail application (spec 3.2).

Consumes:
  - dual_code_router: the three inputs resolve code_framework (bail is procedural).
    A router refusal (e.g. pending proceeding, unknown start date) refuses the doc.
  - bail_bar_detector: a special statute makes the bail-bar paragraph MANDATORY;
    the pipeline blocks if the caller has not addressed it.

Spec 3.2 validations:
  - Custody days recomputed from custody_since at generation time, never stale.
  - Special statute detected -> bail-bar paragraph mandatory, block if absent.
  - Successive application -> prior order reference mandatory.
  - Parity claims require an order reference; unreferenced parity refused.

The [LLM] prosecution-case and grounds paragraphs are named empty slots.
"""

from datetime import date

import pytest

from src.pipelines import regular_bail as rb
from src.rules import bail_bar_detector as bars


def _base(**over):
    kw = dict(
        accused_name="Arun", age=29, occupation="mechanic",
        address="3 Lake View, Chennai",
        fir_no="55/2024", police_station="Adyar", district="Chennai",
        sections=["BNS s.115"],
        # router inputs
        offence_date=date(2024, 8, 1),
        proceeding_start_date=date(2024, 8, 5),
        is_fresh_action=False,
        # custody
        custody_since=date(2024, 8, 10),
        as_on=date(2024, 9, 10),
        prison="Puzhal Central Prison",
        chargesheet_filed=True,
        # special statute / bars
        special_statute=None,
        bail_bar_addressed=False,
        # successive
        is_successive=False,
        prior_order_ref=None,
        change_of_circumstance=None,
        # parity
        parity_claims=[],
        # court
        court_level="sessions",
        prosecution_case="",
        grounds="",
        place="Chennai",
    )
    kw.update(over)
    return kw


class TestRouterIntegration:
    def test_code_framework_from_router_bnss(self):
        result = rb.build(**_base(offence_date=date(2024, 8, 1),
                                  proceeding_start_date=date(2024, 8, 5),
                                  is_fresh_action=False))
        assert result.refused is False
        assert result.context["code_framework"] == "bnss"

    def test_pending_old_proceeding_is_crpc(self):
        result = rb.build(**_base(offence_date=date(2023, 1, 1),
                                  proceeding_start_date=date(2023, 3, 1),
                                  is_fresh_action=False))
        assert result.context["code_framework"] == "crpc"

    def test_router_refusal_refuses_document(self):
        """Pending proceeding with unknown start date -> router refuses ->
        document refuses (unknown provenance is not guessed)."""
        result = rb.build(**_base(proceeding_start_date=None, is_fresh_action=False))
        assert result.refused is True
        assert result.context is None
        assert "provenance" in result.reason.lower() or "start date" in result.reason.lower()


class TestCustodyRecompute:
    def test_custody_recomputed_from_custody_since(self):
        r1 = rb.build(**_base(as_on=date(2024, 9, 10)))
        r2 = rb.build(**_base(as_on=date(2024, 9, 20)))
        assert r2.context["custody_days"] == r1.context["custody_days"] + 10

    def test_custody_days_inclusive(self):
        result = rb.build(**_base(custody_since=date(2024, 8, 10),
                                  as_on=date(2024, 8, 10)))
        assert result.context["custody_days"] == 1


class TestSpecialStatuteBar:
    def test_special_statute_without_addressed_bar_blocked(self):
        result = rb.build(**_base(special_statute=bars.Statute.NDPS,
                                  bail_bar_addressed=False))
        assert result.refused is True
        assert result.context is None
        assert "bar" in result.reason.lower()
        assert "37" in result.reason  # s.37 NDPS

    def test_special_statute_with_addressed_bar_builds(self):
        result = rb.build(**_base(special_statute=bars.Statute.NDPS,
                                  bail_bar_addressed=True))
        assert result.refused is False
        assert result.context["bail_bar_paragraph"] is True
        assert result.context["bail_bar_section"] == "s.37 NDPS"

    def test_no_special_statute_no_bail_bar_paragraph(self):
        result = rb.build(**_base(special_statute=None))
        assert result.refused is False
        assert result.context["bail_bar_paragraph"] is False


class TestSuccessiveApplication:
    def test_successive_without_prior_order_ref_blocked(self):
        result = rb.build(**_base(is_successive=True, prior_order_ref=None,
                                  change_of_circumstance="new medical ground"))
        assert result.refused is True
        assert "prior order" in result.reason.lower()

    def test_successive_without_change_of_circumstance_blocked(self):
        result = rb.build(**_base(is_successive=True,
                                  prior_order_ref="Crl.M.P. 100/2024 dismissed 01-08-2024",
                                  change_of_circumstance=None))
        assert result.refused is True
        assert "change" in result.reason.lower()

    def test_successive_complete_builds(self):
        result = rb.build(**_base(
            is_successive=True,
            prior_order_ref="Crl.M.P. 100/2024 dismissed 01-08-2024",
            change_of_circumstance="investigation now complete; chargesheet filed",
        ))
        assert result.refused is False
        assert result.context["is_successive"] is True
        assert result.context["prior_order_ref"]

    def test_first_application_needs_no_prior_order(self):
        result = rb.build(**_base(is_successive=False))
        assert result.refused is False


class TestParity:
    def test_parity_with_order_ref_builds(self):
        result = rb.build(**_base(parity_claims=[
            {"co_accused": "Ravi", "order_ref": "Crl.M.P. 90/2024 dated 20-08-2024"},
        ]))
        assert result.refused is False
        assert len(result.context["parity_claims"]) == 1

    def test_unreferenced_parity_refused(self):
        """A parity claim without an order reference is refused — not printed."""
        result = rb.build(**_base(parity_claims=[
            {"co_accused": "Ravi", "order_ref": None},
        ]))
        assert result.refused is True
        assert result.context is None
        assert "parity" in result.reason.lower()

    def test_empty_parity_ok(self):
        result = rb.build(**_base(parity_claims=[]))
        assert result.refused is False


class TestLlmSlots:
    def test_narrative_slots_named_when_empty(self):
        result = rb.build(**_base(prosecution_case="", grounds=""))
        assert result.context["prosecution_case_slot"] == "[to be drafted]"
        assert result.context["grounds_slot"] == "[to be drafted]"

    def test_prewritten_narrative_accepted(self):
        result = rb.build(**_base(prosecution_case="The FIR alleges X.",
                                  grounds="(a) no overt act ..."))
        assert result.context["prosecution_case_slot"] == "The FIR alleges X."
        assert result.context["grounds_slot"].startswith("(a)")


class TestMandatoryContent:
    def test_undertaking_present(self):
        result = rb.build(**_base())
        assert result.context["undertaking"] is True

    def test_custody_and_chargesheet_status_stated(self):
        result = rb.build(**_base(chargesheet_filed=True))
        assert "custody_days" in result.context
        assert result.context["chargesheet_filed"] is True
