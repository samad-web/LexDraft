"""Golden-file test for the consumer complaint (spec 7.1)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import consumer_complaint as cc
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


def test_golden_consumer_complaint(tmp_path):
    result = cc.build(
        complainant_name="Ravi Shankar", opposite_party_name="Acme Appliances Ltd",
        purpose=cc.Purpose.PERSONAL,
        consideration_paid=40000, transaction_date=date(2023, 1, 1),
        invoice_ref="invoice No. 88 dated 01-01-2023",
        cause_of_action_date=date(2023, 2, 1), filing_date=date(2024, 6, 1),
        compensation=15000, compensation_basis="cost of repair and mental agony",
        affidavit_present=True, evidence_affidavit_present=True,
        territorial_basis="the opposite party carries on business within this "
                          "forum's jurisdiction",
        place="Chennai", defect_narrative="", complaints_narrative="",
    )
    assert result.refused is False
    out = tmp_path / "consumer_complaint.docx"
    render_golden(cc.TEMPLATE, result.context, out)
    _assert_golden("consumer_complaint", extract_text(out))
