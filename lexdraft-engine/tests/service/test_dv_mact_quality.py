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


_MACT = {
    "claim_kind": "death",
    "claimants": ["Mrs. K. Priya (31), wife", "K. Arjun (6), son", "Mrs. S. Lakshmi (60), mother"],
    "accident_date": "2026-05-12", "rash_negligent_pleaded": True,
    "fir_ref": "Crime No. 188 of 2026, Pallavaram Traffic Investigation police",
    "vehicle_number": "TN-22-AK-9032", "owner": "Mr. R. Shankar", "driver": "Driver of lorry TN-22-AK-9032",
    "insurer": "United India Insurance Co. Ltd.", "policy_no": "0412/31/26/9988",
    "policy_valid_on_accident": True, "victim_age": 34, "victim_annual_income": 540000,
    "income_proof_present": True, "employment": "permanent_salaried", "dependants": 3,
    "treatment_expenses": 0, "attendant_expenses": 0,
    "jurisdiction_basis": "the petitioners reside at Chennai",
    "accident_place": "GST Road near Pallavaram",
    "place": "Chennai", "tribunal_place": "Chennai", "filing_date": "2026-11-07",
}


def test_mact_claim_respondents_driver_owner_insurer_in_brief_order():
    head = _text("mact_claim", _MACT).split("CLAIM PETITION FILED")[0]
    assert head.index("(driver of the vehicle)") < head.index("(owner of the vehicle)") \
        < head.index("(insurer of the vehicle)")
    assert "1. Driver of lorry TN-22-AK-9032 (driver" in head and "2. Mr. R. Shankar (owner" in head


def test_mact_claim_consortium_to_each_claimant_with_pranay_sethi_enhancement():
    # filed 07.11.2026: three completed three-year periods since 31.10.2017 ->
    # 15,000 / 40,000 x 1.1^3 = 19,965 / 53,240 (Pranay Sethi); consortium to each
    # of the three claimants (Magma v. Nanu Ram).
    text = _text("mact_claim", _MACT)
    assert "loss of estate: Rs. 19,965/-" in text
    assert "Rs. 1,59,720/-" in text and "3 claimants" in text
    assert "funeral expenses: Rs. 19,965/-" in text
    assert "Rs. 88,39,650/-" in text  # 86,40,000 + 1,99,650


def test_mact_claim_minor_son_sues_by_mother_as_next_friend_and_place_pleaded():
    text = _text("mact_claim", _MACT)
    assert "K. Arjun (6), son, minor, represented by his mother and next friend, the 1st petitioner" in text
    assert "The accident occurred at GST Road near Pallavaram, within the jurisdiction of this Tribunal" in text
    assert "Section 166(2) of the Motor Vehicles Act, 1988" in text


def test_dv_application_prayer_not_colon_joined_and_no_stray_slot_marker():
    text = _text("dv_application", _DV)
    prayer = text.split("PRAYER:")[1]
    assert "domestic violence against the aggrieved person;" in prayer
    assert "monetary relief under Section 20 of the Act of Rs. 30,000 per month;" in prayer
    assert "person: Protection order" not in prayer and ": Monetary relief" not in prayer
    assert "[to be drafted]" not in text


def test_dv_application_residence_reentry_or_alternative_accommodation_and_affidavit():
    """r12: she was thrown out on 03.09.2026, yet s.19 only restrained dispossession;
    the affidavit was a NOTE."""
    ousted = {**_DV, "reliefs": _DV["reliefs"] + [
        {"head": "s.19 residence", "averment": "Residence order; she was thrown out on 03.09.2026"}]}
    prayer = _text("dv_application", ousted).split("PRAYER:")[1]
    assert "directing the respondents to restore the aggrieved person to the shared household" in prayer
    assert "alternate accommodation of the same level as she enjoyed in the shared household or to pay rent" in prayer
    # still living there: the plain non-dispossession order
    stays = {**_DV, "reliefs": _DV["reliefs"] + [{"head": "s.19 residence", "averment": "Residence order"}]}
    text = _text("dv_application", stays)
    assert "restraining the respondents from dispossessing the aggrieved person from the shared household" in text
    assert "AFFIDAVIT FILED IN SUPPORT OF THE PETITION\nI, Mrs. J. Anitha, aged about 32 years, residing at No. 15, Kilpauk" in text
    assert "[NOTE: This application must be supported by an Affidavit" not in text and "{%" not in text


def test_mact_claim_unset_dependants_counts_the_claimants_not_a_500():
    # r11: draft-now sent dependants=0 and compute_death raised -> HTTP 500.
    text = _text("mact_claim", {**_MACT, "dependants": 0})
    assert "Rs. 88,39,650" in text or "88,39,650" in text
