"""/v1/draft: contradictory custody dates are a 422 on as_on (not a 500), and the
"[figures unverified …]" status line never reaches the filed document."""

from fastapi.testclient import TestClient

from src.service.app import app
from src.verify.tables import UNVERIFIED_MARKER

FIELDS = dict(
    accused_name="X", age=30, occupation="driver", address="Chennai",
    fir_no="45/2024", police_station="E4", district="Chennai",
    sections=["BNS 318"], offence_date="2024-01-01", is_fresh_action=True,
    custody_since="2024-01-02", as_on="2024-03-10",
    prison="Puzhal", chargesheet_filed=False, court_level="sessions",
    place="Chennai",
)
MATTER = {"matter_id": "m-test", "version": 1}

client = TestClient(app)


def test_as_on_before_custody_is_422_on_as_on():
    r = client.post("/v1/draft/regular_bail", json={
        "matter": MATTER, "fields": {**FIELDS, "as_on": "2023-12-31"}, "render": False,
    })
    assert r.status_code == 422
    assert [i["field"] for i in r.json()["issues"]] == ["as_on"]


def test_blocks_carry_layout():
    r = client.post("/v1/draft/regular_bail", json={"matter": MATTER, "fields": FIELDS, "render": True})
    blocks = r.json()["blocks"]
    court = next(b for b in blocks if b["text"].startswith("IN THE COURT OF"))
    assert court["align"] == "center" and court.get("bold") is True
    body = next(b for b in blocks if b["text"].startswith("1."))
    assert "align" not in body or body["align"] != "center"


def test_unverified_marker_not_in_the_document():
    r = client.post("/v1/draft/regular_bail", json={"matter": MATTER, "fields": FIELDS, "render": True})
    assert r.status_code == 200, r.text
    body = r.json()
    text = "\n".join(b["text"] for b in body["blocks"])
    assert UNVERIFIED_MARKER not in text
    assert "figures unverified" not in text
