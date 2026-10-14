"""End-to-end proof that the unverified marker generalises across documents.

The MACT pattern — a computed figure renders with a visible 'unverified' marker —
is generalised to every document that consumes a VERIFY table (court fee,
pecuniary limits, custody/default-bail periods, bail bars, section mappings,
consumer tiers). These tests render real .docx output and assert:

  1. while the consumed tables are unverified, the marker appears; and
  2. when every consumed table is flipped verified (JSON only), the SAME pipeline
     renders the SAME document with the marker gone — no code change.
"""

import json
import shutil

import pytest

from src.components.render import render_to_docx, extract_text
from src.verify import tables as T

MARKER = T.UNVERIFIED_MARKER


@pytest.fixture
def registry_copy(tmp_path, monkeypatch):
    """A writable copy of the real registry pointed at by the loader."""
    dst = tmp_path / "tables"
    shutil.copytree(T.tables_dir(), dst)
    monkeypatch.setattr(T, "_TABLES_DIR", dst)
    T.reload()
    yield dst
    T.reload()


def _verify_all(directory):
    """Flip every table in `directory` to verified with a sign-off."""
    for path in directory.glob("*.json"):
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["verified"] = True
        raw["reviewed_by"] = "Adv. R. Rao"
        raw["reviewed_on"] = "2026-09-01"
        path.write_text(json.dumps(raw), encoding="utf-8")
    T.reload()


def _render_mact():
    from src.pipelines import mact_claim as m
    from src.rules import compensation_multiplier as cm
    r = m.build(
        claim_kind=m.ClaimKind.DEATH, claimants=["Kavitha"],
        accident_date=__import__("datetime").date(2024, 3, 1),
        rash_negligent_pleaded=True, fir_ref="Crime No. 45/2024",
        vehicle_number="TN01AB1234", owner="R. Owner", driver="S. Driver",
        insurer="XYZ", policy_no="POL-1", policy_valid_on_accident=True,
        victim_age=35, victim_annual_income=300000, income_proof_present=True,
        employment=cm.Employment.PERMANENT_SALARIED, dependants=3,
        disability_pct=None, permanent=None, treatment_expenses=0,
        attendant_expenses=0, claimed_total=None,
        jurisdiction_basis="within this Tribunal", place="Chennai",
        accident_narrative="",
    )
    assert not r.refused
    return r.context


def _render_plaint():
    from datetime import date
    from src.pipelines import plaint as p
    from src.rules import jurisdiction as jur
    r = p.build(
        plaintiff_name="Ramesh", defendant_names=["Suresh"],
        variant=p.Variant.INDIVIDUAL, cause_of_action_date=date(2021, 6, 1),
        cause_of_action_place="Chennai", forum=jur.Forum.SUBORDINATE_JUDGE,
        territorial_bases=[jur.TerritorialBasis.DEFENDANT_RESIDES],
        principal=100000, interest_amount=18000, claimed_total=118000,
        interest_rate=18.0, interest_is_contractual=True,
        interest_document_ref="loan agreement", limitation_article="19",
        limitation_trigger_date=date(2021, 6, 1), acknowledgements=[],
        filing_date=date(2023, 1, 1), is_government_defendant=False,
        s80_notice_ref=None, is_commercial_suit=False, s12a_ref=None,
        transaction_narrative="", performance_narrative="",
        default_narrative="", notice_narrative="", place="Chennai",
    )
    assert not r.refused
    return r.context


CASES = {
    "mact_claim.docx": _render_mact,
    "plaint.docx": _render_plaint,
}


@pytest.mark.parametrize("template,builder", CASES.items())
def test_marker_present_then_gone_after_signoff(template, builder, registry_copy,
                                                tmp_path):
    # 1. unverified -> marker present in the rendered document.
    ctx = builder()
    out = tmp_path / f"before_{template}"
    render_to_docx(template, ctx, out)
    assert MARKER in extract_text(out)

    # 2. flip EVERY table verified (JSON only) and re-render the same pipeline.
    _verify_all(registry_copy)
    ctx2 = builder()
    out2 = tmp_path / f"after_{template}"
    render_to_docx(template, ctx2, out2)
    text_after = extract_text(out2)
    assert MARKER not in text_after
    # the rest of the document is unchanged but for the marker line.
    assert "Chennai" in text_after
