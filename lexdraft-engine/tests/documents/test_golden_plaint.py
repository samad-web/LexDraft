"""Golden-file test for the plaint — money recovery (spec 4.1)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import plaint as pl
from src.rules import jurisdiction as jur
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


def test_golden_plaint(tmp_path):
    result = pl.build(
        plaintiff_name="Ramesh Kumar", defendant_names=["Suresh Babu"],
        variant=pl.Variant.INDIVIDUAL,
        cause_of_action_date=date(2021, 6, 1), cause_of_action_place="Chennai",
        forum=jur.Forum.SUBORDINATE_JUDGE,
        territorial_bases=[jur.TerritorialBasis.DEFENDANT_RESIDES,
                           jur.TerritorialBasis.CAUSE_PART_AROSE],
        principal=100000, interest_amount=18000, claimed_total=118000,
        interest_rate=18.0, interest_is_contractual=True,
        interest_document_ref="loan agreement dated 01-01-2021, clause 4",
        limitation_article="19", limitation_trigger_date=date(2021, 6, 1),
        acknowledgements=[], filing_date=date(2024, 5, 1),
        is_government_defendant=False, s80_notice_ref=None,
        is_commercial_suit=False, s12a_ref=None,
        transaction_narrative="", performance_narrative="",
        default_narrative="", notice_narrative="",
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "plaint.docx"
    render_golden(pl.TEMPLATE, result.context, out)
    _assert_golden("plaint", extract_text(out))
