"""r17: the 5 benchmark-h2h v2 checklist FAILs the AI compose step lost, now carried
by the engine output itself. One test per item, through the real /v1/draft endpoint."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from tests.service.test_r16_checklists import PI, WRIT, WS, _text  # noqa: E402
from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402

S138 = {**PAYLOADS["s138_complaint"], "accused_name": "M/s. Sunrise Foods Private Limited",
        "accused_is_company": True,
        "s141_averment": "A2 is the Managing Director in charge of the business",
        "additional_accused": [{"name": "Mr. A. Karthik", "description": "Managing Director"}]}


def test_s138_complaint_item4_s141_at_the_time_of_offence():
    text = _text("s138_complaint", S138)
    assert ("Accused No. 2, Mr. A. Karthik, Managing Director, was in charge of and responsible to the "
            "company, Accused No. 1, for the conduct of its business at the time the offence was "
            "committed") in text
    assert "Section 141(1) of the Negotiable Instruments Act, 1881" in text
    # an individual drawer: no vicarious-liability averment
    assert "Section 141(1)" not in _text("s138_complaint", PAYLOADS["s138_complaint"])


def test_s138_complaint_item10_one_month_s142_1_b():
    # notice delivered 05.02.2024 -> cause of action 21.02.2024 -> last date 21.03.2024
    text = _text("s138_complaint", PAYLOADS["s138_complaint"])
    assert ("the cause of action arose on 21.02.2024 under clause (c) of the proviso to Section 138 "
            "of the Negotiable Instruments Act, 1881, and that the present complaint is filed within "
            "one month of the date on which the cause of action arose, the last date being 21.03.2024, "
            "as required by Section 142(1)(b) of that Act") in text


def test_permanent_injunction_item3_defendant_relationship():
    pi = {**PI, "defendant_names": ["Mr. K. Duraisamy"], "defendant_relationships": ["the plaintiff's cousin"]}
    text = _text("permanent_injunction", pi)
    assert "Mr. K. Duraisamy, the plaintiff's cousin" in text           # cause title
    assert "The defendant, Mr. K. Duraisamy, is the plaintiff's cousin." in text   # para 1
    plain = _text("permanent_injunction", {**pi, "defendant_relationships": None})
    assert "cousin" not in plain
    gap = _text("permanent_injunction", {**pi, "defendant_relationships": ["[relationship to be provided]"]},
                allow_placeholders=True)
    assert "the plaintiff's [" not in gap


def test_written_statement_item7_interest_rate_denied():
    text = _text("written_statement", {**WS, "plaint_claims": "Rs. 3,50,000 with interest at 24% p.a."})
    assert "The plaintiff's claim for interest at 24% p.a. is denied as excessive and not agreed." in text
    # the rate quoted in a merit reply is enough
    quoted = {**WS, "merit_replies": [*WS["merit_replies"][:2],
              {"plaint_para": 3, "stance": "denied",
               "text": "The claim for interest at the rate of 18 per cent per annum is denied."}]}
    assert "claim for interest at 18% p.a. is denied as excessive and not agreed" in _text("written_statement", quoted)
    # no rate claimed -> nothing invented
    assert "denied as excessive" not in _text("written_statement", WS)


def test_writ_petition_item10_mandamus_period():
    text = _text("writ_petition", WRIT, allow_placeholders=True)
    assert ("within a period of eight weeks from the date of receipt of a copy of this order, or within "
            "such time as this Hon'ble Court may fix") in text
    given = _text("writ_petition", {**WRIT, "compliance_period": "four weeks"}, allow_placeholders=True)
    assert "within a period of four weeks from the date of receipt" in given
    # a period the relief itself states moves into the clause, not doubled
    own = _text("writ_petition", {**WRIT, "relief_sought": "sanction pension within 6 weeks"},
                allow_placeholders=True)
    assert "sanction pension in accordance with" in own and "within a period of 6 weeks from" in own


def test_permanent_injunction_item3_relationship_with_trailing_punctuation():
    # r17 v3: the extractor gave "Cousin of the plaintiff;" -> "the plaintiff's Cousin of the plaintiff;"
    from src.pipelines.permanent_injunction import _relationship
    for raw in ("Cousin of the plaintiff;", "the plaintiff's cousin.", "Cousin"):
        assert _relationship([raw], 0) == "cousin"
