"""Tests for src.pipelines.divorce_contested — contested divorce HMA s.13 (spec 6.1).

Date-math heavy; reuses no rules modules but has its own s.19 HMA jurisdiction
limbs (which differ from s.20 CPC — deliberately not routed through the civil
module).

Checks:
  - s.14 one-year bar from the marriage date: within a year -> DON'T refuse;
    auto-attach the leave application under the s.14 proviso.
  - Ground-specific validation (not generic):
      Cruelty   -> at least one DATED instance; general allegations refuse.
      Desertion -> separation >= 2 years computed, animus deserendi, without
                   consent, without reasonable cause — all four or refuse.
      Adultery  -> a specific instance; co-respondent joined OR non-joinder reason.
  - No collusion, connivance or condonation — all three pleaded expressly.
  - Children mentioned -> custody and maintenance position addressed or refuse.
  - Jurisdiction under s.19 HMA (its own limbs).

LLM slot at paragraph 5 (grounds narrative).
"""

from datetime import date

import pytest

from src.pipelines import divorce_contested as dc


def _base(**over):
    kw = dict(
        petitioner_name="Anita", respondent_name="Rakesh",
        marriage_date=date(2018, 5, 1), marriage_place="Chennai",
        filing_date=date(2024, 5, 1),
        ground=dc.Ground.CRUELTY,
        # cruelty
        cruelty_instances=[dc.DatedInstance(date=date(2023, 1, 10),
                                            description="assaulted the petitioner")],
        # desertion
        separation_since=None, animus_deserendi=None,
        without_consent=None, without_reasonable_cause=None,
        # adultery
        adultery_instance=None, co_respondent_joined=None,
        non_joinder_reason=None,
        # bars
        no_collusion=True, no_connivance=True, no_condonation=True,
        # children
        children=[],
        custody_position=None, maintenance_position=None,
        # jurisdiction (s.19 HMA)
        jurisdiction_basis=dc.Section19Basis.MARRIAGE_SOLEMNISED,
        place="Chennai",
        grounds_narrative="",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# s.14 one-year bar.
# --------------------------------------------------------------------------

class TestOneYearBar:
    def test_beyond_one_year_no_leave(self):
        result = dc.build(**_base(marriage_date=date(2018, 5, 1),
                                  filing_date=date(2024, 5, 1)))
        assert result.refused is False
        assert result.context["leave_required"] is False

    def test_within_one_year_auto_attaches_leave(self):
        """Marriage 2024-01-01, filing 2024-06-01 (<1yr) -> leave attached, NOT
        refused."""
        result = dc.build(**_base(marriage_date=date(2024, 1, 1),
                                  filing_date=date(2024, 6, 1)))
        assert result.refused is False
        assert result.context["leave_required"] is True

    def test_exactly_one_year_boundary(self):
        """Filing exactly one year after marriage is NOT within the bar."""
        result = dc.build(**_base(marriage_date=date(2023, 6, 1),
                                  filing_date=date(2024, 6, 1)))
        assert result.context["leave_required"] is False

    def test_day_before_one_year_needs_leave(self):
        result = dc.build(**_base(marriage_date=date(2023, 6, 1),
                                  filing_date=date(2024, 5, 31)))
        assert result.context["leave_required"] is True


# --------------------------------------------------------------------------
# Cruelty ground.
# --------------------------------------------------------------------------

class TestCruelty:
    def test_dated_instance_builds(self):
        result = dc.build(**_base(
            ground=dc.Ground.CRUELTY,
            cruelty_instances=[dc.DatedInstance(date=date(2023, 1, 10),
                                                description="assault")],
        ))
        assert result.refused is False

    def test_no_instance_refused(self):
        result = dc.build(**_base(ground=dc.Ground.CRUELTY, cruelty_instances=[]))
        assert result.refused is True
        assert "dated instance" in result.reason.lower() or "general" in result.reason.lower()


# --------------------------------------------------------------------------
# Desertion ground — all four elements.
# --------------------------------------------------------------------------

class TestDesertion:
    def _desertion(self, **over):
        kw = dict(
            ground=dc.Ground.DESERTION,
            cruelty_instances=[],
            separation_since=date(2021, 1, 1),  # ~3 years before filing 2024-05-01
            animus_deserendi=True, without_consent=True,
            without_reasonable_cause=True,
        )
        kw.update(over)
        return _base(**kw)

    def test_all_four_elements_builds(self):
        result = dc.build(**self._desertion())
        assert result.refused is False
        assert result.context["separation_years"] >= 2

    def test_under_two_years_refused(self):
        result = dc.build(**self._desertion(separation_since=date(2023, 1, 1)))
        assert result.refused is True
        assert "two years" in result.reason.lower() or "2 year" in result.reason.lower()

    def test_missing_animus_refused(self):
        result = dc.build(**self._desertion(animus_deserendi=False))
        assert result.refused is True
        assert "animus" in result.reason.lower()

    def test_with_consent_refused(self):
        result = dc.build(**self._desertion(without_consent=False))
        assert result.refused is True

    def test_with_reasonable_cause_refused(self):
        result = dc.build(**self._desertion(without_reasonable_cause=False))
        assert result.refused is True

    def test_exactly_two_years_boundary(self):
        """Separation of exactly 2 years satisfies the period."""
        result = dc.build(**self._desertion(separation_since=date(2022, 5, 1)))
        assert result.refused is False


# --------------------------------------------------------------------------
# Adultery ground.
# --------------------------------------------------------------------------

class TestAdultery:
    def _adultery(self, **over):
        kw = dict(
            ground=dc.Ground.ADULTERY, cruelty_instances=[],
            adultery_instance="on 01-06-2023 at a named hotel",
            co_respondent_joined=True, non_joinder_reason=None,
        )
        kw.update(over)
        return _base(**kw)

    def test_instance_and_co_respondent_joined_builds(self):
        result = dc.build(**self._adultery())
        assert result.refused is False

    def test_no_instance_refused(self):
        result = dc.build(**self._adultery(adultery_instance=""))
        assert result.refused is True
        assert "instance" in result.reason.lower()

    def test_co_respondent_not_joined_without_reason_refused(self):
        result = dc.build(**self._adultery(co_respondent_joined=False,
                                           non_joinder_reason=None))
        assert result.refused is True
        assert "co-respondent" in result.reason.lower() or "non-joinder" in result.reason.lower()

    def test_non_joinder_reason_stated_builds(self):
        result = dc.build(**self._adultery(co_respondent_joined=False,
                                           non_joinder_reason="the co-respondent is "
                                                              "dead"))
        assert result.refused is False


# --------------------------------------------------------------------------
# No collusion / connivance / condonation — all three.
# --------------------------------------------------------------------------

class TestBars:
    def test_all_three_pleaded_builds(self):
        result = dc.build(**_base(no_collusion=True, no_connivance=True,
                                  no_condonation=True))
        assert result.refused is False

    def test_missing_collusion_refused(self):
        result = dc.build(**_base(no_collusion=False))
        assert result.refused is True
        assert "collusion" in result.reason.lower()

    def test_missing_connivance_refused(self):
        result = dc.build(**_base(no_connivance=False))
        assert result.refused is True
        assert "connivance" in result.reason.lower()

    def test_missing_condonation_refused(self):
        result = dc.build(**_base(no_condonation=False))
        assert result.refused is True
        assert "condonation" in result.reason.lower()


# --------------------------------------------------------------------------
# Children — custody + maintenance position addressed.
# --------------------------------------------------------------------------

class TestChildren:
    def test_no_children_needs_no_position(self):
        result = dc.build(**_base(children=[]))
        assert result.refused is False

    def test_children_without_custody_position_refused(self):
        result = dc.build(**_base(children=["Minor A"], custody_position=None,
                                  maintenance_position="with the mother"))
        assert result.refused is True
        assert "custody" in result.reason.lower()

    def test_children_without_maintenance_position_refused(self):
        result = dc.build(**_base(children=["Minor A"],
                                  custody_position="with the mother",
                                  maintenance_position=None))
        assert result.refused is True
        assert "maintenance" in result.reason.lower()

    def test_children_with_both_positions_builds(self):
        result = dc.build(**_base(children=["Minor A"],
                                  custody_position="with the mother",
                                  maintenance_position="Rs.10,000 per month"))
        assert result.refused is False


# --------------------------------------------------------------------------
# Jurisdiction — s.19 HMA (own limbs, not s.20 CPC).
# --------------------------------------------------------------------------

class TestJurisdiction:
    def test_s19_basis_in_context(self):
        result = dc.build(**_base(
            jurisdiction_basis=dc.Section19Basis.LAST_RESIDED_TOGETHER))
        assert result.context["jurisdiction_basis"] == "last_resided_together"

    def test_s19_bases_distinct_from_cpc(self):
        """s.19 HMA limbs are HMA-specific, not the CPC territorial bases."""
        values = {b.value for b in dc.Section19Basis}
        assert "marriage_solemnised" in values
        assert "last_resided_together" in values
        # a CPC-only basis must not appear here
        assert "defendant_carries_on_business" not in values


# --------------------------------------------------------------------------
# LLM slot (para 5).
# --------------------------------------------------------------------------

class TestLlmSlot:
    def test_grounds_narrative_named_when_empty(self):
        result = dc.build(**_base(grounds_narrative=""))
        assert result.context["grounds_slot"] == "[to be drafted]"
