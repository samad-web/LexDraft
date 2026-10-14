"""Tests for src.pipelines.dv_application — DV Act s.12 application (spec 6.4).

Hard checks (each refuses, no partial output):
  - Domestic relationship is the JURISDICTIONAL FACT — pleaded expressly or refuse.
  - Shared household must be pleaded if a residence order under s.19 is sought.
  - Each relief head (s.18/19/20/21/22) needs supporting averments; a relief
    sought without support is REFUSED, not flagged — same rule as the prayer engine.
  - Abuse instances dated where possible, categorised.

LLM slot at paragraph 4 (domestic incidents) only.
"""

import pytest

from src.pipelines import dv_application as dv


def _incident(category=dv.AbuseCategory.PHYSICAL, date_str="2024-03-01",
              description="the respondent struck the aggrieved person"):
    return dv.AbuseIncident(category=category, date=date_str, description=description)


def _relief(head, supported=True):
    return dv.ReliefSought(
        head=head,
        averment="supporting averment" if supported else "",
    )


def _base(**over):
    kw = dict(
        aggrieved_name="Priya", respondent_name="Karthik",
        domestic_relationship_pleaded=True,
        domestic_relationship_basis="the parties are married and lived together",
        shared_household_pleaded=True,
        shared_household_particulars="the matrimonial home at 4 Lake Road, Chennai",
        reliefs=[_relief(dv.ReliefHead.PROTECTION_18),
                 _relief(dv.ReliefHead.MONETARY_20)],
        incidents=[_incident()],
        jurisdiction_basis="the aggrieved person resides within this court's "
                           "jurisdiction (s.27)",
        place="Chennai",
        incidents_narrative="",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Domestic relationship — the jurisdictional fact.
# --------------------------------------------------------------------------

class TestDomesticRelationship:
    def test_pleaded_builds(self):
        result = dv.build(**_base(domestic_relationship_pleaded=True))
        assert result.refused is False

    def test_not_pleaded_refused(self):
        result = dv.build(**_base(domestic_relationship_pleaded=False))
        assert result.refused is True
        assert result.context is None
        assert "domestic relationship" in result.reason.lower()

    def test_pleaded_but_no_basis_refused(self):
        result = dv.build(**_base(domestic_relationship_pleaded=True,
                                  domestic_relationship_basis=""))
        assert result.refused is True


# --------------------------------------------------------------------------
# Shared household — required if a residence order is sought.
# --------------------------------------------------------------------------

class TestSharedHousehold:
    def test_residence_order_without_shared_household_refused(self):
        result = dv.build(**_base(
            reliefs=[_relief(dv.ReliefHead.RESIDENCE_19)],
            shared_household_pleaded=False,
        ))
        assert result.refused is True
        assert "shared household" in result.reason.lower()

    def test_residence_order_with_shared_household_builds(self):
        result = dv.build(**_base(
            reliefs=[_relief(dv.ReliefHead.RESIDENCE_19)],
            shared_household_pleaded=True,
            shared_household_particulars="the shared household at 4 Lake Road",
        ))
        assert result.refused is False

    def test_no_residence_order_needs_no_shared_household(self):
        result = dv.build(**_base(
            reliefs=[_relief(dv.ReliefHead.MONETARY_20)],
            shared_household_pleaded=False,
        ))
        assert result.refused is False


# --------------------------------------------------------------------------
# Per-relief-head support — refuse, not flag (prayer-engine rule).
# --------------------------------------------------------------------------

class TestReliefSupport:
    def test_supported_reliefs_build(self):
        result = dv.build(**_base(reliefs=[
            _relief(dv.ReliefHead.PROTECTION_18),
            _relief(dv.ReliefHead.MONETARY_20),
            _relief(dv.ReliefHead.COMPENSATION_22),
        ]))
        assert result.refused is False
        assert len(result.context["reliefs"]) == 3

    def test_unsupported_relief_refused(self):
        result = dv.build(**_base(reliefs=[
            _relief(dv.ReliefHead.PROTECTION_18),
            _relief(dv.ReliefHead.MONETARY_20, supported=False),
        ]))
        assert result.refused is True
        assert result.context is None
        assert "s.20" in result.reason or "monetary" in result.reason.lower()

    def test_no_reliefs_refused(self):
        result = dv.build(**_base(reliefs=[]))
        assert result.refused is True

    def test_custody_relief_head(self):
        result = dv.build(**_base(reliefs=[_relief(dv.ReliefHead.CUSTODY_21)]))
        assert result.refused is False


# --------------------------------------------------------------------------
# Abuse incidents — dated, categorised.
# --------------------------------------------------------------------------

class TestAbuseIncidents:
    def test_categorised_incidents_in_context(self):
        result = dv.build(**_base(incidents=[
            _incident(category=dv.AbuseCategory.PHYSICAL),
            _incident(category=dv.AbuseCategory.ECONOMIC, date_str="2024-04-01"),
        ]))
        cats = [i["category"] for i in result.context["incidents"]]
        assert "physical" in cats
        assert "economic" in cats

    def test_undated_incident_allowed_but_marked(self):
        """Dated 'where possible' — an undated incident is allowed but flagged."""
        result = dv.build(**_base(incidents=[
            _incident(date_str=None, description="ongoing verbal abuse"),
        ]))
        assert result.refused is False
        assert result.context["incidents"][0]["date"] is None

    def test_all_four_categories_available(self):
        assert {c.value for c in dv.AbuseCategory} == {
            "physical", "sexual", "verbal_emotional", "economic"
        }


# --------------------------------------------------------------------------
# LLM slot (para 4).
# --------------------------------------------------------------------------

class TestLlmSlot:
    def test_incidents_narrative_named_when_empty(self):
        result = dv.build(**_base(incidents_narrative=""))
        assert result.context["incidents_slot"] == "[to be drafted]"

    def test_prewritten_narrative_accepted(self):
        result = dv.build(**_base(incidents_narrative="On 01-03-2024 ..."))
        assert result.context["incidents_slot"] == "On 01-03-2024 ..."
