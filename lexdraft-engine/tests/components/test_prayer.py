"""Tests for src.components.prayer — the prayer clause engine (spec 1.5).

Prayer is generated from the relief set, not free text. THE RULE: every
relief.type must have a matching cause_of_action in the fact sheet. Unmatched
relief is REFUSED, not printed with a flag.

Standard closers per proceeding kind are appended by code.
"""

import pytest

from src.components import prayer as pr


def _relief(rtype, **over):
    kw = dict(type=rtype, description=f"{rtype} relief", against_party="Defendant",
              is_interim=False, is_alternative=False)
    kw.update(over)
    return pr.Relief(**kw)


class TestCauseOfActionMatching:
    def test_matched_relief_prints(self):
        result = pr.build(
            reliefs=[_relief("recovery_of_money")],
            causes_of_action=["recovery_of_money"],
            proceeding=pr.Proceeding.CIVIL,
        )
        assert result.refused is False
        assert len(result.reliefs) == 1

    def test_unmatched_relief_refused_not_flagged(self):
        """A relief with no matching cause of action refuses the whole prayer —
        it is NOT printed with a warning."""
        result = pr.build(
            reliefs=[_relief("recovery_of_money"), _relief("injunction")],
            causes_of_action=["recovery_of_money"],  # no 'injunction' CoA
            proceeding=pr.Proceeding.CIVIL,
        )
        assert result.refused is True
        assert result.may_generate is False
        assert "injunction" in result.reason.lower()
        # Nothing partial is emitted.
        assert result.context is None

    def test_all_reliefs_must_match(self):
        result = pr.build(
            reliefs=[_relief("a"), _relief("b"), _relief("c")],
            causes_of_action=["a", "b", "c"],
            proceeding=pr.Proceeding.CIVIL,
        )
        assert result.refused is False

    def test_empty_relief_set_refused(self):
        """A prayer with no relief is not a prayer."""
        result = pr.build(
            reliefs=[],
            causes_of_action=["recovery_of_money"],
            proceeding=pr.Proceeding.CIVIL,
        )
        assert result.refused is True


class TestClosers:
    def test_civil_closer(self):
        result = pr.build(reliefs=[_relief("recovery")],
                          causes_of_action=["recovery"],
                          proceeding=pr.Proceeding.CIVIL)
        assert "render justice" in result.context["closer"]
        assert "other and further orders" in result.context["closer"]

    def test_writ_closer(self):
        result = pr.build(reliefs=[_relief("mandamus")],
                          causes_of_action=["mandamus"],
                          proceeding=pr.Proceeding.WRIT)
        assert "order or direction" in result.context["closer"]

    def test_criminal_closer(self):
        result = pr.build(reliefs=[_relief("quash")],
                          causes_of_action=["quash"],
                          proceeding=pr.Proceeding.CRIMINAL)
        assert result.context["closer"].strip().endswith("render justice.")


class TestReliefStructure:
    def test_interim_and_alternative_flags_preserved(self):
        result = pr.build(
            reliefs=[_relief("stay", is_interim=True),
                     _relief("recovery", is_alternative=True)],
            causes_of_action=["stay", "recovery"],
            proceeding=pr.Proceeding.CIVIL,
        )
        assert result.context["reliefs"][0]["is_interim"] is True
        assert result.context["reliefs"][1]["is_alternative"] is True

    def test_reliefs_numbered_by_code(self):
        result = pr.build(
            reliefs=[_relief("a"), _relief("b")],
            causes_of_action=["a", "b"],
            proceeding=pr.Proceeding.CIVIL,
        )
        assert [r["number"] for r in result.context["reliefs"]] == [1, 2]
