"""Tests for src.efiling.bundle — filing-bundle compliance core.

The compliance/validation logic is pure Python and dependency-free. The actual
PDF merge / OCR / compression is behind an injectable backend, faked here so the
legally-important checks are testable without Ghostscript/Tesseract.

Covered:
  - Ordered compilation (pleading first, then annexures in index order).
  - Continuous pagination across the whole bundle; the index cites ACTUAL
    compiled page numbers, not placeholders.
  - Per-document bookmarks.
  - Image-only page detection -> OCR requested for those pages only.
  - Size cap: compress, then split with a continuation convention.
  - Filing-ready refusals: draft slot present, missing referenced annexure,
    annexure numbering gap.
  - Annexure cross-reference integrity, BOTH ways.
  - Draft-vs-final propagation: a draft document makes the bundle draft.
"""

import pytest

from src.efiling import bundle as bd


# --- a fake PDF backend: records calls, fabricates page geometry --------------

class FakeBackend(bd.PdfBackend):
    def __init__(self, image_only_pages=None, compressed_size=None):
        self.merged = None
        self.bookmarks = []
        self.ocr_requests = []
        self._image_only = image_only_pages or {}   # item_id -> [page indexes]
        self._compressed_size = compressed_size

    def page_count(self, item):
        return item.page_count

    def image_only_pages(self, item):
        return self._image_only.get(item.item_id, [])

    def ocr_pages(self, item, pages):
        self.ocr_requests.append((item.item_id, tuple(pages)))

    def merge(self, items, bookmarks, out_path):
        self.merged = [i.item_id for i in items]
        self.bookmarks = bookmarks
        return out_path

    def size_bytes(self, path):
        return self._compressed_size if self._compressed_size is not None else 1000

    def compress(self, path):
        return path

    def split(self, path, max_bytes):
        # pretend the bundle splits into 2 parts
        return [f"{path}.part1", f"{path}.part2"]


def _pleading(text="Refer Annexure A-1 and Annexure A-2.", draft=False, pages=3):
    return bd.BundleItem(item_id="pleading", kind=bd.ItemKind.PLEADING,
                         title="Plaint", page_count=pages, is_draft=draft,
                         text=text)


def _annexure(marker, pages=2, draft=False, item_id=None):
    return bd.BundleItem(item_id=item_id or marker, kind=bd.ItemKind.ANNEXURE,
                         title=f"Annexure {marker}", page_count=pages,
                         is_draft=draft, annexure_marker=marker)


def _bundle(**over):
    kw = dict(
        pleading=_pleading(),
        annexures=[_annexure("A-1"), _annexure("A-2")],
        max_bytes=10_000,
        backend=FakeBackend(),
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Ordered compilation + pagination + bookmarks.
# --------------------------------------------------------------------------

class TestCompilationOrder:
    def test_pleading_first_then_annexures_in_order(self):
        b = FakeBackend()
        result = bd.compile_bundle(**_bundle(backend=b))
        assert result.refused is False
        assert b.merged == ["pleading", "A-1", "A-2"]

    def test_continuous_pagination(self):
        """Pleading 3pp, A-1 2pp, A-2 2pp -> ranges 1-3, 4-5, 6-7. Continuous."""
        result = bd.compile_bundle(**_bundle())
        ranges = {e.item_id: (e.start_page, e.end_page) for e in result.index}
        assert ranges["pleading"] == (1, 3)
        assert ranges["A-1"] == (4, 5)
        assert ranges["A-2"] == (6, 7)

    def test_index_cites_actual_pages_not_placeholders(self):
        result = bd.compile_bundle(**_bundle())
        for entry in result.index:
            assert isinstance(entry.start_page, int)
            assert entry.start_page > 0
            assert entry.end_page >= entry.start_page

    def test_bookmark_per_document(self):
        b = FakeBackend()
        bd.compile_bundle(**_bundle(backend=b))
        titles = [bm.title for bm in b.bookmarks]
        assert titles == ["Plaint", "Annexure A-1", "Annexure A-2"]
        # bookmark points to the document's first page
        assert b.bookmarks[1].page == 4  # A-1 starts at page 4


# --------------------------------------------------------------------------
# OCR — detect image-only pages, do not assume.
# --------------------------------------------------------------------------

class TestOcr:
    def test_image_only_pages_are_ocred(self):
        b = FakeBackend(image_only_pages={"A-1": [0, 1]})
        bd.compile_bundle(**_bundle(backend=b))
        assert ("A-1", (0, 1)) in b.ocr_requests

    def test_text_pages_not_ocred(self):
        b = FakeBackend(image_only_pages={})  # nothing image-only
        bd.compile_bundle(**_bundle(backend=b))
        assert b.ocr_requests == []

    def test_detection_per_page_not_per_document(self):
        """Only the image-only pages of a mixed document are OCR'd."""
        b = FakeBackend(image_only_pages={"A-2": [1]})  # only 2nd page
        bd.compile_bundle(**_bundle(backend=b))
        assert ("A-2", (1,)) in b.ocr_requests


# --------------------------------------------------------------------------
# Size cap — compress, then split.
# --------------------------------------------------------------------------

class TestSizeCap:
    def test_within_cap_single_file(self):
        b = FakeBackend(compressed_size=5_000)
        result = bd.compile_bundle(**_bundle(backend=b, max_bytes=10_000))
        assert result.parts == [result.bundle_path]
        assert result.was_split is False

    def test_over_cap_after_compression_splits(self):
        b = FakeBackend(compressed_size=50_000)
        result = bd.compile_bundle(**_bundle(backend=b, max_bytes=10_000))
        assert result.was_split is True
        assert len(result.parts) == 2

    def test_compression_attempted_before_split(self):
        b = FakeBackend(compressed_size=5_000)  # compresses under the cap
        result = bd.compile_bundle(**_bundle(backend=b, max_bytes=10_000))
        assert result.was_compressed is True
        assert result.was_split is False


# --------------------------------------------------------------------------
# Filing-ready refusals.
# --------------------------------------------------------------------------

class TestFilingReadyRefusals:
    def test_draft_slot_in_pleading_refuses(self):
        result = bd.compile_bundle(**_bundle(
            pleading=_pleading(text="Facts: [to be drafted]. Refer Annexure A-1 "
                                    "and Annexure A-2."),
        ))
        assert result.filing_ready is False
        assert "draft" in result.reason.lower() or "to be drafted" in result.reason.lower()

    def test_missing_referenced_annexure_refuses(self):
        """Pleading refers to A-3 but it is not in the bundle."""
        result = bd.compile_bundle(**_bundle(
            pleading=_pleading(text="Refer Annexure A-1, Annexure A-2 and Annexure A-3."),
            annexures=[_annexure("A-1"), _annexure("A-2")],
        ))
        assert result.filing_ready is False
        assert "A-3" in result.reason

    def test_annexure_numbering_gap_refuses(self):
        """A-1, A-3 present but A-2 missing -> gap in numbering."""
        result = bd.compile_bundle(**_bundle(
            pleading=_pleading(text="Refer Annexure A-1 and Annexure A-3."),
            annexures=[_annexure("A-1"), _annexure("A-3")],
        ))
        assert result.filing_ready is False
        assert "gap" in result.reason.lower() or "A-2" in result.reason

    def test_clean_bundle_is_filing_ready(self):
        result = bd.compile_bundle(**_bundle())
        assert result.filing_ready is True
        assert result.refused is False


# --------------------------------------------------------------------------
# Annexure cross-reference integrity — BOTH ways.
# --------------------------------------------------------------------------

class TestCrossReferenceIntegrity:
    def test_reference_without_document_refuses(self):
        """Every 'Annexure X' in the text must resolve to a bundle document."""
        result = bd.compile_bundle(**_bundle(
            pleading=_pleading(text="Refer Annexure A-1 and Annexure A-9."),
            annexures=[_annexure("A-1")],
        ))
        assert result.filing_ready is False
        assert "A-9" in result.reason

    def test_document_without_reference_refuses(self):
        """Every bundle document must be referenced in the pleading."""
        result = bd.compile_bundle(**_bundle(
            pleading=_pleading(text="Refer Annexure A-1 only."),
            annexures=[_annexure("A-1"), _annexure("A-2")],  # A-2 unreferenced
        ))
        assert result.filing_ready is False
        assert "A-2" in result.reason

    def test_full_bidirectional_match_ok(self):
        result = bd.compile_bundle(**_bundle(
            pleading=_pleading(text="Refer Annexure A-1 and Annexure A-2."),
            annexures=[_annexure("A-1"), _annexure("A-2")],
        ))
        assert result.filing_ready is True


# --------------------------------------------------------------------------
# Draft-vs-final propagation.
# --------------------------------------------------------------------------

class TestDraftPropagation:
    def test_draft_pleading_makes_bundle_draft(self):
        result = bd.compile_bundle(**_bundle(pleading=_pleading(draft=True)))
        assert result.is_draft is True
        assert result.filing_ready is False

    def test_draft_annexure_makes_bundle_draft(self):
        result = bd.compile_bundle(**_bundle(
            annexures=[_annexure("A-1", draft=True), _annexure("A-2")],
        ))
        assert result.is_draft is True
        assert result.filing_ready is False

    def test_all_final_bundle_not_draft(self):
        result = bd.compile_bundle(**_bundle())
        assert result.is_draft is False


# --------------------------------------------------------------------------
# Reference parsing.
# --------------------------------------------------------------------------

class TestReferenceParsing:
    def test_finds_annexure_markers_in_text(self):
        refs = bd.find_annexure_references(
            "As per Annexure A-1 and Annexure A-12, and see Annexure B-3."
        )
        assert refs == {"A-1", "A-12", "B-3"}

    def test_deduplicates_repeated_references(self):
        refs = bd.find_annexure_references("Annexure A-1 ... again Annexure A-1.")
        assert refs == {"A-1"}

    def test_no_references_empty_set(self):
        assert bd.find_annexure_references("No annexures here.") == set()
