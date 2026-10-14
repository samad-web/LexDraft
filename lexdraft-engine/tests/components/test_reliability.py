"""Tests for src.components.reliability — per-paragraph reliability annotation.

Generalises the MACT unverified marker into a reliability layer every document
can carry. Each annotated paragraph is one of:
  CERTAIN         template + deterministic rules — machine-certain.
  LLM_SLOT        narrative the model writes ([to be drafted] slots).
  VERIFY_DEPENDENT a figure/section that depends on a VERIFY table (court fee,
                   compensation multiplier, section mapping).

The annotation renders as a margin/footer note and is TOGGLEABLE — the final
filed version renders clean (no notes).
"""

import pytest

from src.components import reliability as rel


def _report():
    return rel.ReliabilityReport(items=[
        rel.Para(number="1", level=rel.Level.CERTAIN),
        rel.Para(number="3", level=rel.Level.LLM_SLOT),
        rel.Para(number="7", level=rel.Level.VERIFY_DEPENDENT,
                 note="multiplier from Sarla Verma table"),
    ])


class TestLevels:
    def test_three_levels_exist(self):
        assert {l.name for l in rel.Level} >= {"CERTAIN", "LLM_SLOT", "VERIFY_DEPENDENT"}

    def test_certain_needs_no_review(self):
        assert rel.Level.CERTAIN.needs_review is False

    def test_llm_and_verify_need_review(self):
        assert rel.Level.LLM_SLOT.needs_review is True
        assert rel.Level.VERIFY_DEPENDENT.needs_review is True


class TestReport:
    def test_paras_needing_review(self):
        r = _report()
        needing = [p.number for p in r.needs_review()]
        assert needing == ["3", "7"]

    def test_all_certain_is_filing_clean(self):
        r = rel.ReliabilityReport(items=[
            rel.Para(number="1", level=rel.Level.CERTAIN),
            rel.Para(number="2", level=rel.Level.CERTAIN),
        ])
        assert r.machine_certain is True

    def test_any_review_item_not_machine_certain(self):
        assert _report().machine_certain is False

    def test_counts_by_level(self):
        counts = _report().counts()
        assert counts[rel.Level.CERTAIN] == 1
        assert counts[rel.Level.LLM_SLOT] == 1
        assert counts[rel.Level.VERIFY_DEPENDENT] == 1


class TestToggle:
    def test_annotations_on_produces_notes(self):
        ctx = rel.annotate_context({"foo": "bar"}, _report(), show=True)
        assert ctx["reliability_show"] is True
        assert ctx["reliability_notes"]           # non-empty note list
        # original context preserved
        assert ctx["foo"] == "bar"

    def test_annotations_off_renders_clean(self):
        ctx = rel.annotate_context({"foo": "bar"}, _report(), show=False)
        assert ctx["reliability_show"] is False
        assert ctx["reliability_notes"] == []

    def test_notes_reference_paragraph_numbers(self):
        ctx = rel.annotate_context({}, _report(), show=True)
        joined = " ".join(n["text"] for n in ctx["reliability_notes"])
        assert "3" in joined and "7" in joined

    def test_verify_note_carried_through(self):
        ctx = rel.annotate_context({}, _report(), show=True)
        verify_notes = [n for n in ctx["reliability_notes"]
                        if n["level"] == "verify_dependent"]
        assert any("Sarla Verma" in n["text"] for n in verify_notes)


class TestFromContextFlags:
    def test_infers_llm_slots_from_placeholder(self):
        """A helper can infer LLM_SLOT paras from the [to be drafted] marker in a
        context, so pipelines need not hand-annotate every slot."""
        report = rel.infer_from_context({
            "para_3": "[to be drafted]",
            "para_4": "actual pleaded content",
        }, verify_dependent_paras={"8"})
        levels = {p.number: p.level for p in report.items}
        assert levels.get("3") == rel.Level.LLM_SLOT
        assert levels.get("8") == rel.Level.VERIFY_DEPENDENT
