"""Golden-file tests for contested divorce (6.1) and mutual-consent motions (6.2)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import divorce_contested as dc
from src.pipelines import divorce_mutual as dm
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


def test_golden_divorce_contested_cruelty(tmp_path):
    result = dc.build(
        petitioner_name="Anita", respondent_name="Rakesh",
        marriage_date=date(2018, 5, 1), marriage_place="Chennai",
        filing_date=date(2024, 5, 1),
        ground=dc.Ground.CRUELTY,
        cruelty_instances=[dc.DatedInstance(date=date(2023, 1, 10),
                                            description="the respondent assaulted the petitioner")],
        separation_since=None, animus_deserendi=None, without_consent=None,
        without_reasonable_cause=None,
        adultery_instance=None, co_respondent_joined=None, non_joinder_reason=None,
        no_collusion=True, no_connivance=True, no_condonation=True,
        children=["Minor A"], custody_position="with the mother",
        maintenance_position="Rs.10,000 per month by the respondent",
        jurisdiction_basis=dc.Section19Basis.MARRIAGE_SOLEMNISED,
        place="Chennai", grounds_narrative="",
    )
    assert result.refused is False
    out = tmp_path / "divorce_contested.docx"
    render_golden(dc.TEMPLATE, result.context, out)
    _assert_golden("divorce_contested_cruelty", extract_text(out))


def test_golden_divorce_mutual_first(tmp_path):
    result = dm.build_first_motion(
        party_a="Anita", party_b="Rakesh",
        marriage_date=date(2015, 1, 1), marriage_place="Chennai",
        living_separately_since=date(2022, 1, 1),
        first_motion_date=date(2024, 1, 1),
        settlement=dm.Settlement(maintenance="Rs.10,000 per month to the wife",
                                 custody="with the mother",
                                 property="the flat is retained by the wife"),
        joint_affidavit=True, place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "divorce_mutual_first.docx"
    render_golden(dm.TEMPLATE_FIRST, result.context, out)
    _assert_golden("divorce_mutual_first", extract_text(out))


def test_golden_divorce_mutual_second(tmp_path):
    result = dm.build_second_motion(
        party_a="Anita", party_b="Rakesh",
        first_motion_order_date=date(2024, 1, 1),
        second_motion_date=date(2024, 9, 1),
        settlement_implemented=True, waiver_sought=False, place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "divorce_mutual_second.docx"
    render_golden(dm.TEMPLATE_SECOND, result.context, out)
    _assert_golden("divorce_mutual_second", extract_text(out))
