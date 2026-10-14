"""Golden-file tests for the shared component .docx renderers.

A known fact sheet renders to a known .docx. We assert on the extracted text of
the rendered document (paragraph text), diffed against a committed golden text
snapshot in tests/documents/golden/. Regeneration must not drift.

Rationale for text-snapshot goldens (not byte goldens): docx is a zip of XML with
embedded timestamps, so byte-level goldens are non-deterministic. The legally
meaningful content is the text and its order, which is what these pin.

Run with LEXDRAFT_UPDATE_GOLDEN=1 to (re)write goldens after an intended change.
"""

import os
from pathlib import Path

import pytest

from src.factsheet import Party, PartyRole, Court, Case
from src.components import cause_title as ct
from src.components import verification as ver
from src.components import affidavit as aff
from src.components import prayer as pr
from src.components.render import render_to_docx, extract_text


GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE = os.environ.get("LEXDRAFT_UPDATE_GOLDEN") == "1"


def _assert_golden(name: str, text: str):
    GOLDEN_DIR.mkdir(exist_ok=True)
    path = GOLDEN_DIR / f"{name}.txt"
    if UPDATE or not path.exists():
        path.write_text(text, encoding="utf-8")
        if not UPDATE:
            pytest.skip(f"golden {name} created; rerun to assert")
        return
    expected = path.read_text(encoding="utf-8")
    assert text == expected, f"rendered {name} drifted from golden {path}"


# --------------------------------------------------------------------------
# Cause title — district civil.
# --------------------------------------------------------------------------

def test_golden_cause_title_district_civil(tmp_path):
    ctx = ct.build_context(
        variant=ct.Variant.DISTRICT_CIVIL,
        court=Court(court_type="district", name="Principal District Court",
                    state="Tamil Nadu"),
        case=Case(category="C2", document_type="O.S.", year=2026),
        parties=[
            Party(role=PartyRole.PLAINTIFF, serial=1, name="Ramesh Kumar", age=42,
                  parentage_type="son of", parentage_name="Krishnan",
                  occupation="business", address_lines=["12 North Street", "Mylapore"],
                  pin="600004"),
            Party(role=PartyRole.DEFENDANT, serial=1, name="Suresh Babu", age=50,
                  parentage_type="son of", parentage_name="Raman",
                  occupation="trade", address_lines=["8 South Street"], pin="600001"),
        ],
        court_place="Chennai",
    )
    out = tmp_path / "cause_title.docx"
    render_to_docx(ct.TEMPLATE, ctx, out)
    _assert_golden("cause_title_district_civil", extract_text(out))


# --------------------------------------------------------------------------
# Verification — civil.
# --------------------------------------------------------------------------

def test_golden_verification_civil(tmp_path):
    ctx = ver.render_context(
        variant=ver.Variant.CIVIL,
        name="Ramesh Kumar", role="Plaintiff",
        place="Chennai", day="1", month="August", year="2026",
        total_paras=5, knowledge_paras=[(1, 3)], belief_paras=[(4, 5)],
    )
    out = tmp_path / "verification.docx"
    render_to_docx(ver.TEMPLATE, ctx, out)
    _assert_golden("verification_civil", extract_text(out))


# --------------------------------------------------------------------------
# Affidavit.
# --------------------------------------------------------------------------

def test_golden_affidavit(tmp_path):
    ctx = aff.build_context(
        deponent_name="Ramesh Kumar", age=42, parentage_type="son of",
        parentage_name="Krishnan", occupation="business",
        address="12 North Street, Mylapore, Chennai 600004", role="Plaintiff",
        proceeding="suit", place="Chennai", date="1 August 2026",
        attestor="Advocate",
        body_paras=["The defendant borrowed a sum of Rs.1,00,000.",
                    "The said amount remains unpaid despite demand."],
        prayer="grant a decree for recovery of the said sum",
    )
    out = tmp_path / "affidavit.docx"
    render_to_docx(aff.TEMPLATE, ctx, out)
    _assert_golden("affidavit", extract_text(out))


# --------------------------------------------------------------------------
# Prayer — civil.
# --------------------------------------------------------------------------

def test_golden_prayer_civil(tmp_path):
    result = pr.build(
        reliefs=[
            pr.Relief(type="recovery_of_money",
                      description="direct the defendant to pay Rs.1,00,000 with interest",
                      against_party="Defendant", is_interim=False, is_alternative=False),
        ],
        causes_of_action=["recovery_of_money"],
        proceeding=pr.Proceeding.CIVIL,
    )
    assert result.refused is False
    out = tmp_path / "prayer.docx"
    render_to_docx(pr.TEMPLATE, result.context, out)
    _assert_golden("prayer_civil", extract_text(out))
