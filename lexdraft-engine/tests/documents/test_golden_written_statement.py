"""Golden-file test for the written statement (DPC book pp.27-29)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import written_statement as ws
from src.pipelines.written_statement import (MeritReply, PreliminaryObjection,
                                             Stance)
from src.components.render import extract_text
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


def test_golden_written_statement(tmp_path):
    r = ws.build(
        plaintiff_name="X", defendant_name="Y", suit_ref="SUIT NO. 100 OF 2024",
        plaint_para_count=4,
        preliminary_objections=[
            PreliminaryObjection("That the suit is barred by limitation under the "
                                 "Limitation Act and is liable to be dismissed."),
            PreliminaryObjection("That this Hon'ble Court has no jurisdiction to "
                                 "entertain and try this suit."),
            PreliminaryObjection("That there is no cause of action in favour of the "
                                 "plaintiff and against the defendant."),
        ],
        merit_replies=[
            MeritReply(1, Stance.ADMITTED,
                       "That the contents of para 1 of the plaint are correct and "
                       "are admitted."),
            MeritReply(2, Stance.NOT_ADMITTED,
                       "That the contents of para 2 of the plaint are denied for "
                       "want of knowledge; the plaintiff be put to strict proof."),
            MeritReply(3, Stance.DENIED,
                       "That the contents of para 3 of the plaint are absolutely "
                       "incorrect and are denied. It is specifically denied that the "
                       "plaintiff is the owner of the suit property."),
            MeritReply(4, Stance.DENIED,
                       "That the contents of para 4 of the plaint are denied; the "
                       "defendant is in lawful possession of the suit property."),
        ],
        filing_date=date(2024, 6, 1), place="Chennai",
        civil_court="THE CIVIL JUDGE (SENIOR DIVISION)", city="Chennai",
    )
    assert r.refused is False
    out = tmp_path / "written_statement.docx"
    render_golden(ws.TEMPLATE, r.context, out)
    _assert_golden("written_statement", extract_text(out))
