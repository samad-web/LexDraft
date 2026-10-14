"""Golden-file test for the Article 226 writ petition (spec 5.1)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import writ_petition as wp
from src.factsheet import Party, PartyRole
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


def test_golden_writ_mandamus(tmp_path):
    result = wp.build(
        petitioner=Party(role=PartyRole.PETITIONER, serial=1, name="Citizen A"),
        respondents=[
            Party(role=PartyRole.RESPONDENT, serial=1, name="State of Tamil Nadu",
                  is_authority=True),
            Party(role=PartyRole.RESPONDENT, serial=2, name="Private Co",
                  is_authority=False),
        ],
        court_place="Madras", court_side="Appellate",
        writ_type=wp.WritType.MANDAMUS,
        legal_right="the petitioner's statutory right to a trade licence",
        public_duty="the respondent's duty under s.15 of the parent Act to decide the application",
        prior_demand_and_refusal="represented on 01-02-2024; refused on 15-02-2024",
        quasi_judicial_order=None, public_office=None,
        impugned_order_number="Proceedings No. 45/2024",
        impugned_order_date=date(2024, 2, 15), impugned_order_annexed=True,
        alternative_remedy_addressed=True,
        alternative_remedy_basis="the appellate remedy is illusory as the same "
                                 "authority decides the appeal",
        impugned_action_recent=True, delay_explanation=None,
        laches_threshold_days=90, impugned_action_date=date(2024, 2, 15),
        filing_date=date(2024, 3, 1),
        petitioner_name="Citizen A", no_similar_petition=True,
        place="Chennai", day="1", month="March", year="2024",
        facts_narrative="", grounds_narrative="",
    )
    assert result.refused is False
    out = tmp_path / "writ_petition.docx"
    render_golden(wp.TEMPLATE, result.context, out)
    _assert_golden("writ_petition_mandamus", extract_text(out))
