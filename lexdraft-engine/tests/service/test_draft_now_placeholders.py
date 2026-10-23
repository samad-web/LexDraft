"""Draft-now gaps: a visible "[… to be provided]" marker in a REQUIRED text field
is a 422 by default (the form is incomplete), and is accepted only when the
caller opts in with allow_placeholders — the "Draft now" gesture. The marker
still counts as an unfilled slot, so the draft stays un-signable."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
GAP = "[petitioner name to be provided]"
BODY = {
    "matter": {"matter_id": "M-GAPS-1", "version": 1},
    "fields": {"petitioner_name": GAP, "respondent_name": "Balu",
               "underlying_application": "I.A. No. 1 of 2026", "orders_prayed": "interim stay",
               "case_ref": "O.S. No. 5 of 2026", "place": "Chennai"},
}


def test_placeholder_in_required_field_is_422_by_default():
    r = client.post("/v1/draft/urgent_petition", json=BODY)
    assert r.status_code == 422
    assert {i["field"] for i in r.json()["issues"]} == {"petitioner_name"}


def test_draft_now_accepts_placeholder_but_it_stays_unfilled():
    r = client.post("/v1/draft/urgent_petition", json={**BODY, "allow_placeholders": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated"
    assert any(GAP in b["text"] for b in body["blocks"])
    assert "petitioner_name" in body["unfilled_slots"]   # sign-off stays blocked
