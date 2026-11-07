"""2026-11-07 drafting-quality pass on the TN procedural court forms (process,
service, summons/notice, batta, copy, call-for, appearance, urgent petition):
each test pins one reviewer defect from a real brief, rendered end to end."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-FORMS-Q", "version": 1}


def _draft(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


POLLACHI = {"court_name": "District Munsif Court", "court_place": "Pollachi",
            "case_ref": "O.S. No. 212 of 2026", "place": "Pollachi"}


def test_process_application_court_parties_and_fee():
    text = _draft("process_application", {
        **POLLACHI, "forum": "civil", "applicant_name": "Mr. R. Natarajan",
        "applicant_role": "plaintiff", "opposite_party_name": "Mr. K. Saravanan",
        "process_fee_paid": True, "rows": [{"nature_of_process": "Summons",
                                            "on_whom": "Mr. K. Saravanan (Defendant)",
                                            "place_of_service": "No. 31, Kovai Road, Pollachi"}]})
    assert "IN THE COURT OF DISTRICT MUNSIF AT POLLACHI" in text.upper()
    assert "Mr. R. Natarajan" in text and "... Plaintiff" in text
    assert "... Defendant" in text and "Opposite Party" not in text
    assert "above-named Plaintiff" in text and "Advocate for Plaintiff" in text
    assert "process fee has been paid" in text


def test_process_memo_civil_suit_not_magistrate_form():
    text = _draft("process_memo", {
        **POLLACHI, "respondent_name": "Mr. K. Saravanan", "process_type": "summons by RPAD and court process",
        "address_for_service": "No. 31, Kovai Road, Pollachi", "hearing_date": "2026-11-25",
        "filing_date": "2026-11-07"})
    up = text.upper()
    for wrong in ("MAGISTRATE", "DVC", "ACCUSED"):
        assert wrong not in up
    assert "O.S. NO. 212 OF 2026" in up and "- Plaintiff" in text and "- Defendant" in text
    assert "pleased to issue summons by RPAD and court process to the above named defendant" in text
    assert "25.11.2026" in text and "November 2026" in text and "COUNSEL FOR THE PLAINTIFF" in up


def test_service_of_process_application_court_modes_and_suit_parties():
    text = _draft("service_of_process_application", {
        **POLLACHI, "process_type": "summons",
        "service_mode": "registered post with acknowledgment due and through the court bailiff",
        "respondents": [{"name": "Mr. K. Saravanan", "village_town_address": "No. 31, Kovai Road, Pollachi"}]})
    assert "IN THE COURT OF DISTRICT MUNSIF AT POLLACHI" in text.upper()
    assert ("The plaintiff prays that the summons be served on the following defendant by registered "
            "post with acknowledgment due and through the court bailiff:") in text
    assert "Advocate for Plaintiff" in text and "respondent" not in text.lower()


SUMMONS = {**POLLACHI, "kind": "civil_defendant", "plaintiff_name": "Mr. R. Natarajan",
           "defendant_or_witness_name": "Mr. K. Saravanan", "addressee_address": "No. 31, Kovai Road, Pollachi",
           "cause_of_action": "permanent injunction", "appearance_date": "2026-11-25",
           "appearance_time": "10.30 a.m."}


def test_summons_court_address_time_and_written_statement():
    text = _draft("summons", SUMMONS)
    assert "IN THE COURT OF DISTRICT MUNSIF AT POLLACHI" in text.upper()
    assert "To, Mr. K. Saravanan, No. 31, Kovai Road, Pollachi" in text
    assert "on 25.11.2026 at 10.30 a.m. to answer the claim" in text
    assert "file on that day a written statement of your defence" in text


def test_court_notice_court_respondent_and_relief_not_doubled():
    text = _draft("court_notice", {
        "kind": "show_cause", "court_name": "District Munsif Court, Tiruppur", "court_place": "Tiruppur",
        "case_ref": "I.A. No. 245 of 2026 in O.S. No. 112 of 2026", "place": "Tiruppur",
        "applicant_or_petitioner_name": "Mr. K. Mani", "addressee_name": "Mr. M. Selvaraj",
        "addressee_address": "No. 3, Kumaran Road, Tiruppur",
        "application_or_relief": "petition for temporary injunction",
        "appearance_date": "2026-11-20", "appearance_time": "10.30 a.m."})
    assert "IN THE COURT OF DISTRICT MUNSIF, TIRUPPUR" in text.upper() and "AT TIRUPPUR" not in text.upper()
    assert "Mr. M. Selvaraj                          ... Respondent" in text
    assert "To, Mr. M. Selvaraj, No. 3, Kumaran Road, Tiruppur" in text
    assert "application to this Court for temporary injunction" in text
    assert "on 20.11.2026 at 10.30 a.m. to show cause" in text


def test_batta_witness_year_not_doubled_and_particulars_filled():
    text = _draft("batta_witness", {
        "court_name": "Sub Court", "court_place": "Namakkal", "case_ref": "O.S. No. 77 of 2025",
        "os_year": "2025", "place": "Namakkal",
        "witness_name": "Dr. K. Anand, Civil Surgeon, Government Hospital, Namakkal",
        "documents_to_produce": "the accident register of 14.02.2025", "hearing_date": "2026-11-20",
        "batta_amount": "Rs. 500"})
    assert "of 2025" in text and "202025" not in text
    assert "IN THE COURT OF SUBORDINATE JUDGE AT NAMAKKAL" in text.upper()
    assert ("summons may be issued to Dr. K. Anand, Civil Surgeon, Government Hospital, Namakkal to appear "
            "before this Court on 20.11.2026 and give evidence and to produce the accident register of "
            "14.02.2025. Batta of Rs. 500 is paid herewith.") in text


def test_call_for_memo_year_not_doubled_and_place_filled():
    text = _draft("call_for_memo", {
        "court_name": "Judicial Magistrate No. I", "court_place": "Coimbatore",
        "case_ref": "C.C. No. 340 of 2025", "cc_no": "340", "cc_year": "2025", "place": "Coimbatore"})
    assert "of 2025" in text and "2022025" not in text
    assert "- Coimbatore." in text and "accused persons" not in text


def test_copy_application_defendant_applicant_in_defendant_slot():
    text = _draft("copy_application", {
        "court_name": "District Munsif Court", "court_place": "Melur", "case_ref": "O.S. No. 156 of 2022",
        "applicant_name": "Mr. S. Ravi", "applicant_role": "defendant", "place": "Melur", "urgent": True,
        "purpose": "filing an appeal",
        "documents": [{"description": "Judgment and decree", "date_of_document": "10.10.2026"}]})
    lines = text.splitlines()
    assert any(l.startswith("Mr. S. Ravi") and l.rstrip().endswith("Defendant") for l in lines)
    assert not any(l.startswith("Mr. S. Ravi") and l.rstrip().endswith("Plaintiff") for l in lines)
    assert "IN THE COURT OF   DISTRICT MUNSIF" in text.upper() and "AT MELUR" in text.upper()
    assert "It is requested that urgent certified copies of the document hereunder mentioned" in text
    assert "furnished to the defendant abovenamed for the purpose of filing an appeal." in text
    assert "Counsel for Defendant" in text


TIRUPPUR_IA = {"court_name": "District Munsif Court", "court_place": "Tiruppur", "place": "Tiruppur",
               "case_ref": "I.A. No. 245 of 2026 in O.S. No. 112 of 2026"}


def test_affidavit_of_service_personal_service_by_clerk():
    text = _draft("affidavit_of_service", {
        **TIRUPPUR_IA, "ia_year": "2026", "os_year": "2026", "deponent_name": "S. Murugan",
        "deponent_role": "advocate clerk", "respondent_name": "Mr. M. Selvaraj",
        "served_date": "2026-10-28", "served_time": "11 a.m.",
        "service_address": "No. 3, Kumaran Road, Tiruppur", "acknowledgment_signed": True})
    assert "202026" not in text and "of 2026" in text and "I.A. No. 245" in text
    assert "I am the registered clerk of the counsel on record for the petitioner" in text
    assert "I am the counsel on record" not in text
    assert ("On 28.10.2026 at 11 a.m., I personally served the notice on the respondent Mr. M. Selvaraj at "
            "No. 3, Kumaran Road, Tiruppur, who received it and signed the acknowledgment.") in text
    assert "Registered cover" not in text and "returned" not in text
    assert "Defendent" not in text and "PLANTIFF" not in text and "... Respondent" in text


def test_memo_of_appearance_full_cause_title_date_and_no_their():
    text = _draft("memo_of_appearance", {
        **TIRUPPUR_IA, "court_name": "District Munsif Court, Tiruppur", "counsel_name": "Mr. S. Arun",
        "party_represented": "respondent", "party_name": "Mr. M. Selvaraj", "filing_date": "2026-11-07"})
    lines = [l for l in text.splitlines() if "..." in l]
    assert lines[0].startswith("______") and lines[0].endswith("... Petitioner")
    assert lines[1].startswith("Mr. M. Selvaraj") and lines[1].endswith("... Respondent")
    assert "their behalf" not in text and "Dated: 07.11.2026" in text
    assert "TIRUPPUR AT TIRUPPUR" not in text.upper()


def test_urgent_petition_court_grounds_and_clean_prayer():
    text = _draft("urgent_petition", {
        "court_name": "District Munsif Court", "court_place": "Erode", "place": "Erode",
        "case_ref": "I.A. No. 610 of 2026 in O.S. No. 412 of 2024", "petitioner_name": "Mr. S. Kumar",
        "petitioner_role": "plaintiff", "respondent_name": "the defendant",
        "underlying_application": "I.A. No. 610 of 2026 (injunction petition)",
        "orders_prayed": "To advance the hearing of the injunction petition from 15.12.2026 to an early date",
        "urgency_grounds": "the defendant started construction on the suit property on 01.11.2026",
        "posted_date": "2026-12-15"})
    assert "IN THE COURT OF DISTRICT MUNSIF AT ERODE" in text.upper()
    assert "... Petitioner/Plaintiff" in text and "______                          ... Respondent/Defendant" in text
    assert "The matter is urgent because the defendant started construction on the suit property on 01.11.2026." in text
    assert ("may be pleased to treat the matter as urgent and advance the hearing of the injunction petition "
            "from 15.12.2026 to an early date") in text
    assert "seeking To" not in text and "stands posted to 15.12.2026" in text
