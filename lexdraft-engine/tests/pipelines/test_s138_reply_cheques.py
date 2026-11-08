from datetime import date

import pytest

from src.pipelines.s138_reply import build


@pytest.mark.parametrize("given, want", [
    ("Both signed blank cheques", "both signed blank cheques"),
    ("Cheque No. 204517", "Cheque No. 204517"),
])
def test_cheques_to_return_reads_mid_sentence(given, want):
    r = build(advocate="A", client="C", opposing_advocate="O", notice_date=date(2026, 10, 20),
              defence_narrative="The debt is denied.", liability_denied=True,
              cheque_in_discharge_denied=True, place="Trichy", cheques_to_return=given)
    assert r.context["cheques_to_return"] == want
