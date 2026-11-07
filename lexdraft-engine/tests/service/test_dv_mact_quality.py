"""Drafting-quality fixes (2026-11-07) for dv_application and mact_claim, through
the real /v1/draft endpoint with the suite briefs' facts."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-DV-MACT-QA", "version": 1}


def _text(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


_DV = {
    "aggrieved_name": "Mrs. J. Anitha", "aggrieved_age": 32,
    "aggrieved_address": "No. 15, Kilpauk, Chennai 600010",
    "respondent_name": "Mr. V. Sathish",
    "respondent_names": ["Mr. V. Sathish (husband)", "Mrs. V. Kamala (mother-in-law)"],
    "respondent_address": "No. 44, Ashok Nagar, Chennai 600083",
    "domestic_relationship_pleaded": True,
    "domestic_relationship_basis": "married to the 1st respondent on 05.06.2019",
    "shared_household_pleaded": True,
    "shared_household_particulars": "No. 44, Ashok Nagar, Chennai 600083",
    "reliefs": [
        {"head": "s.18 protection", "averment": "Protection order under Section 18 restraining the respondents"},
        {"head": "s.20 monetary", "averment": "Monetary relief of Rs. 30,000 per month under Section 20"},
    ],
    "incidents": [{"category": "physical", "date": "2026-09-02", "description": "physical assault"}],
    "jurisdiction_basis": "the aggrieved person resides at Kilpauk, Chennai",
    "place": "Chennai", "magistrate_court": "Judicial Magistrate, Mahila Court", "city": "Chennai",
}


def test_dv_application_cause_title_lists_each_respondent_once_with_addresses():
    text = _text("dv_application", _DV)
    head = text.split("PETITION FILED UNDER")[0]
    assert head.count("Sathish") == 1 and "3." not in head
    assert "1. Mr. V. Sathish (husband)" in head and "2. Mrs. V. Kamala (mother-in-law)" in head
    assert "All residing at No. 44, Ashok Nagar, Chennai 600083" in head
    assert "Mrs. J. Anitha, aged about 32 years, residing at No. 15, Kilpauk" in head


def test_dv_application_prayer_not_colon_joined_and_no_stray_slot_marker():
    text = _text("dv_application", _DV)
    prayer = text.split("PRAYER:")[1]
    assert "domestic violence against the aggrieved person;" in prayer
    assert "monetary relief under Section 20 of the Act of Rs. 30,000 per month;" in prayer
    assert "person: Protection order" not in prayer and ": Monetary relief" not in prayer
    assert "[to be drafted]" not in text
