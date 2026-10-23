"""The review banner can be kept out of the document text (the app shows draft
status in its own UI). Default unchanged: the banner is in the document."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
BODY = {
    "matter": {"matter_id": "M-BANNER-1", "version": 1},
    "fields": {"petitioner_name": "Anand", "respondent_name": "Balu",
               "underlying_application": "I.A. No. 1 of 2026", "orders_prayed": "interim stay",
               "case_ref": "O.S. No. 5 of 2026", "place": "Chennai"},
}


def _text(r):
    return "\n".join(b["text"] for b in r.json()["blocks"]).lower()


def test_banner_in_document_by_default():
    r = client.post("/v1/draft/urgent_petition", json=BODY)
    assert "for advocate review" in _text(r)


def test_banner_kept_out_of_document_on_request_but_still_signalled():
    r = client.post("/v1/draft/urgent_petition", json={**BODY, "review_banner_in_document": False})
    assert r.status_code == 200
    assert "for advocate review" not in _text(r)
    assert "advocate review" in r.json()["signals"]["review_banner"].lower()
