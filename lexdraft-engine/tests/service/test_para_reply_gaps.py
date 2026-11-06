"""r7: a written statement / counter affidavit drafted from a brief that answers
only some paragraphs. An unanswered paragraph is pleaded "not admitted" (never
deemed admitted, O.VIII R.5), and an unknown count is the highest one answered."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-GAPS-WS", "version": 1}


def _text(r):
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


def test_written_statement_unknown_count_and_unanswered_paras_are_not_admitted():
    replies = [{"plaint_para": n, "stance": "denied", "text": f"Para {n} is denied."} for n in (3, 4)]
    text = _text(client.post("/v1/draft/written_statement", json={"matter": MATTER, "fields": {
        "plaintiff_name": "P. Raju", "defendant_name": "K. Lakshmanan", "suit_ref": "O.S. No. 790 of 2026",
        "plaint_para_count": 0, "merit_replies": replies, "filing_date": "2026-11-05", "place": "Tiruchirappalli"}}))
    for n in (1, 2):
        assert f"paragraph {n} of the plaint are not admitted" in text
    assert "Para 3 is denied." in text and "Para 4 is denied." in text


def test_counter_affidavit_fills_the_unanswered_paragraph():
    text = _text(client.post("/v1/draft/counter_affidavit", json={"matter": MATTER, "fields": {
        "petition_ref": "I.A. No. 1120 of 2026", "petitioner_names": ["K. Arumugam"],
        "respondent_names": ["M. Selvaraj"], "answering_respondent_serial": 1,
        "deponent_name": "M. Selvaraj", "deponent_description": "the respondent",
        "petition_para_count": 3, "para_replies": [{"para": 2, "stance": "denied", "text": "Denied."}],
        "affirm_date": "2026-11-05", "place": "Coimbatore"}}))
    assert "paragraph 1 are not admitted" in text and "paragraph 3 are not admitted" in text


def test_bail_does_not_double_the_crime_no_prefix():
    """r7: the extractor returned "Crime No. 233 of 2026"; the draft read "Crime No. Crime No."."""
    r = client.post("/v1/draft/anticipatory_bail", json={"matter": MATTER, "fields": {
        "accused_name": "N. Suresh Babu", "age": 41, "occupation": "trader", "address": "Coimbatore",
        "fir_no": "Crime No. 233 of 2026", "police_station": "CCB", "district": "Coimbatore",
        "sections": ["BNS 316(2)"], "bail_court": "Principal Sessions Judge, Coimbatore", "place": "Coimbatore",
        "already_arrested": False, "is_fresh_action": True, "offence_date": "2026-10-01",
        "apprehension_basis": "called for enquiry"}})
    text = _text(r)
    assert "Crime No. 233 of 2026" in text and "Crime No. Crime No." not in text
