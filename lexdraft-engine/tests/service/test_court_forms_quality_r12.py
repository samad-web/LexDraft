"""2026-11-07 r12 drafting-quality pass on the TN civil court forms: each test pins
one reviewer defect from a real brief, rendered end to end."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-FORMS-R12", "version": 1}


def _draft(doc_type, fields, **extra):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **extra})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


_ADJ = {"petitioner_name": "Mr. K. Palanisamy", "respondent_name": "Plaintiff",
        "posted_for": "cross-examination of PW1", "case_ref": "O.S. No. 214 of 2024",
        "adjournment_reason": "The petitioner underwent cataract surgery on 30.10.2026",
        "court_name": "Principal District Munsif Court, Salem", "place": "Salem",
        "hearing_date": "2026-11-10", "adjournment_period": "About four weeks"}


def test_adjournment_petition_period_grammar():
    text = _draft("adjournment_petition", _ADJ)
    assert "posted on 10.11.2026 by about four weeks," in text and "by About" not in text


def test_adjournment_petition_defendant_petitioner_cause_title():
    text = _draft("adjournment_petition", _ADJ)
    assert "Mr. K. Palanisamy                          ... Petitioner/Defendant" in text
    assert "[name of the plaintiff to be provided]                          ... Respondent/Plaintiff" in text
    assert "I, Mr. K. Palanisamy," in text and "signed his name in my presence" in text


_AFF = {"matter_type": "other", "affidavit_kind": "supporting", "deponent_name": "K. Ramesh", "age": 45,
        "parentage_type": "S/o", "parentage_name": "Kandasamy", "occupation": "Farmer",
        "address": "No. 12, Gandhi Road, Erode", "role": "deponent", "proceeding": "application",
        "place": "Erode", "attestor": "Notary Public", "court_name": "Tahsildar, Erode",
        "body_paras": ["That my name is wrongly recorded as K. Ramaswamy in the patta for S.F. No. 88/2, "
                       "Chithode village.", "That K. Ramesh and K. Ramaswamy are one and the same person."],
        "prayer": "[prayer to be provided]"}


def test_affidavit_first_para_numbered():
    text = _draft("affidavit", _AFF, allow_placeholders=True)  # draft-now gap
    assert "\n1. I am the deponent herein" in text and "\n2. That my name is wrongly recorded" in text


def test_affidavit_name_correction_request_stated():
    text = _draft("affidavit", _AFF, allow_placeholders=True)  # draft-now gap
    assert ("4. I therefore request the Tahsildar, Erode to correct the patta for S.F. No. 88/2, "
            "Chithode village to read my name as K. Ramesh.") in text
    assert "[request to be provided]" not in text and "signed his name" in text


def test_affidavit_of_service_closing_jurat():
    text = _draft("affidavit_of_service", {
        "deponent_name": "Mr. S. Murugan", "deponent_role": "advocate clerk",
        "respondent_name": "Mr. M. Selvaraj", "case_ref": "I.A. No. 245 of 2026 in O.S. No. 112 of 2026",
        "court_name": "District Munsif Court", "court_place": "Tiruppur", "place": "Tiruppur",
        "service_mode": "personal", "served_date": "2026-10-28", "served_time": "11 a.m.",
        "service_address": "No. 3, Kumaran Road, Tiruppur", "acknowledgment_signed": True})
    jurat = text.index("Solemnly affirmed at Tiruppur on this the")
    assert text.index("I personally served the notice") < jurat
    assert "signed his name in my presence.\nDEPONENT\nBEFORE ME,\nADVOCATE\nCOUNSEL FOR PETITIONER" in text


_BATTA = {"court_name": "Sub Court, Namakkal", "case_ref": "O.S. No. 77 of 2025",
          "witness_name": "Dr. K. Anand", "witness_designation": "Civil Surgeon, Government Hospital, Namakkal",
          "hearing_date": "2026-11-20", "documents_to_produce": "the accident register of 14.02.2025",
          "batta_amount": "500", "applicant_role": "plaintiff", "filing_date": "2026-11-07"}


def test_batta_witness_party_resolved():
    text = _draft("batta_witness", _BATTA)
    assert "above named Plaintiff for issue of Process" in text and "Plaintiff - Defendant" not in text
    assert "Counsel for Plaintiff" in text and "Plaintiff / Defendant" not in text


def test_batta_witness_date_line_place():
    text = _draft("batta_witness", _BATTA)
    assert "Dated at Namakkal on this the 7 day of November 2026." in text


def test_batta_witness_designation_and_batta():
    text = _draft("batta_witness", _BATTA)
    assert ("summons may be issued to Dr. K. Anand, Civil Surgeon, Government Hospital, Namakkal "
            "to appear before this Court on 20.11.2026") in text
    assert "Batta of Rs. 500 is paid herewith." in text


_SOP = {"case_ref": "O.S. No. 212 of 2026", "court_name": "District Munsif Court, Pollachi", "place": "Pollachi",
        "process_type": "Summons", "service_mode": "Registered post with acknowledgment due and court bailiff",
        "respondents": [{"name": "Mr. K. Saravanan", "village_town_address": "No. 31, Kovai Road, Pollachi"}]}


def test_service_of_process_application_cause_title():
    text = _draft("service_of_process_application", {**_SOP, "applicant_name": "Mr. R. Natarajan"})
    assert "Mr. R. Natarajan                          ... Plaintiff\nVersus\nMr. K. Saravanan" in text
    assert "Mr. K. Saravanan                          ... Defendant" in text
    bare = _draft("service_of_process_application", _SOP)
    assert "[name of the plaintiff to be provided]                          ... Plaintiff" in bare


def test_service_of_process_application_fee_postage_and_date():
    text = _draft("service_of_process_application", {**_SOP, "filing_date": "2026-11-07"})
    assert "The process fee and postage for the service are paid herewith." in text
    assert "Place: Pollachi          Dated: 07.11.2026" in text
    assert ("the summons be served on the following defendant by registered post with acknowledgment "
            "due and through the court bailiff:") in text


_URG = {"petitioner_name": "Mr. S. Kumar", "respondent_name": "the defendant", "petitioner_role": "plaintiff",
        "underlying_application": "I.A. No. 610 of 2026", "case_ref": "I.A. No. 610 of 2026 in O.S. No. 412 of 2024",
        "orders_prayed": "advance the hearing of the injunction petition from 15.12.2026 to an early date",
        "court_name": "District Munsif Court, Erode", "place": "Erode", "posted_date": "2026-12-15",
        "urgency_grounds": "The defendant started construction on the suit property on 01.11.2026"}


def test_urgent_petition_because_grammar():
    text = _draft("urgent_petition", _URG)
    assert "urgent because the defendant started construction" in text and "because The" not in text


def test_urgent_petition_supporting_affidavit():
    text = _draft("urgent_petition", _URG)
    aff = text[text.index("AFFIDAVIT FILED IN SUPPORT OF THE PETITION"):]
    assert "I, Mr. S. Kumar," in aff and "1. I am the petitioner/plaintiff herein" in aff
    assert "The matter is urgent because the defendant started construction on the suit property on 01.11.2026." in aff
    assert "signed his name in my presence" in aff and "BEFORE ME," in aff


def test_urgent_petition_interim_status_quo_prayer():
    text = _draft("urgent_petition", {**_URG, "interim_prayer": "status quo in respect of the suit property"})
    assert ("to an early date, and pending such hearing grant status quo in respect of the suit property, "
            "and pass such further") in text
    assert "pending such hearing" not in _draft("urgent_petition", _URG)


_CFM = {"court_name": "Judicial Magistrate No. I, Coimbatore", "case_ref": "C.C. No. 340 of 2025",
        "documents": ["Case records of S.T.C. No. 118 of 2024 on the file of the Judicial Magistrate No. I, Coimbatore"],
        "purpose": "for comparison of the signatures of the accused", "place": "Coimbatore",
        "filing_date": "2026-11-07"}


def test_call_for_memo_call_for_records_petition():
    text = _draft("call_for_memo", _CFM)
    assert "PETITION TO CALL FOR RECORDS" in text and "certified copy" not in text
    assert "(UNDER SECTION 94 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023)" in text
    assert "[name of the complainant to be provided]\t... Complainant" in text
    assert "[name of the accused to be provided]\t... Accused" in text
    assert ("may be pleased to call for the records of S.T.C. No. 118 of 2024 for comparison of the "
            "signatures of the accused") in text
    assert "The said records are on the file of this Hon'ble Court" in text


def test_call_for_memo_for_not_doubled():
    text = _draft("call_for_memo", {**_CFM, "kind": "copy", "documents": ["Deposition of PW1"]})
    assert "For comparison of the signatures of the accused and the" in text and "For For" not in text


def test_appeal_record_cost_schedule_title_and_exhibits():
    text = _draft("appeal_record_cost_schedule", {
        "appeal_ref": "A.S. No. 58 of 2026", "on_behalf_of": "Mr. S. Ravi (appellant)", "place": "Madurai",
        "court_type": "Principal District Court", "court_place": "Madurai",
        "documents": [{"description": "Typed matter of the record", "pages_printing": "120"},
                      {"description": "Exhibits", "count": "4"}]})
    assert "APPEAL RECORD COPYING/PRINTING COST SCHEDULE" in text and "TRANSLATED" not in text
    assert "| 2 | Exhibits (4 in number) |" in text  # evidence-tables: a table row


_S80 = {"advocate": "Mr. A. Arun", "client": "Mr. V. Kumar",
        "addressee": "The Secretary, Revenue Department, and the District Collector, Chennai",
        "government_body": "State of Tamil Nadu",
        "plaintiff_name_description": "Mr. V. Kumar, No. 5, Anna Nagar, Chennai",
        "cause_of_action": "Demolition of the compound wall on S.F. No. 101, Anna Nagar on 05.09.2026 without notice",
        "illegality_ground": "The compound wall was demolished without any notice",
        "reliefs": ["Payment of compensation of Rs. 4,00,000"], "notice_date": "2026-11-07", "place": "Chennai"}


def test_s80_notice_two_noticees_addressed_separately():
    text = _draft("s80_notice", _S80)
    assert ("To,\n1. The Secretary, Revenue Department, State of Tamil Nadu,\n"
            "2. The District Collector, Chennai, State of Tamil Nadu,") in text
    assert "Sirs," in text and "Dear Sir," not in text


def test_s80_notice_illegality_pleaded():
    text = _draft("s80_notice", _S80)
    assert "The said act is illegal, in that the compound wall was demolished without any notice." in text
    assert ("in violation of the principles of natural justice, and deprives my client of his property "
            "without authority of law, contrary to Article 300A of the Constitution of India.") in text
