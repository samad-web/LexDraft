"""r13 reviewer defects (one or two per format) pinned on the engine render of
the suite brief's facts, through the real /v1/draft endpoint."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402
from tests.service.test_civil_suit_review import CONSUMER  # noqa: E402
from tests.service.test_court_forms_quality_r12 import _BATTA, _CFM, _S80  # noqa: E402
from tests.service.test_criminal_formats_competes import S256  # noqa: E402
from tests.service.test_r10_writs_appeals_ias import AMD  # noqa: E402
from tests.service.test_r12_civil_quality import CONDONE, HRCP, INDIGENT  # noqa: E402
from tests.service.test_succession_contempt_quality import _SC  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R13", "version": 1}


def _text(doc_type, fields, **top):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **top})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


def test_amendment_ia_descriptive_respondent_becomes_name_gaps():
    text = _text("amendment_ia", {**AMD, "respondent_name": "her two brothers (names not stated)",
                                  "respondent_count": 2}, allow_placeholders=True)
    assert "1. [name of defendant 1 to be provided]\n2. [name of defendant 2 to be provided]" in text
    assert "names not stated" not in text


def test_batta_witness_unknown_side_is_not_the_form_strikeout():
    # b4 replaced r13's assumed Plaintiff with one named gap (test_b4_checklists item 8);
    # the r13 point that still holds: no raw "Plaintiff - Defendant" strike-out.
    text = _text("batta_witness", {k: v for k, v in _BATTA.items() if k != "applicant_role"})
    assert "Plaintiff - Defendant" not in text and "above named [Plaintiff / Defendant]" in text


def test_call_for_memo_records_case_from_the_purpose():
    text = _text("call_for_memo", {**_CFM, "documents": [], "kind": "records",
                                   "purpose": "comparison of the signatures of the accused in S.T.C. No. 118 of 2024"})
    assert "[case to be provided]" not in text
    assert "the records of S.T.C. No. 118 of 2024" in text
    assert "records of C.C. No. 340" not in text


def test_s256_condone_absence_affidavit_opening_not_repeated():
    text = _text("s256_condone_absence", {**S256, "deponent_name": "Mr. K. Senthil",
                                          "deponent_description": "Proprietor of M/s. Sri Murugan Traders, the complainant"}, allow_placeholders=True)
    aff = text.split("AFFIDAVIT")[1]
    assert aff.count("proprietor of M/s. Sri Murugan Traders") == 1
    assert "I, Mr. K. Senthil, [age, parentage and address], proprietor of M/s. Sri Murugan Traders, the complainant herein" in aff


def test_succession_certificate_intestate_is_not_a_personal_law():
    text = _text("succession_certificate", {**_SC, "law_of_succession": "intestate succession"})
    assert "governed by intestate succession" not in text
    assert text.count("[the personal law governing succession to the deceased to be provided]") == 1


def test_writ_petition_respondent_addresses_kept():
    text = _text("writ_petition", {
        "petitioner_name": "Mr. A. Natarajan",
        "respondents": [
            {"serial": 1, "name": "State of Tamil Nadu represented by the Secretary, School Education Department",
             "address": "Fort St. George, Chennai 600009"},
            {"serial": 2, "name": "The Director of School Education", "address": "Chennai 600006"},
            {"serial": 3, "name": "The Accountant General (A&E), Tamil Nadu"}],
        "court_place": "Madras", "writ_type": "mandamus", "legal_right": "pension",
        "public_duty": "sanction", "prior_demand_and_refusal": "representation dated 10.06.2026",
        "alternative_remedy_addressed": True, "alternative_remedy_basis": "none",
        "filing_date": "2026-11-07", "no_similar_petition": True, "place": "Chennai",
        "day": "7th", "month": "November", "year": "2026"})
    head = text.split("WRIT PETITION FILED UNDER")[0]
    assert "1. State of Tamil Nadu represented by the Secretary, School Education Department, Fort St. George, Chennai 600009" in head
    assert "2. The Director of School Education, Chennai 600006" in head


def test_hrcp_eviction_no_unresolved_verify_note():
    text = _text("hrcp_eviction", HRCP)
    assert "[verify:" not in text and "clause (g)" not in text
    assert "under clause (b) and the own-occupation ground of Section 21(2)" in text
    assert "the own-occupation ground, because the premises are required by the landlord" in text


def test_consumer_complaint_opposite_parties_joined_with_and_are_two():
    text = _text("consumer_complaint", {**CONSUMER, "opposite_party_name": "Coolwave Appliances Ltd. and Metro Digital Store"})
    assert "1. Coolwave Appliances Ltd.\n2. Metro Digital Store" in text and "... Opposite Parties" in text
    assert "the opposite parties, jointly and severally, to refund" in text


def test_consumer_complaint_single_firm_name_with_and_stays_whole():
    text = _text("consumer_complaint", {**CONSUMER, "opposite_party_name": "Larsen and Toubro Limited"})
    assert "Larsen and Toubro Limited                          ... Opposite Party" in text


def test_condone_delay_petition_header_is_ia_in_the_appeal():
    text = _text("condone_delay_petition", {**CONDONE, "case_ref": "O.S. No. 73 of 2023"}, allow_placeholders=True)
    head = text.split("MOST RESPECTFULLY")[0]
    assert "I.A. No. ______ of 2026\nin A.S. No. ______ of 2026" in head
    assert "O.S. No. 73 of 2023\nin A.S." not in head


def test_indigent_application_cause_title_parentage_and_plaint_facts():
    text = _text("indigent_application", {
        **INDIGENT, "respondent_name": "The two brothers of her late husband", "share_claimed": "One-third share",
        "cause_of_action": "Husband died on 11.02.2025 and his brothers have refused to give any share to her or her two minor children"})
    head = text.split("PETITION FILED UNDER")[0]
    assert "brother of The" not in text
    assert ("1. [name of respondent 1 to be provided], son of [father's name to be provided], "
            "brother of the petitioner's late husband") in head
    plaint = text.split("ANNEXURE: THE PROPOSED PLAINT")[1]
    assert "2. The plaintiff states that her husband died on 11.02.2025" in plaint
    assert "as a legal heir, became entitled to a one-third share in the suit property" in plaint
    assert "share share" not in text


def test_s80_notice_plaintiff_from_client_and_complete_illegality():
    text = _text("s80_notice", {**_S80, "client": "Mr. V. Kumar, No. 5, Anna Nagar, Chennai",
                                "plaintiff_name_description": "[plaintiff name description to be provided]",
                                "illegality_ground": ""}, allow_placeholders=True)
    assert "(1) Name and description of the plaintiff: Mr. V. Kumar, No. 5, Anna Nagar, Chennai." in text
    assert "[ground on which the act is illegal to be provided]" not in text
    assert "The said act is illegal, in that it was done without any notice to my client." in text
