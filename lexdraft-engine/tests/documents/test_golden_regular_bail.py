"""Golden-file test for the regular-bail application (spec 3.2)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import regular_bail as rb
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


def test_golden_regular_bail(tmp_path):
    result = rb.build(
        accused_name="Arun Prasad", age=29, occupation="mechanic",
        address="3 Lake View Road, Chennai 600020",
        fir_no="55/2024", police_station="Adyar", district="Chennai",
        sections=["BNS s.115"],
        offence_date=date(2024, 8, 1), proceeding_start_date=date(2024, 8, 5),
        is_fresh_action=False,
        custody_since=date(2024, 8, 10), as_on=date(2024, 9, 10),
        prison="Puzhal Central Prison", chargesheet_filed=True,
        special_statute=None, bail_bar_addressed=False,
        is_successive=False, prior_order_ref=None, change_of_circumstance=None,
        parity_claims=[{"co_accused": "Ravi Kumar",
                        "order_ref": "Crl.M.P. 90/2024 dated 20-08-2024"}],
        court_level="sessions", prosecution_case="", grounds="",
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "regular_bail.docx"
    render_golden(rb.TEMPLATE, result.context, out)
    _assert_golden("regular_bail", extract_text(out))
