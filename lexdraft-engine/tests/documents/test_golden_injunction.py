"""Golden-file test for the temporary injunction application (spec 4.2)."""

import os
from pathlib import Path

import pytest

from src.pipelines import injunction as inj
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


def test_golden_injunction(tmp_path):
    result = inj.build(
        suit_ref="O.S. No. 100 of 2024",
        subject_matter="the suit property at 12 North Street, Mylapore",
        applicant_name="Ramesh Kumar", applicant_role="plaintiff",
        brief_facts="",
        prima_facie_case="the applicant holds registered title to the suit property "
                         "and the defendant threatens dispossession without recourse to law",
        balance_of_convenience="the applicant is in settled possession and the "
                               "defendant will suffer no prejudice if the status quo is preserved",
        irreparable_injury="the suit property is unique and its loss cannot be "
                           "adequately compensated in monetary damages",
        urgency_conduct="the applicant has approached this Hon'ble Court promptly upon "
                        "learning of the threat.",
        undertaking_as_to_damages=True,
        act_restrained="alienating, encumbering or interfering with the applicant's "
                       "possession of the suit property",
        is_ex_parte=False, notice_futility=None,
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "injunction.docx"
    render_golden(inj.TEMPLATE, result.context, out)
    _assert_golden("injunction", extract_text(out))
