"""Golden-file test for the O37 summary suit (spec 4.1, separate skeleton)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import summary_suit as ss
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


def test_golden_summary_suit(tmp_path):
    result = ss.build(
        plaintiff_name="Ramesh Kumar", defendant_names=["Suresh Babu"],
        claim_basis=ss.ClaimBasis.PROMISSORY_NOTE,
        instrument_ref="promissory note dated 01-01-2023",
        cause_of_action_date=date(2023, 1, 1), cause_of_action_place="Chennai",
        forum=jur.Forum.SUBORDINATE_JUDGE,
        territorial_bases=[jur.TerritorialBasis.DEFENDANT_RESIDES],
        principal=100000, interest_amount=12000, claimed_total=112000,
        interest_rate=12.0, interest_is_contractual=True,
        interest_document_ref="promissory note dated 01-01-2023",
        limitation_article="35", limitation_trigger_date=date(2023, 1, 1),
        acknowledgements=[], filing_date=date(2024, 5, 1),
        transaction_narrative="",
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "summary_suit.docx"
    render_golden(ss.TEMPLATE, result.context, out)
    _assert_golden("summary_suit", extract_text(out))
