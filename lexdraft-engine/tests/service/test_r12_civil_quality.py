"""r12 reviewer findings (2026-11-07) for plaint, condone_delay_petition, summary_suit,
indigent_application, hrcp_eviction, lease_deed, succession_certificate and
succession_grant, drafted through the real /v1/draft endpoint from the suite briefs."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402
from tests.service.test_civil_suit_review import PLAINT  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R12-CIVIL", "version": 1}


def _text(doc_type, fields, **body):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **body})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# ---- plaint: Rs. 9.57 lakh goods claim between two firms is a commercial dispute ----

def test_plaint_goods_claim_between_firms_goes_to_the_commercial_court():
    text = _text("plaint", {**PLAINT, "plaintiff_representative": "Mr. G. Venkatesh, managing partner"})
    assert text.startswith("IN THE COMMERCIAL COURT AT CHENNAI") or \
        "\nIN THE COMMERCIAL COURT AT CHENNAI" in text
    assert "C.O.S. No. ______ of 2026" in text
    assert "City Civil Court" not in text.split("PLAINT FILED")[0]
    assert "Section 2(1)(c)(i) of the Commercial Courts Act, 2015" in text
    assert "Section 12A of the Commercial Courts Act, 2015" in text
    assert "[particulars of the s.12A pre-institution mediation" in text
    assert "STATEMENT OF TRUTH" in text and "Order VI Rule 15A" in text
    assert "I, Mr. G. Venkatesh, managing partner, for and on behalf of M/s. Lotus Electricals" in text
    assert "VERIFICATION:" not in text


def test_plaint_below_specified_value_stays_an_ordinary_suit():
    small = {**PLAINT, "principal": 200000,
             "interest_tranches": [{"amount": 200000, "from_date": "2026-01-05"}]}
    text = _text("plaint", small)
    assert "COMMERCIAL COURT" not in text and "STATEMENT OF TRUTH" not in text
    assert "VERIFICATION:" in text


def test_plaint_cause_of_action_place_gap_filled_from_the_shared_city():
    text = _text("plaint", {**PLAINT, "cause_of_action_place": "[cause of action place to be provided]"},
                 allow_placeholders=True)
    assert "arose at Chennai on 05.01.2026" in text
