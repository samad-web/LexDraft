"""Golden FIDELITY tests for the gold s138_notice template.

Renders the gold template with a 2-cheque matter THROUGH THE REAL ADAPTER (coerce ->
build -> resolve_context) — the production path — so the template<->context contract is
asserted (this is what caught the sections_joined bug for regular_bail). s.138 is a
LETTER, so the assertions differ from a pleading: no cause title/verification; instead a
subject line, per-cheque particulars, the statutory demand, and the consequence.
"""
from __future__ import annotations

import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
from docxtpl import DocxTemplate

from tests.fixtures_gold import S138_NOTICE_ENGINE_FIELDS

_ROOT = Path(__file__).resolve().parents[1]
GOLD = _ROOT / "templates" / "gold" / "s138_notice.docx"

EXPECT_PGSZ_W = 11906
EXPECT_PGSZ_H = 16838

# The one intentional fill-later token: the RPAD consignment number the advocate enters
# after dispatch. It is passed as a field VALUE (not an unsubstituted template key), so
# it legitimately survives into the rendered document.
INTENTIONAL_TOKEN = "{{ rpad_consignment_no }}"


@pytest.fixture(scope="module")
def rendered(tmp_path_factory) -> Path:
    assert GOLD.exists(), f"gold template missing: {GOLD}"
    from src.service import adapters
    from src.verify import signoff
    from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole

    adapter = adapters.get_adapter("s138_notice")
    result = adapter.build(**adapter.coerce(S138_NOTICE_ENGINE_FIELDS))
    assert not getattr(result, "refused", False), (
        f"fixture unexpectedly refused: {getattr(result, 'reason', '')}"
    )
    sheet = MatterFactSheet.create(
        court=Court(court_type="magistrate", name="Judicial Magistrate No. I, Coimbatore",
                    state="Tamil Nadu"),
        case=Case(category="C2", document_type="s138_statutory_notice"),
        parties=[Party(role=PartyRole.COMPLAINANT, serial=1, name="Lakshmi Narayanan")],
        created_by="golden-test",
        created_at=datetime(2026, 9, 4, tzinfo=timezone.utc),
    )
    ctx = signoff.resolve_context(result.context, document="s138_notice", factsheet=sheet)
    out = tmp_path_factory.mktemp("golden") / "s138_rendered.docx"
    tpl = DocxTemplate(str(GOLD))
    tpl.render(ctx)
    tpl.save(str(out))
    return out


@pytest.fixture(scope="module")
def parts(rendered) -> dict:
    with zipfile.ZipFile(rendered) as z:
        return {n: z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.endswith(".xml")}


def _doc(parts) -> str:
    return parts["word/document.xml"]


def test_only_intentional_token_survives(parts):
    """No unsubstituted placeholder except the deliberate RPAD fill-later token."""
    doc = _doc(parts)
    residual = re.findall(r"\{\{.*?\}\}|\{%.*?%\}", doc, re.S)
    unexpected = [r for r in residual if r.strip() != INTENTIONAL_TOKEN]
    assert unexpected == [], f"unexpected residual tags: {unexpected}"


def test_a4_page(parts):
    pgsz = re.search(r"<w:pgSz\b([^>]*)/?>", _doc(parts))
    assert pgsz
    w = int(re.search(r'w:w="(\d+)"', pgsz.group(1)).group(1))
    h = int(re.search(r'w:h="(\d+)"', pgsz.group(1)).group(1))
    assert (w, h) == (EXPECT_PGSZ_W, EXPECT_PGSZ_H)


def test_real_numbering_no_literal_numbers(parts):
    doc = _doc(parts)
    assert "word/numbering.xml" in parts
    assert doc.count("<w:numPr") >= 3, "recitals should use real numbering"
    literal = re.findall(r"<w:t[^>]*>\s*\d{1,2}[.\)]\s", doc)
    assert literal == [], f"literal number runs found: {literal[:5]}"


def test_named_styles_used(parts):
    assert _doc(parts).count("<w:pStyle ") >= 5


def test_letter_structure_present(parts):
    text = re.sub(r"<[^>]+>", "", _doc(parts))
    assert "Subject: Statutory notice under Section 138" in text, "subject line missing"
    assert "hereby call upon you to pay" in text, "statutory demand missing"
    assert "prosecution" in text and "138" in text, "consequence missing"
    # a s.138 notice is NOT a pleading: no verification/prayer.
    assert "VERIFICATION" not in text and "PRAYER" not in text


def test_every_cheque_renders_as_its_own_line(parts):
    """The multi-cheque support: both cheques appear, each as its own particulars line,
    with amount-in-words from the engine."""
    text = re.sub(r"<[^>]+>", "", _doc(parts))
    assert "452118" in text and "452119" in text, "both cheque numbers must render"
    assert text.count("Cheque No.") >= 2, "each cheque should be its own line"
    assert "four lakh fifty thousand" in text, "amount-in-words (cheque 1) missing"
    assert "one lakh twenty-five thousand" in text, "amount-in-words (cheque 2) missing"


def test_demand_total_is_summed(parts):
    """demand_amount = 450000 + 125000 = 575000, with words — computed by the engine."""
    text = re.sub(r"<[^>]+>", "", _doc(parts))
    assert "575000" in text, "summed demand amount missing"
    assert "five lakh seventy-five thousand" in text, "demand amount-in-words missing"


def test_compliance_period_is_statutory_15_days(parts):
    text = re.sub(r"<[^>]+>", "", _doc(parts))
    assert "15 days" in text, "statutory 15-day compliance period missing"
