"""E-filing bundle compilation + compliance. Deterministic. No LLM.

The compliance logic — cross-reference integrity, draft detection, numbering-gap
detection, continuous pagination, and the index that cites ACTUAL compiled page
numbers — is pure Python and dependency-free. The PDF merge / OCR / compression /
split is behind the injectable `PdfBackend` so this core is fully testable without
Ghostscript / Tesseract.

A bundle is only `filing_ready` when ALL of these hold (any failure refuses):
  - no document carries a draft narrative slot ([to be drafted]);
  - every annexure referenced in the pleading resolves to a bundle document;
  - every bundle document is referenced in the pleading;
  - annexure numbering has no gap;
  - the bundle is not otherwise draft.

Draft-vs-final propagates: a draft document makes the whole bundle draft, and a
draft bundle is never filing-ready.

NOT implemented here (own design pass — touches advocate credentials): digital
signature / eSign.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, List, Optional, Sequence, Set

# The named-slot draft marker used across the pipelines.
_DRAFT_MARKER = "[to be drafted]"

# Matches "Annexure A-1", "Annexure A-12", "Annexure B-3" (letter-block + number).
_ANNEXURE_RE = re.compile(r"Annexure\s+([A-Z]+-\d+)")


class ItemKind(Enum):
    PLEADING = "pleading"
    ANNEXURE = "annexure"


@dataclass(frozen=True)
class BundleItem:
    item_id: str
    kind: ItemKind
    title: str
    page_count: int
    is_draft: bool = False
    text: str = ""                       # searchable text (pleading carries refs)
    annexure_marker: Optional[str] = None  # e.g. "A-1" for annexures


@dataclass(frozen=True)
class IndexEntry:
    item_id: str
    title: str
    start_page: int
    end_page: int


@dataclass(frozen=True)
class Bookmark:
    title: str
    page: int


@dataclass(frozen=True)
class BundleResult:
    refused: bool
    filing_ready: bool
    is_draft: bool
    reason: str = ""
    index: List[IndexEntry] = field(default_factory=list)
    bundle_path: Optional[str] = None
    parts: List[str] = field(default_factory=list)
    was_compressed: bool = False
    was_split: bool = False


class PdfBackend:
    """Injectable PDF backend. The default is abstract; real implementations wrap
    pypdf + an OCR engine + a compressor. Tests inject a fake."""

    def page_count(self, item: BundleItem) -> int:
        raise NotImplementedError

    def image_only_pages(self, item: BundleItem) -> List[int]:
        """Page indexes (0-based) that carry no text layer — must be OCR'd.
        Detected, never assumed."""
        raise NotImplementedError

    def ocr_pages(self, item: BundleItem, pages: Sequence[int]) -> None:
        raise NotImplementedError

    def merge(self, items: Sequence[BundleItem], bookmarks: Sequence[Bookmark],
              out_path: str) -> str:
        raise NotImplementedError

    def size_bytes(self, path: str) -> int:
        raise NotImplementedError

    def compress(self, path: str) -> str:
        raise NotImplementedError

    def split(self, path: str, max_bytes: int) -> List[str]:
        raise NotImplementedError


def find_annexure_references(text: str) -> Set[str]:
    """All distinct 'Annexure X-n' markers referenced in the text."""
    return set(_ANNEXURE_RE.findall(text or ""))


def _numbering_gap(markers: Sequence[str]) -> Optional[str]:
    """Return a human description of the first numbering gap, or None.

    Annexures are grouped by their letter-block (A, B, ...); within a block the
    numbers must run 1..n with no gap.
    """
    by_block: dict = {}
    for m in markers:
        block, num = m.split("-")
        by_block.setdefault(block, []).append(int(num))
    for block, nums in sorted(by_block.items()):
        nums = sorted(nums)
        expected = list(range(1, len(nums) + 1))
        if nums != expected:
            present = set(nums)
            missing = [n for n in range(1, max(nums) + 1) if n not in present]
            if missing:
                return f"{block}-{missing[0]}"
    return None


def compile_bundle(
    *,
    pleading: BundleItem,
    annexures: Sequence[BundleItem],
    max_bytes: int,
    backend: PdfBackend,
    out_path: str = "bundle.pdf",
) -> BundleResult:
    """Compile the filing bundle and assess filing-readiness."""

    items: List[BundleItem] = [pleading, *annexures]

    # --- draft propagation: any draft document -> draft bundle ---
    is_draft = any(i.is_draft for i in items)
    draft_slot_present = any(_DRAFT_MARKER in (i.text or "") for i in items)

    # --- continuous pagination + index citing ACTUAL page numbers ---
    index: List[IndexEntry] = []
    bookmarks: List[Bookmark] = []
    page = 1
    for item in items:
        n = backend.page_count(item)
        start, end = page, page + n - 1
        index.append(IndexEntry(item_id=item.item_id, title=item.title,
                                start_page=start, end_page=end))
        bookmarks.append(Bookmark(title=item.title, page=start))
        page = end + 1

    # --- OCR: only the detected image-only pages, per document ---
    for item in items:
        img_pages = backend.image_only_pages(item)
        if img_pages:
            backend.ocr_pages(item, img_pages)

    # --- cross-reference integrity (both ways) ---
    referenced = find_annexure_references(pleading.text)
    present_markers = [a.annexure_marker for a in annexures if a.annexure_marker]
    present = set(present_markers)

    reason = ""
    filing_ready = True

    dangling = referenced - present            # referenced but not in bundle
    orphan = present - referenced              # in bundle but not referenced
    gap = _numbering_gap(present_markers)

    if draft_slot_present:
        filing_ready = False
        reason = (f"a narrative slot is still {_DRAFT_MARKER}; the bundle contains "
                  f"a draft document and is not filing-ready")
    elif dangling:
        filing_ready = False
        reason = (f"annexure(s) referenced in the pleading are missing from the "
                  f"bundle: {', '.join(sorted(dangling))}")
    elif orphan:
        filing_ready = False
        reason = (f"annexure(s) in the bundle are not referenced in the pleading: "
                  f"{', '.join(sorted(orphan))}")
    elif gap:
        filing_ready = False
        reason = f"annexure numbering has a gap: {gap} is missing"
    elif is_draft:
        filing_ready = False
        reason = "the bundle contains a draft document and is not filing-ready"

    # --- assemble the PDF (compliance verdict does not block producing the file;
    #     a draft bundle can still be compiled, just not marked filing-ready) ---
    merged_path = backend.merge(items, bookmarks, out_path)

    # --- size cap: compress, then split if still over ---
    # The compression step always runs (a within-cap bundle passes it clean); we
    # only split when compression cannot bring the bundle under the cap.
    was_split = False
    merged_path = backend.compress(merged_path)
    was_compressed = True
    parts = [merged_path]
    if backend.size_bytes(merged_path) > max_bytes:
        parts = backend.split(merged_path, max_bytes)
        was_split = True

    return BundleResult(
        refused=not filing_ready,
        filing_ready=filing_ready,
        is_draft=is_draft,
        reason=reason,
        index=index,
        bundle_path=parts[0],
        parts=parts,
        was_compressed=was_compressed,
        was_split=was_split,
    )
