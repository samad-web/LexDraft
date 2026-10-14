"""Golden FIDELITY tests for the gold affidavit template (standalone doc-type).

Renders through the REAL adapter (coerce -> build -> resolve_context). Asserts both the
layout fidelity AND the affidavit VALIDATION RULES (corporate -> authority reference,
third-party -> source of knowledge) — the rules that live in components/affidavit.py, so
they are enforced here even though the standalone doc-type is a new adapter. The existing
affidavit language must render verbatim.
"""
from __future__ import annotations

import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
from docxtpl import DocxTemplate

from tests.fixtures_gold import (
    AFFIDAVIT_ENGINE_FIELDS, AFFIDAVIT_CORPORATE_FIELDS, AFFIDAVIT_THIRD_PARTY_FIELDS,
    AFFIDAVIT_COURT_FIELDS, AFFIDAVIT_S138_FIELDS,
)

_ROOT = Path(__file__).resolve().parents[1]
GOLD = _ROOT / "templates" / "gold" / "affidavit.docx"

EXPECT_PGSZ_W = 11906
EXPECT_PGSZ_H = 16838
EXPECT_LEFT_MARGIN = 2160


def _render(fields: dict) -> Path:
    from src.service import adapters
    from src.verify import signoff
    from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole

    adapter = adapters.get_adapter("affidavit")
    result = adapter.build(**adapter.coerce(fields))
    assert not getattr(result, "refused", False), (
        f"fixture unexpectedly refused: {getattr(result, 'reason', '')}"
    )
    sheet = MatterFactSheet.create(
        court=Court(court_type="high_court", name="High Court of Madras", state="Tamil Nadu"),
        case=Case(category="C5", document_type="affidavit"),
        parties=[Party(role=PartyRole.PETITIONER, serial=1, name="P. Revathi")],
        created_by="golden-test", created_at=datetime(2026, 9, 4, tzinfo=timezone.utc),
    )
    ctx = signoff.resolve_context(result.context, document="affidavit", factsheet=sheet)
    import tempfile
    out = Path(tempfile.mkdtemp()) / "affidavit_rendered.docx"
    tpl = DocxTemplate(str(GOLD))
    tpl.render(ctx)
    tpl.save(str(out))
    return out


@pytest.fixture(scope="module")
def rendered() -> Path:
    assert GOLD.exists(), f"gold template missing: {GOLD}"
    return _render(AFFIDAVIT_ENGINE_FIELDS)


@pytest.fixture(scope="module")
def doc(rendered) -> str:
    with zipfile.ZipFile(rendered) as z:
        return z.read("word/document.xml").decode("utf-8", "replace")


def _text(doc) -> str:
    return re.sub(r"<[^>]+>", "", doc)


# --- layout fidelity -------------------------------------------------------

def test_zero_residual_jinja(doc):
    assert re.findall(r"\{\{.*?\}\}|\{%.*?%\}", doc, re.S) == []


def test_a4_wide_left_margin(doc):
    pgsz = re.search(r"<w:pgSz\b([^>]*)/?>", doc)
    pgmar = re.search(r"<w:pgMar\b([^>]*)/?>", doc)
    assert pgsz and pgmar
    w = int(re.search(r'w:w="(\d+)"', pgsz.group(1)).group(1))
    h = int(re.search(r'w:h="(\d+)"', pgsz.group(1)).group(1))
    left = int(re.search(r'w:left="(\d+)"', pgmar.group(1)).group(1))
    assert (w, h) == (EXPECT_PGSZ_W, EXPECT_PGSZ_H)
    assert left >= EXPECT_LEFT_MARGIN


def test_real_numbering_no_literals(doc, rendered):
    with zipfile.ZipFile(rendered) as z:
        assert "word/numbering.xml" in z.namelist()
    assert doc.count("<w:numPr") >= 4, "competence + averments + prayer should be numbered"
    assert re.findall(r"<w:t[^>]*>\s*\d{1,2}[.\)]\s", doc) == [], "no literal number runs"


def test_named_styles(doc):
    assert doc.count("<w:pStyle ") >= 5


# --- language preserved verbatim -------------------------------------------

def test_language_is_verbatim(doc):
    t = _text(doc)
    assert "do hereby solemnly affirm and sincerely state as follows:" in t
    assert "am well acquainted with the facts of the case" in t
    assert "signed his/her name in my presence" in t
    assert "BEFORE ME" in t
    assert "DEPONENT" in t
    assert t.strip().startswith("[") or "AFFIDAVIT" in t  # banner then title


def test_averments_and_prayer_render(doc):
    t = _text(doc)
    assert "Rule 8-A of the TN Minor Mineral Concession Rules" in t  # an averment
    assert "It is therefore prayed" in t                             # the prayer, verbatim


# --- validation rules (the whole point of reusing the component) -----------

def test_corporate_deponent_carries_authority_reference():
    """Corporate deponent -> the authority-reference averment MUST appear (rule from
    components/affidavit.py, enforced at the standalone doc-type)."""
    out = _render(AFFIDAVIT_CORPORATE_FIELDS)
    t = _text(zipfile.ZipFile(out).read("word/document.xml").decode("utf-8", "replace"))
    assert "duly authorised to swear this affidavit vide Board Resolution dated 01-08-2024" in t


def test_third_party_deponent_carries_source_of_knowledge():
    """Third-party deponent -> the source-of-knowledge averment MUST appear."""
    out = _render(AFFIDAVIT_THIRD_PARTY_FIELDS)
    t = _text(zipfile.ZipFile(out).read("word/document.xml").decode("utf-8", "replace"))
    assert "My source of knowledge is the records of the petitioner" in t


def test_corporate_without_authority_is_refused():
    """The engine must REFUSE a corporate deponent with no authority reference."""
    from src.service import adapters
    fields = {**AFFIDAVIT_CORPORATE_FIELDS}
    del fields["authority_ref"]
    a = adapters.get_adapter("affidavit")
    result = a.build(**a.coerce(fields))
    assert getattr(result, "refused", False), "corporate w/o authority_ref must refuse"
    assert "authority reference" in result.reason


def test_third_party_without_source_is_refused():
    from src.service import adapters
    fields = {**AFFIDAVIT_THIRD_PARTY_FIELDS}
    del fields["source_of_knowledge"]
    a = adapters.get_adapter("affidavit")
    result = a.build(**a.coerce(fields))
    assert getattr(result, "refused", False), "third-party w/o source must refuse"
    assert "source-of-knowledge" in result.reason


# --- FULL COURT AFFIDAVIT format (the advocate's reference) -----------------

def _court_text() -> str:
    out = _render(AFFIDAVIT_COURT_FIELDS)
    with zipfile.ZipFile(out) as z:
        doc = z.read("word/document.xml").decode("utf-8", "replace")
    return re.sub(r"<[^>]+>", "", doc)


def test_court_affidavit_has_cause_title_and_parties():
    """The full court format: DRAFT AFFIDAVIT title, court cause-title, SUIT NO / under-
    order line, IN THE MATTER OF party block with PLAINTIFF / VERSUS / DEFENDANT."""
    t = _court_text()
    assert "DRAFT AFFIDAVIT" in t
    assert "IN THE COURT OF DISTRICT JUDGE" in t
    assert "SUIT NO. 123 OF 2026" in t
    assert "ORDER XXXVII" in t
    assert "IN THE MATTER OF" in t
    assert "M/s ABC Pvt. Ltd." in t and "PLAINTIFF" in t
    assert "VERSUS" in t
    assert "M/s XYZ Ltd." in t and "DEFENDANT" in t


def test_court_affidavit_has_affidavit_of_heading():
    t = _court_text()
    assert "AFFIDAVIT OF Sh. Rakesh Sharma" in t
    assert "AGED ABOUT 38 YEARS" in t
    assert "R/o 12 Ring Road" in t
    assert "in the capacity of the director of M/s ABC Pvt. Ltd." in t


def test_court_affidavit_has_verification_clause_and_two_deponents():
    t = _court_text()
    assert "VERIFICATION:" in t
    assert "do hereby verify on this" in t and "at Delhi" in t
    assert "nothing material has been concealed" in t
    assert t.count("DEPONENT") >= 2  # after the body AND after verification


def test_court_affidavit_no_residual_and_bare_jurat_suppressed():
    """A court affidavit uses the VERIFICATION clause, not the bare 'Solemnly affirmed
    … BEFORE ME' jurat (that is only for a standalone affidavit)."""
    out = _render(AFFIDAVIT_COURT_FIELDS)
    with zipfile.ZipFile(out) as z:
        doc = z.read("word/document.xml").decode("utf-8", "replace")
    assert re.findall(r"\{\{.*?\}\}|\{%.*?%\}", doc, re.S) == []
    t = re.sub(r"<[^>]+>", "", doc)
    assert "BEFORE ME" not in t  # jurat suppressed for the court format


def test_s138_affidavit_coerces_conditional_contract_and_renders():
    """matter_type == 's138' pulls in the conditional cheque + dishonour contract; the
    affidavit coerces and renders. The individual power agent's authority reference
    recites (STEP 3d), and no jinja survives."""
    from src.service import adapters

    adapter = adapters.get_adapter("affidavit")
    kwargs = adapter.coerce(AFFIDAVIT_S138_FIELDS)
    # The conditional s.138 particulars were required and coerced through.
    assert len(kwargs["cheques"]) == 1
    assert kwargs["notice_date"].isoformat() == "2026-05-02"

    out = _render(AFFIDAVIT_S138_FIELDS)
    with zipfile.ZipFile(out) as z:
        doc = z.read("word/document.xml").decode("utf-8", "replace")
    assert re.findall(r"\{\{.*?\}\}|\{%.*?%\}", doc, re.S) == []
    t = _text(doc)
    # STEP 3d: an INDIVIDUAL power agent with a POA reference renders the sentence.
    assert "duly authorised to swear this affidavit vide Power of Attorney dated 05-08-2026" in t
    # A s.145 proof affidavit renders NO prayer: it is the complainant's examination-
    # in-chief on affidavit — evidence, not a petition. The prayer belongs to the
    # complaint, which has already sought relief; an affidavit that both gives evidence
    # and prays for relief conflates the two documents.
    assert "prayed" not in t
