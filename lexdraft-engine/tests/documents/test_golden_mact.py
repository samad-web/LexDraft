"""Golden-file test for the MACT claim petition (spec 7.2)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import mact_claim as mact
from src.rules import compensation_multiplier as cm
from src.components.render import render_to_docx, extract_text
from ._golden import render_golden

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
    assert text == path.read_text(encoding="utf-8"), f"{name} drifted from golden"


def test_golden_mact_death(tmp_path):
    result = mact.build(
        claim_kind=mact.ClaimKind.DEATH,
        claimants=["Kavitha (widow)", "Minor A", "Minor B"],
        accident_date=date(2024, 3, 1), rash_negligent_pleaded=True,
        fir_ref="Crime No. 45/2024, B1 Traffic Police Station",
        vehicle_number="TN01AB1234", owner="R. Owner", driver="S. Driver",
        insurer="XYZ General Insurance", policy_no="POL-99887",
        policy_valid_on_accident=True,
        victim_age=35, victim_annual_income=300000, income_proof_present=True,
        employment=cm.Employment.PERMANENT_SALARIED, dependants=3,
        disability_pct=None, permanent=None,
        treatment_expenses=0, attendant_expenses=0,
        claimed_total=None,
        jurisdiction_basis="the accident occurred within this Tribunal's "
                           "jurisdiction (s.166(2) MV Act)",
        place="Chennai", accident_narrative="",
    )
    assert result.refused is False
    out = tmp_path / "mact_claim.docx"
    render_golden(mact.TEMPLATE, result.context, out)
    _assert_golden("mact_claim_death", extract_text(out))
