"""Tests for src.rules.jurisdiction — two independent limbs.

PECUNIARY: the suit value against the forum's pecuniary limit. Over the limit ->
REFUSE, and name the correct forum (do not generate for the wrong one).

TERRITORIAL (s.20 CPC): jurisdiction lies where the defendant resides or carries
on business, OR where the cause of action wholly or in part arose. Multiple bases
are fine; NONE is a refusal.

The two limbs are independent — a suit must clear both, but the functions are
separate so the written-statement preliminary-objections stage can invoke either.

Pecuniary limits are VERIFY (advocate review).
"""

import pytest

from src.rules import jurisdiction as jur


# --------------------------------------------------------------------------
# Pecuniary limb.
# --------------------------------------------------------------------------

class TestPecuniary:
    def test_within_limit_ok(self):
        r = jur.check_pecuniary(value=100000, forum=jur.Forum.DISTRICT_MUNSIF)
        assert r.refused is False

    def test_over_limit_refused_and_names_correct_forum(self):
        """Value beyond the forum's limit -> refuse, and name the forum that CAN
        hear it, rather than generating for the wrong court."""
        r = jur.check_pecuniary(value=100_000_000, forum=jur.Forum.DISTRICT_MUNSIF)
        assert r.refused is True
        assert r.correct_forum is not None
        assert r.correct_forum != jur.Forum.DISTRICT_MUNSIF

    def test_at_limit_boundary_ok(self):
        """A value exactly at the forum's ceiling is within jurisdiction."""
        limit = jur.PECUNIARY_LIMITS[jur.Forum.DISTRICT_MUNSIF]
        r = jur.check_pecuniary(value=limit, forum=jur.Forum.DISTRICT_MUNSIF)
        assert r.refused is False

    def test_just_over_limit_refused(self):
        limit = jur.PECUNIARY_LIMITS[jur.Forum.DISTRICT_MUNSIF]
        r = jur.check_pecuniary(value=limit + 1, forum=jur.Forum.DISTRICT_MUNSIF)
        assert r.refused is True

    def test_unlimited_forum_never_refuses(self):
        """A forum with no pecuniary ceiling (e.g. District/City Civil unlimited or
        High Court OS) hears any value."""
        r = jur.check_pecuniary(value=10**12, forum=jur.Forum.DISTRICT_COURT)
        assert r.refused is False


# --------------------------------------------------------------------------
# Territorial limb (s.20 CPC).
# --------------------------------------------------------------------------

class TestTerritorial:
    def test_defendant_residence_basis_ok(self):
        r = jur.check_territorial(bases=[jur.TerritorialBasis.DEFENDANT_RESIDES])
        assert r.refused is False
        assert jur.TerritorialBasis.DEFENDANT_RESIDES in r.bases

    def test_cause_of_action_part_arose_ok(self):
        r = jur.check_territorial(bases=[jur.TerritorialBasis.CAUSE_PART_AROSE])
        assert r.refused is False

    def test_multiple_bases_all_recorded(self):
        r = jur.check_territorial(bases=[
            jur.TerritorialBasis.DEFENDANT_RESIDES,
            jur.TerritorialBasis.CAUSE_PART_AROSE,
        ])
        assert r.refused is False
        assert len(r.bases) == 2

    def test_no_basis_refused(self):
        r = jur.check_territorial(bases=[])
        assert r.refused is True
        assert "territorial" in r.reason.lower() or "s.20" in r.reason

    def test_carries_on_business_basis_ok(self):
        r = jur.check_territorial(bases=[jur.TerritorialBasis.DEFENDANT_BUSINESS])
        assert r.refused is False


# --------------------------------------------------------------------------
# Independence of the two limbs.
# --------------------------------------------------------------------------

class TestIndependence:
    def test_pecuniary_ok_territorial_fail(self):
        pec = jur.check_pecuniary(value=100000, forum=jur.Forum.DISTRICT_MUNSIF)
        ter = jur.check_territorial(bases=[])
        assert pec.refused is False
        assert ter.refused is True

    def test_both_can_be_assessed_separately(self):
        """The written-statement preliminary-objections stage needs each limb
        callable on its own."""
        assert callable(jur.check_pecuniary)
        assert callable(jur.check_territorial)
