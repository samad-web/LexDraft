"""Drafting-quality fixes (2026-11-07) for the family / succession / contempt
formats, driven through the real /v1/draft endpoint with the suite briefs' facts.
Each test is named after the format and the defect the reviewer found."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-FAMILY-QA", "version": 1}


def _text(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# ---- divorce_contested -------------------------------------------------------

_DIVORCE = {
    "petitioner_name": "R. Dinesh", "respondent_name": "D. Kavya",
    "petitioner_age": 34, "petitioner_address": "No. 2, R.S. Puram, Coimbatore 641002",
    "respondent_age": 30, "respondent_address": "No. 9, Saibaba Colony, Coimbatore 641011",
    "marriage_date": "2021-02-10", "marriage_place": "Sri Koniamman Temple, Coimbatore",
    "filing_date": "2026-11-07", "ground": "cruelty",
    "cruelty_instances": [{"date": "2025-01-14",
                           "description": "False complaint to police, closed as false"}],
    "separation_since": "2025-03-01",
    "no_collusion": True, "no_connivance": True, "no_condonation": True,
    "children": ["No children"],
    "jurisdiction_basis": "marriage_solemnised", "place": "Coimbatore",
    "family_court": "Family Court", "city": "Coimbatore",
}


def test_divorce_contested_names_clause_13_1_ia_in_title_ground_and_prayer():
    text = _text("divorce_contested", _DIVORCE)
    assert "UNDER SECTION 13(1)(ia) OF THE HINDU MARRIAGE ACT" in text
    assert "GROUND under Section 13(1)(ia) of the Hindu Marriage Act, 1955 — cruelty" in text
    assert "decree of divorce under Section 13(1)(ia)" in text and "on the ground of cruelty" in text
    # the bare parent the composer kept dropping is gone from the skeleton
    assert "s.13(1) —" not in text and "under s.13 of" not in text


def test_divorce_contested_no_empty_paras_no_custody_placeholder_when_no_children():
    text = _text("divorce_contested", _DIVORCE)
    assert "R. Dinesh, aged about 34 years, residing at No. 2, R.S. Puram" in text
    assert "D. Kavya, aged about 30 years, residing at No. 9, Saibaba Colony" in text
    assert "living separately since 01.03.2025" in text
    assert "No child was born of the marriage." in text
    assert "custody position to be provided" not in text and "Custody:" not in text
    assert "as set out herein" not in text and "[to be drafted]" not in text
    assert "treated the petitioner with cruelty" in text
    assert ("The marriage was solemnised at Sri Koniamman Temple, Coimbatore, within the local "
            "limits of the jurisdiction") in text
    assert "Section 19 of the Hindu Marriage Act, 1955" in text


# ---- divorce_mutual_first / divorce_mutual_second ----------------------------

_FIRST = {
    "party_a": "Mr. L. Prakash", "party_b": "Mrs. P. Shalini",
    "marriage_date": "2017-08-25", "marriage_place": "Chennai",
    "living_separately_since": "2025-03-01", "first_motion_date": "2026-11-07",
    "settlement_maintenance": "Rs. 30,00,000 as full and final permanent alimony",
    "settlement_custody": "P. Rohan stays with the mother; weekend access to the father",
    "settlement_property": "the wife returns the husband's family jewellery",
    "joint_affidavit": True, "place": "Chennai", "family_court": "Family Court", "city": "Chennai",
}


def test_divorce_mutual_first_prays_for_decree_after_second_motion_not_only_recording():
    text = _text("divorce_mutual_first", _FIRST)
    assert "record the statements of the parties on this first motion" in text
    assert ("not earlier than six months and not later than eighteen months after the "
            "presentation of this petition, or on waiver of that period, pass a decree of "
            "divorce by mutual consent under s.13B(2)") in text


def test_divorce_mutual_first_pleads_no_collusion_and_no_other_proceedings():
    text = _text("divorce_mutual_first", _FIRST)
    assert "not presented or prosecuted in collusion between the parties" in text
    assert "No other proceeding between the parties in respect of the marriage is pending" in text
    assert "[to be drafted" not in text


_SECOND = {
    "party_a": "Mr. L. Prakash", "party_b": "Mrs. P. Shalini",
    "first_motion_order_date": "2026-04-15", "second_motion_date": "2026-11-07",
    "settlement_implemented": True, "place": "Chennai",
    "family_court": "Family Court", "city": "Chennai",
    "first_motion_case_no": "H.M.O.P. No. 912 of 2026",
}


def test_divorce_mutual_second_cause_title_uses_the_given_hmop_number():
    text = _text("divorce_mutual_second", _SECOND)
    assert "H.M.O.P. No. 912 of 2026" in text.split("1. Mr. L. Prakash")[0]
    assert "F.C.O.P. No. ______" not in text
    assert "15.04.2026 in H.M.O.P. No. 912 of 2026" in text


def test_maintenance_wife_and_minor_child_engine_drafts_both_quanta_and_prayers():
    """r10: the engine refused (no relationship / quantum / basis / Rajnesh flag for
    "a wife and minor child") so the AI fallback drafted it, citing the wrong proviso.
    With both quanta the ENGINE drafts it: two petitioners, separate prayers."""
    text = _text("maintenance", {
        "petitioner_name": "Mrs. M. Revathi", "petitioner_age": 29,
        "petitioner_address": "No. 6, Perambur, Chennai 600011",
        "child_name": "R. Nila", "child_age": 4,
        "respondent_name": "Mr. S. Raghu", "respondent_address": "No. 27, Anna Nagar, Chennai 600040",
        "marriage_date": "2020-11-20", "marriage_place": "Chennai",
        "neglect_or_refusal_pleaded": True,
        "respondent_means": "a bank officer earning about Rs. 1,10,000 per month",
        "petitioner_inability": "the petitioner No. 1 has no income",
        "quantum": 25000, "child_quantum": 15000,
        "jurisdiction_basis": "the petitioners reside at Perambur, Chennai",
        "place": "Chennai", "magistrate_court": "Family Court", "city": "Chennai",
        "filing_date": "2026-11-07",
    })
    assert "1. Mrs. M. Revathi, aged about 29 years" in text
    assert "2. R. Nila, minor, aged about 4 years, represented by the mother" in text
    assert "... Petitioners" in text
    assert "maintenance to the petitioner No. 1 at Rs. 25,000/- per month" in text
    assert "maintenance to the petitioner No. 2, the minor child, at Rs. 15,000/- per month" in text
    assert "second proviso to sub-section (1) of" in text and "144" in text
    assert "proviso to s.144(2)" not in text
    assert "Section 7(2)(a) of the Family Courts Act, 1984" in text
    assert "solemnised on 20.11.2020 at Chennai" in text


def test_maintenance_relationship_still_required_without_a_child():
    r = client.post("/v1/draft/maintenance", json={"matter": MATTER, "fields": {
        "petitioner_name": "A", "respondent_name": "B", "neglect_or_refusal_pleaded": True,
        "respondent_means": "x", "petitioner_inability": "y", "quantum": 1000,
        "jurisdiction_basis": "z", "place": "Chennai"}})
    assert r.status_code == 422 and "relationship" in r.text


def test_divorce_mutual_second_declares_no_collusion_and_no_other_proceedings():
    text = _text("divorce_mutual_second", _SECOND)
    assert "not presented or prosecuted in collusion between the parties" in text
    assert "No other proceeding between the parties in respect of the marriage is pending" in text
