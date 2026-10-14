"""Tests for src.rules.bail_bar_detector — statutory bail bars.

Covers the four P0 bars:
  - NDPS  s.37       : twin conditions for bail (applies to REGULAR bail).
  - PMLA  s.45       : twin conditions for bail (REGULAR bail).
  - UAPA  s.43D(5)   : no bail if the accusation is prima facie true (REGULAR).
  - SC/ST s.18 / 18A : bars ANTICIPATORY bail (absorbed from the 3.3 check).

The detector reports which bar applies and to which remedy, plus the mandatory
paragraph the pleading must address head-on. It does NOT decide whether the bar
is satisfied on the merits (that is the court's) — it flags that the bar must be
addressed, and for the anticipatory SC/ST bar it refuses outright.

VERIFY: statute list and section numbers are indicative; advocate review.
"""

import pytest

from src.rules import bail_bar_detector as bars


class TestRegularBailBars:
    def test_ndps_triggers_regular_bar(self):
        r = bars.detect(statute=bars.Statute.NDPS, remedy=bars.Remedy.REGULAR)
        assert r.bar_applies is True
        assert r.section == "s.37 NDPS"
        assert r.mandatory_paragraph is True   # must address the bar head-on
        assert r.refused is False              # regular bail is not barred outright

    def test_pmla_triggers_regular_bar(self):
        r = bars.detect(statute=bars.Statute.PMLA, remedy=bars.Remedy.REGULAR)
        assert r.bar_applies is True
        assert r.section == "s.45 PMLA"
        assert r.mandatory_paragraph is True

    def test_uapa_triggers_regular_bar(self):
        r = bars.detect(statute=bars.Statute.UAPA, remedy=bars.Remedy.REGULAR)
        assert r.bar_applies is True
        assert r.section == "s.43D(5) UAPA"
        assert r.mandatory_paragraph is True

    def test_no_special_statute_no_bar(self):
        r = bars.detect(statute=None, remedy=bars.Remedy.REGULAR)
        assert r.bar_applies is False
        assert r.mandatory_paragraph is False


class TestEachBarHasOwnTest:
    """NDPS s.37 and PMLA s.45 are TWIN-CONDITION tests; UAPA s.43D(5) is a
    DIFFERENT test — no bail if the accusation is prima facie true. A single
    paragraph shape would address the wrong test for UAPA, so each bar carries
    its own test_kind and its own paragraph_text."""

    def test_ndps_is_twin_conditions(self):
        r = bars.detect(statute=bars.Statute.NDPS, remedy=bars.Remedy.REGULAR)
        assert r.test_kind == bars.BarTest.TWIN_CONDITIONS
        assert "reasonable grounds" in r.paragraph_text.lower()
        assert "not" in r.paragraph_text.lower()  # not guilty / not reoffend

    def test_pmla_is_twin_conditions(self):
        r = bars.detect(statute=bars.Statute.PMLA, remedy=bars.Remedy.REGULAR)
        assert r.test_kind == bars.BarTest.TWIN_CONDITIONS
        assert "reasonable grounds" in r.paragraph_text.lower()

    def test_uapa_is_prima_facie_true_not_twin(self):
        r = bars.detect(statute=bars.Statute.UAPA, remedy=bars.Remedy.REGULAR)
        assert r.test_kind == bars.BarTest.PRIMA_FACIE_TRUE
        assert r.test_kind != bars.BarTest.TWIN_CONDITIONS
        assert "prima facie" in r.paragraph_text.lower()
        # The UAPA paragraph must NOT recite the twin-condition test.
        assert "reasonable grounds for believing" not in r.paragraph_text.lower()

    def test_ndps_and_uapa_paragraphs_differ(self):
        ndps = bars.detect(statute=bars.Statute.NDPS, remedy=bars.Remedy.REGULAR)
        uapa = bars.detect(statute=bars.Statute.UAPA, remedy=bars.Remedy.REGULAR)
        assert ndps.paragraph_text != uapa.paragraph_text


class TestScStAnticipatoryBar:
    def test_scst_bars_anticipatory_outright(self):
        r = bars.detect(statute=bars.Statute.SCST, remedy=bars.Remedy.ANTICIPATORY)
        assert r.bar_applies is True
        assert r.refused is True               # anticipatory bail is barred
        assert "18" in r.section

    def test_scst_on_regular_bail_not_an_outright_bar(self):
        """SC/ST bars anticipatory bail, not regular bail. On a regular-bail
        remedy it does not refuse outright."""
        r = bars.detect(statute=bars.Statute.SCST, remedy=bars.Remedy.REGULAR)
        assert r.refused is False


class TestRemedyMismatch:
    def test_ndps_on_anticipatory_flags_bar_not_refuse(self):
        """NDPS s.37's threshold governs bail generally; on an anticipatory remedy
        it is a mandatory paragraph, not an outright anticipatory refusal (the
        SC/ST outright bar is the only anticipatory-specific refusal here)."""
        r = bars.detect(statute=bars.Statute.NDPS, remedy=bars.Remedy.ANTICIPATORY)
        assert r.bar_applies is True
        assert r.refused is False
        assert r.mandatory_paragraph is True
