"""Golden-file tests for the default-bail and anticipatory-bail documents (3.4, 3.3)."""

import os
from datetime import date, datetime
from pathlib import Path

import pytest

from src.pipelines import default_bail as db
from src.pipelines import anticipatory_bail as ab
from src.rules import custody_computation as cc
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


def test_golden_default_bail(tmp_path):
    result = db.build(
        accused_name="Murugan", age=34, occupation="driver",
        address="5 East Street, Chennai 600042",
        fir_no="123/2024", police_station="E4 Abiramapuram", district="Chennai",
        sections=["BNS s.318"],
        offence_date=date(2024, 8, 1),
        proceeding_start_date=date(2024, 8, 5),
        is_fresh_action=False,
        first_remand_date=date(2024, 1, 2),
        offence=cc.Offence(max_punishment_years=7),
        special_statute=None,
        as_on=date(2024, 3, 10),
        application_ts=datetime(2024, 3, 10, 11, 0, 0),
        chargesheet_filed_ts=None,
        readiness_to_furnish_bail=True,
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "default_bail.docx"
    render_golden(db.TEMPLATE, result.context, out)
    _assert_golden("default_bail", extract_text(out))


def test_golden_anticipatory_bail(tmp_path):
    result = ab.build(
        accused_name="Selvam", age=40, occupation="contractor",
        address="9 West Street, Chennai 600001",
        fir_no="88/2024", police_station="Guindy", district="Chennai",
        sections=["BNS s.318"],
        offence_date=date(2024, 8, 1), proceeding_start_date=None, is_fresh_action=True,
        apprehension_basis="the FIR arises out of a civil property dispute and the "
                           "de facto complainant has threatened the applicant with arrest",
        already_arrested=False, is_scst_offence=False, is_transit=False,
        prosecution_case="",
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "anticipatory_bail.docx"
    render_golden(ab.TEMPLATE, result.context, out)
    _assert_golden("anticipatory_bail", extract_text(out))
