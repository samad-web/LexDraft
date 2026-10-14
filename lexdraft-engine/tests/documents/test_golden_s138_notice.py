"""Golden-file test for the s.138 statutory notice (spec 2.2).

A known valid notice renders to a known .docx; diff on the extracted text.
Run with LEXDRAFT_UPDATE_GOLDEN=1 to (re)write the golden.
"""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import s138_notice as notice
from src.pipelines.s138_notice import Cheque
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


def test_golden_s138_notice_single_cheque(tmp_path):
    result = notice.build(
        client="Ramesh Kumar", advocate="Adv. K. Kannan",
        advocate_enrolment="MS/1234/2010",
        recipient_name="Suresh Babu", recipient_address="8 South Street, Chennai 600001",
        cheques=[Cheque(number="000123", date=date(2024, 1, 1), amount=125000,
                        bank="State Bank of India", branch="Mylapore",
                        drawer="Suresh Babu", payee="Ramesh Kumar")],
        debt_nature="a hand loan of Rs.1,25,000 advanced on 01-12-2023",
        debt_documents=["loan acknowledgement dated 01-12-2023"],
        presentation_date=date(2024, 1, 10), presentation_bank="Indian Bank, Adyar",
        memo_date=date(2024, 1, 12), memo_received_date=date(2024, 1, 15),
        dishonour_reason="Funds insufficient",
        notice_date=date(2024, 1, 20),
        dispatch_mode="Registered Post Acknowledgement Due",
        dispatch_tracking_placeholder="{{ rpad_tracking }}",
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "s138_notice.docx"
    render_golden(notice.TEMPLATE, result.context, out)
    _assert_golden("s138_notice_single_cheque", extract_text(out))
