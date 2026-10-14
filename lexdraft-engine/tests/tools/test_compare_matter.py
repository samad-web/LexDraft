"""Tests for tools.compare_matter — the section-level comparison harness.

This is a MEASUREMENT tool: run a real closed matter through the engine and diff
our output against what was actually filed. It never auto-fixes.

Tested here: section parsing, section alignment, per-section classification
(MISSING / EXTRA / DIFFERENT / FORMATTING), and cross-matter aggregation. The
.docx/PDF reading is a thin wrapper reused from the render helpers; the tests
drive the diff core directly on section lists.

MISSING is the important classification: something a real advocate pleaded that
the engine does not generate is a gap in the mandatory-averment lists.
"""

import pytest

from tools import compare_matter as cm


def _sec(kind, text, key=None):
    return cm.Section(kind=kind, key=key, text=text)


# --------------------------------------------------------------------------
# Section parsing.
# --------------------------------------------------------------------------

class TestParsing:
    def test_splits_numbered_paragraphs(self):
        text = ("IN THE COURT OF X\n\n"
                "1. First paragraph.\n"
                "2. Second paragraph.\n"
                "VERIFICATION\nI, A, verify ...")
        secs = cm.parse_sections(text)
        kinds = [s.kind for s in secs]
        assert cm.SectionKind.PARAGRAPH in kinds
        assert cm.SectionKind.VERIFICATION in kinds

    def test_paragraph_keyed_by_number(self):
        secs = cm.parse_sections("1. Alpha.\n2. Beta.")
        paras = {s.key: s.text for s in secs if s.kind is cm.SectionKind.PARAGRAPH}
        assert paras["1"].startswith("Alpha")
        assert paras["2"].startswith("Beta")

    def test_cause_title_detected(self):
        secs = cm.parse_sections("IN THE HIGH COURT OF JUDICATURE AT MADRAS\n\n1. X.")
        assert any(s.kind is cm.SectionKind.CAUSE_TITLE for s in secs)

    def test_prayer_detected(self):
        secs = cm.parse_sections("1. X.\nPRAYER: it is prayed that ...")
        assert any(s.kind is cm.SectionKind.PRAYER for s in secs)


# --------------------------------------------------------------------------
# Classification — MISSING / EXTRA / DIFFERENT / FORMATTING.
# --------------------------------------------------------------------------

class TestClassification:
    def test_missing_in_filed_not_ours(self):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1"),
                 _sec(cm.SectionKind.PARAGRAPH, "A limitation averment.", key="2")]
        diff = cm.diff_sections(ours=ours, filed=filed)
        missing = [d for d in diff if d.classification is cm.Classification.MISSING]
        assert len(missing) == 1
        assert missing[0].key == "2"

    def test_extra_in_ours_not_filed(self):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1"),
                _sec(cm.SectionKind.PARAGRAPH, "An extra paragraph.", key="2")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1")]
        diff = cm.diff_sections(ours=ours, filed=filed)
        extra = [d for d in diff if d.classification is cm.Classification.EXTRA]
        assert len(extra) == 1

    def test_formatting_only_difference(self):
        """Same content, different whitespace/case/punctuation -> FORMATTING."""
        ours = [_sec(cm.SectionKind.PARAGRAPH, "The cause of action arose.", key="1")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "the  cause of action arose", key="1")]
        diff = cm.diff_sections(ours=ours, filed=filed)
        assert diff[0].classification is cm.Classification.FORMATTING

    def test_material_difference(self):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Interest at 12% per annum.", key="1")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Interest at 18% per annum.", key="1")]
        diff = cm.diff_sections(ours=ours, filed=filed)
        assert diff[0].classification is cm.Classification.DIFFERENT

    def test_identical_sections_no_diff_entry(self):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Identical text.", key="1")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Identical text.", key="1")]
        diff = cm.diff_sections(ours=ours, filed=filed)
        material = [d for d in diff
                    if d.classification is not cm.Classification.SAME]
        assert material == []


# --------------------------------------------------------------------------
# Per-matter summary.
# --------------------------------------------------------------------------

class TestMatterSummary:
    def test_summary_counts_by_classification(self):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1"),
                _sec(cm.SectionKind.PARAGRAPH, "extra", key="9")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1"),
                 _sec(cm.SectionKind.PARAGRAPH, "a missing averment", key="2")]
        summary = cm.compare_matter(matter_id="M1", ours=ours, filed=filed)
        assert summary.counts[cm.Classification.MISSING] == 1
        assert summary.counts[cm.Classification.EXTRA] == 1

    def test_summary_lists_missing_text(self):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Alpha", key="1"),
                 _sec(cm.SectionKind.PARAGRAPH, "s.80 CPC notice averment", key="2")]
        summary = cm.compare_matter(matter_id="M1", ours=ours, filed=filed)
        missing_texts = [d.filed_text for d in summary.diffs
                         if d.classification is cm.Classification.MISSING]
        assert any("s.80" in t for t in missing_texts)


# --------------------------------------------------------------------------
# Cross-matter aggregation — recurring MISSING as a pattern.
# --------------------------------------------------------------------------

class TestAggregation:
    def _matter(self, mid, missing_text):
        ours = [_sec(cm.SectionKind.PARAGRAPH, "Common", key="1")]
        filed = [_sec(cm.SectionKind.PARAGRAPH, "Common", key="1"),
                 _sec(cm.SectionKind.PARAGRAPH, missing_text, key="2")]
        return cm.compare_matter(matter_id=mid, ours=ours, filed=filed)

    def test_recurring_missing_surfaced(self):
        """The same MISSING averment across three matters is a pattern."""
        matters = [
            self._matter("M1", "no-similar-petition declaration"),
            self._matter("M2", "no-similar-petition declaration"),
            self._matter("M3", "no-similar-petition declaration"),
        ]
        agg = cm.aggregate(matters)
        top = agg.recurring_missing()
        assert top[0].count == 3
        assert "no-similar-petition" in top[0].text.lower()

    def test_one_off_missing_ranked_below_recurring(self):
        matters = [
            self._matter("M1", "recurring gap"),
            self._matter("M2", "recurring gap"),
            self._matter("M3", "one-off gap"),
        ]
        agg = cm.aggregate(matters)
        top = agg.recurring_missing()
        assert top[0].count == 2
        assert top[0].text == "recurring gap"

    def test_aggregate_totals(self):
        matters = [self._matter("M1", "g"), self._matter("M2", "g")]
        agg = cm.aggregate(matters)
        assert agg.total(cm.Classification.MISSING) == 2
        assert agg.matter_count == 2


# --------------------------------------------------------------------------
# Measurement only — no auto-fix.
# --------------------------------------------------------------------------

class TestNoAutoFix:
    def test_harness_exposes_no_fix_entrypoint(self):
        assert not hasattr(cm, "apply_fix")
        assert not hasattr(cm, "autofix")
