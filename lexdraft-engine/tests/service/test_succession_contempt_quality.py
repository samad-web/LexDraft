"""Drafting-quality fixes (2026-11-07) for succession_certificate, succession_grant
and contempt_petition, through the real /v1/draft endpoint with the suite briefs' facts."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-SUCC-QA", "version": 1}


def _text(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


_SC = {
    "petitioner_name": "Mrs. K. Malathi", "petitioner_address": "Tiruvannamalai",
    "deceased_name": "Mr. S. Kumaresan", "death_date": "2026-04-19",
    "deceased_residence": "Tiruvannamalai", "diligent_search_no_will": True,
    "next_of_kin": "the petitioner (widow), a married daughter and a son",
    "petitioner_relation": "widow",
    "securities": [{"description": "Fixed deposit with Indian Bank, Tiruvannamalai", "value": 850000}],
    "purpose": "receiving the deposit", "no_impediment_s370": True,
    "no_prior_application": True, "ad_valorem_duty_paid": True,
    "filing_date": "2026-11-07", "place": "Tiruvannamalai",
    "grant_court": "Principal District Court", "city": "Tiruvannamalai",
    "respondents": [
        {"relation": "Daughter", "address": "Chennai", "consented": True},
        {"relation": "Son", "address": "Bengaluru", "consented": True},
    ],
}


def test_succession_certificate_arrays_son_and_daughter_as_consenting_respondents():
    text = _text("succession_certificate", _SC)
    head = text.split("PETITION FILED UNDER")[0]
    assert "1. [name of the daughter to be provided], daughter of the deceased, residing at Chennai (consenting)" in head
    assert "2. [name of the son to be provided], son of the deceased, residing at Bengaluru (consenting)" in head
    assert "to be arrayed as respondents" not in head
    assert "the daughter and the son of the deceased have each given a letter of consent" in text


def test_succession_certificate_hindu_law_pleaded_with_hsa_and_class_i_heirs():
    text = _text("succession_certificate", {**_SC, "law_of_succession": "Hindu"})
    assert "governed by the Hindu Succession Act, 1956, he being a Hindu" in text
    assert "heirs in Class I of the Schedule" in text


_SG = {
    "grant_kind": "probate", "petitioner_name": "R. Srinivasan",
    "petitioner_address": "Mylapore, Chennai", "deceased_name": "K. Parvathi Ammal",
    "death_date": "2026-05-03", "deceased_last_residence": "Chennai",
    "will_date": "2021-08-12", "will_duly_executed": True,
    "relatives": [{"relation": "Nephew", "name": "K. Balu", "address": "Chennai"}],
    "petitioner_is_named_executor": True, "undertakes_further_court_fee": True,
    "no_impediment": True, "jurisdiction_basis": "the deceased resided at Chennai",
    "filing_date": "2026-11-07", "place": "Chennai", "deceased_gender": "female",
    "assets": [{"description": "Flat No. 4, Kasturi Apartments, R.A. Puram, Chennai", "value": 8800000},
               {"description": "Deposits with Canara Bank, Mylapore", "value": 2200000}],
    "attesting_witnesses": ["Mr. V. Narayanan", "Dr. P. Subramanian"],
    "deposing_witness": "Mr. V. Narayanan",
}


def test_succession_grant_has_affidavit_of_assets_schedule_a():
    text = _text("succession_grant", _SG)
    sched = text.split("SCHEDULE-A — AFFIDAVIT OF ASSETS")[1]
    assert "1. Flat No. 4, Kasturi Apartments, R.A. Puram, Chennai — Rs. 88,00,000/-" in sched
    assert "TOTAL: Rs. 1,10,00,000/-" in sched
    assert "assets schedule ref" not in text


def test_succession_grant_attesting_witness_affidavit_by_narayanan_single_signature():
    text = _text("succession_grant", _SG)
    assert "WITNESS NO. 2" not in text
    assert "I, Mr. V. Narayanan, one of the witnesses to the last will and testament of the testatrix" in text
    aff = text.split("AFFIDAVIT OF ATTESTING WITNESS")[1]
    assert aff.startswith("\nI, Mr. V. Narayanan,")
    assert "in the presence of Dr. P. Subramanian, the other attesting witness" in aff
    assert "was residing at Chennai" in text


def test_contempt_petition_address_does_not_repeat_the_petitioners_name():
    text = _text("contempt_petition", {
        "petitioner_names": ["Mr. V. Ramasamy"],
        "petitioner_addresses": ["Mr. V. Ramasamy, Ganapathy, Coimbatore"],
        "respondents": ["The Commissioner, Coimbatore City Municipal Corporation"],
        "parent_case_ref": "W.P. No. 18745 of 2025", "order_disobeyed_date": "2026-03-06",
        "order_nature": "to consider the representation and pass orders within eight weeks",
        "contemnors_had_knowledge": True,
        "disobedience_narrative": "No order has been passed despite service on 12.03.2026.",
        "contempt_committed_date": "2026-05-07", "filing_date": "2026-11-07", "place": "Chennai"})
    assert "Mr. V. Ramasamy, residing at Ganapathy, Coimbatore" in text
    assert "residing at Mr. V. Ramasamy" not in text
    assert "I, Mr. V. Ramasamy, residing at Ganapathy, Coimbatore, do hereby" in text


def test_succession_certificate_unstated_law_is_a_marked_gap_not_a_refusal():
    text = _text("succession_certificate", _SC)
    assert "[the personal law of the deceased to be provided — if a Hindu: the Hindu Succession Act, 1956" in text
