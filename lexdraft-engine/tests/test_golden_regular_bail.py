"""Task 5 — golden FIDELITY tests for the gold-standard regular_bail template.

These assert the LAYOUT properties an advocate's filed document requires, on the
RENDERED output (gold template + a fixed fact sheet run through docxtpl). They are the
guard that a future edit to the gold template — or to the render path — cannot quietly
strip the court formatting: a change that reverts to US Letter, fakes numbering, drops
the dotted leaders, or leaves a placeholder unsubstituted fails CI here.

Scope (this file): regular_bail only, against templates/gold/regular_bail.docx. As each
further doc type is hand-authored (after advocate legal-validation), add a sibling test
keyed to its gold template. The shared assertions live in helpers so a new doc type is a
few lines.
"""
from __future__ import annotations

import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
from docxtpl import DocxTemplate

from tests.fixtures_gold import REGULAR_BAIL_ENGINE_FIELDS

_ROOT = Path(__file__).resolve().parents[1]
GOLD = _ROOT / "templates" / "gold" / "regular_bail.docx"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# Expected A4 geometry (twips).
EXPECT_PGSZ_W = 11906
EXPECT_PGSZ_H = 16838
EXPECT_LEFT_MARGIN = 2160  # 1.5" wide binding margin


@pytest.fixture(scope="module")
def rendered(tmp_path_factory) -> Path:
    """Render the gold template with the REAL engine build context.

    Critically, this renders what PRODUCTION renders: the fields go through the actual
    regular_bail adapter (coerce -> build -> resolve_context), NOT a hand-written dict.
    A synthetic dict would silently pass even if the template referenced a key the
    engine context doesn't provide (the exact bug that shipped `{{ sections_joined }}`).
    Rendering through the adapter makes the test assert the template<->context contract.
    """
    assert GOLD.exists(), f"gold template missing: {GOLD}"
    from src.service import adapters
    from src.verify import signoff
    from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole

    adapter = adapters.get_adapter("regular_bail")
    result = adapter.build(**adapter.coerce(REGULAR_BAIL_ENGINE_FIELDS))
    assert not getattr(result, "refused", False), (
        f"fixture unexpectedly refused: {getattr(result, 'reason', '')}"
    )
    sheet = MatterFactSheet.create(
        court=Court(court_type="sessions", name="Principal Sessions Court, Tiruvallur",
                    state="Tamil Nadu"),
        case=Case(category="C3", document_type="regular_bail"),
        parties=[Party(role=PartyRole.ACCUSED, serial=1, name="Dinesh Kumar")],
        created_by="golden-test",
        created_at=datetime(2026, 9, 4, tzinfo=timezone.utc),
    )
    ctx = signoff.resolve_context(result.context, document="regular_bail", factsheet=sheet)
    out = tmp_path_factory.mktemp("golden") / "regular_bail_rendered.docx"
    tpl = DocxTemplate(str(GOLD))
    tpl.render(ctx)
    tpl.save(str(out))
    return out


@pytest.fixture(scope="module")
def parts(rendered) -> dict:
    with zipfile.ZipFile(rendered) as z:
        return {n: z.read(n).decode("utf-8", "replace") for n in z.namelist()
                if n.endswith(".xml")}


def _doc(parts) -> str:
    return parts["word/document.xml"]


# --- the fidelity assertions ------------------------------------------------

def test_zero_residual_jinja_tags(parts):
    """No {{ }} or {% %} may survive into the rendered document — a residual tag means
    docxtpl failed to substitute (often a split placeholder) and the tag would ship
    into the filed document."""
    doc = _doc(parts)
    residual = re.findall(r"\{\{.*?\}\}|\{%.*?%\}", doc, re.S)
    assert residual == [], f"residual Jinja tags after render: {residual[:5]}"


def test_sectpr_is_a4_with_wide_left_margin(parts):
    doc = _doc(parts)
    pgsz = re.search(r"<w:pgSz\b([^>]*)/?>", doc)
    pgmar = re.search(r"<w:pgMar\b([^>]*)/?>", doc)
    assert pgsz, "no <w:pgSz> — page size not set"
    assert pgmar, "no <w:pgMar> — margins not set"
    w = int(re.search(r'w:w="(\d+)"', pgsz.group(1)).group(1))
    h = int(re.search(r'w:h="(\d+)"', pgsz.group(1)).group(1))
    left = int(re.search(r'w:left="(\d+)"', pgmar.group(1)).group(1))
    assert (w, h) == (EXPECT_PGSZ_W, EXPECT_PGSZ_H), f"page is {w}x{h}, expected A4 {EXPECT_PGSZ_W}x{EXPECT_PGSZ_H}"
    assert left >= EXPECT_LEFT_MARGIN, f"left margin {left} < required binding margin {EXPECT_LEFT_MARGIN}"


def test_real_numbering_present(parts):
    """A numbering.xml with a definition, and paragraphs that REFERENCE it via numPr."""
    assert "word/numbering.xml" in parts, "no numbering.xml part"
    numxml = parts["word/numbering.xml"]
    assert "<w:abstractNum" in numxml, "no abstractNum definition in numbering.xml"
    assert "<w:num " in numxml, "no concrete <w:num> in numbering.xml"
    assert _doc(parts).count("<w:numPr") >= 3, "fewer than 3 paragraphs use real numbering"


def test_no_literal_number_runs(parts):
    """The grounds must be auto-numbered, not typed as literal '1.' / '2.' runs."""
    doc = _doc(parts)
    literal = re.findall(r"<w:t[^>]*>\s*\d{1,2}[.\)]\s", doc)
    assert literal == [], f"literal number runs found (should use real numbering): {literal[:5]}"


def test_dotted_leaders_present(parts):
    """The signature/verification lines use tab stops with dotted leaders, not typed
    rows of periods."""
    doc = _doc(parts)
    assert doc.count('w:leader="dot"') >= 1, "no dotted-leader tab stops"
    # and not faked as literal dot runs
    dot_runs = re.findall(r"<w:t[^>]*>[.…]{5,}</w:t>", doc)
    assert dot_runs == [], f"literal dotted-leader runs found: {dot_runs[:3]}"


def test_named_styles_used(parts):
    """Layout is owned by named paragraph styles, not run-by-run formatting."""
    doc = _doc(parts)
    assert doc.count("<w:pStyle ") >= 5, "too few paragraphs reference a named style"


def test_header_with_page_number(parts):
    header_parts = [n for n in parts if re.match(r"word/header\d*\.xml", n)]
    assert header_parts, "no header part"
    assert any("PAGE" in parts[h] for h in header_parts), "no PAGE field in header"


def test_prayer_and_verification_blocks_present(parts):
    doc = _doc(parts)
    # Strip tags to get visible text.
    text = re.sub(r"<[^>]+>", "", doc)
    assert "PRAYER" in text, "prayer block missing"
    assert "VERIFICATION" in text, "verification block missing"
    # verification must carry the place (a populated field, not a placeholder).
    assert "Chennai" in text, "verification/place field not populated"


def test_engine_context_fields_actually_render(parts):
    """Guard the template<->context contract: the real engine fields must appear in the
    output. This is the assertion that would have caught the {{ sections_joined }} bug
    (a template key the engine context doesn't provide → the section rendered blank)."""
    text = re.sub(r"<[^>]+>", "", _doc(parts))
    assert "812/2024" in text, "FIR number did not render"
    assert "Dinesh Kumar" in text, "accused name did not render"
    # The BNS/BNSS section identifiers — drawn from the tables — must appear.
    assert "303" in text and "BNS" in text, "offence sections did not render (template<->context key mismatch?)"
    # The resolved enabling provision (regular_bail_section), not a hardcoded one.
    assert "483 BNSS" in text or "Section 483" in text, "resolved bail section did not render"


def test_cause_title_present_and_ordered(parts):
    """Cause title (court + case-number) appears, and before the prayer."""
    text = re.sub(r"<[^>]+>", "", _doc(parts))
    court_idx = text.find("IN THE COURT OF")
    prayer_idx = text.find("PRAYER")
    verif_idx = text.find("VERIFICATION")
    assert court_idx != -1, "cause title 'IN THE COURT OF' missing"
    assert "BAIL APPLICATION NO." in text, "bail application number line missing"
    assert court_idx < prayer_idx < verif_idx, "blocks out of order (cause title → prayer → verification)"
