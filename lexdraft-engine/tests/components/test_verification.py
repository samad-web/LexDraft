"""Tests for src.components.verification — clause + set-coverage validation.

Spec 1.2. Verification validation is a SET-COVERAGE check:
  - knowledge_paras ∪ belief_paras must equal the full paragraph range
    (1..total) — no paragraph left unverified (no gaps).
  - knowledge_paras ∩ belief_paras must be empty — no paragraph in both.
  - Writ verification must carry the no-similar-petition declaration.
  - Commercial suits carry BOTH verification and statement of truth.

Coverage failures REFUSE (an Assessment.refused), consistent with the engine's
refuse-not-flag contract.
"""

import pytest

from src.components import verification as ver


class TestSetCoverage:
    def test_full_disjoint_cover_passes(self):
        a = ver.validate_coverage(
            total_paras=5, knowledge_paras=[1, 2, 3], belief_paras=[4, 5]
        )
        assert a.refused is False

    def test_gap_refused(self):
        """Paragraph 3 verified in neither set -> unverified -> refuse."""
        a = ver.validate_coverage(
            total_paras=5, knowledge_paras=[1, 2], belief_paras=[4, 5]
        )
        assert a.refused is True
        assert "3" in a.reason
        assert "unverified" in a.reason.lower() or "gap" in a.reason.lower()

    def test_overlap_refused(self):
        """Paragraph 3 appears in both sets -> refuse."""
        a = ver.validate_coverage(
            total_paras=5, knowledge_paras=[1, 2, 3], belief_paras=[3, 4, 5]
        )
        assert a.refused is True
        assert "3" in a.reason
        assert "both" in a.reason.lower() or "overlap" in a.reason.lower()

    def test_out_of_range_para_refused(self):
        """A paragraph number beyond the range is an error, not silently kept."""
        a = ver.validate_coverage(
            total_paras=4, knowledge_paras=[1, 2], belief_paras=[3, 4, 5]
        )
        assert a.refused is True

    def test_exact_boundary_single_paragraph(self):
        a = ver.validate_coverage(total_paras=1, knowledge_paras=[1], belief_paras=[])
        assert a.refused is False

    def test_ranges_accepted_as_well_as_lists(self):
        """Paragraph ranges may be given as (start, end) tuples."""
        a = ver.validate_coverage(
            total_paras=10,
            knowledge_paras=[(1, 6)],
            belief_paras=[(7, 10)],
        )
        assert a.refused is False


class TestWritDeclaration:
    def test_writ_requires_no_similar_petition_declaration(self):
        with pytest.raises(ver.VerificationInputError):
            ver.render_context(
                variant=ver.Variant.WRIT,
                name="A", role="Petitioner",
                place="Chennai", day="1", month="August", year="2026",
                total_paras=3, knowledge_paras=[(1, 3)], belief_paras=[],
                no_similar_petition=False,  # missing declaration
            )

    def test_writ_with_declaration_ok(self):
        ctx = ver.render_context(
            variant=ver.Variant.WRIT,
            name="A", role="Petitioner",
            place="Chennai", day="1", month="August", year="2026",
            total_paras=3, knowledge_paras=[(1, 3)], belief_paras=[],
            no_similar_petition=True,
        )
        assert ctx["no_similar_petition"] is True


class TestCommercialStatementOfTruth:
    def test_commercial_requires_both_clauses(self):
        ctx = ver.render_context(
            variant=ver.Variant.COMMERCIAL,
            name="A", role="Plaintiff",
            place="Chennai", day="1", month="August", year="2026",
            total_paras=4, knowledge_paras=[(1, 4)], belief_paras=[],
            document_kind="plaint",
        )
        assert ctx["has_verification"] is True
        assert ctx["has_statement_of_truth"] is True

    def test_civil_has_no_statement_of_truth(self):
        ctx = ver.render_context(
            variant=ver.Variant.CIVIL,
            name="A", role="Plaintiff",
            place="Chennai", day="1", month="August", year="2026",
            total_paras=4, knowledge_paras=[(1, 4)], belief_paras=[],
        )
        assert ctx.get("has_statement_of_truth", False) is False


class TestParagraphFormatting:
    def test_paras_render_as_human_ranges(self):
        """1,2,3,5 -> '1 to 3 and 5' (code-generated, never model-written)."""
        assert ver.format_para_list([1, 2, 3, 5]) == "1 to 3 and 5"

    def test_single_para(self):
        assert ver.format_para_list([4]) == "4"

    def test_two_disjoint(self):
        assert ver.format_para_list([2, 4]) == "2 and 4"
