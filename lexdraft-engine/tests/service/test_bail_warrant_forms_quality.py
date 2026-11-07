"""2026-11-07 drafting-quality: bail / surety / warrant / absence court forms
drafted from the suite briefs (Salem, Madurai, Coimbatore). Each test pins one
reviewer defect: the court named in the brief is printed, BNSS (not the CrPC) is
cited for a post-1.7.2024 case, no doubled prefix, and every particular the brief
gives reaches the form."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-BAIL-FORMS", "version": 1}


def _draft(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields,
                                                       "allow_placeholders": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


_DOUBLED = ("S/o S/o", "Rs. Rs.", "Rs Rs", "Mr Mr.", "Mr. Mr.",
            "Police Station Police Station", "202025", "202026")


def _no_doubles(text):
    for d in _DOUBLED:
        assert d not in text, d


SALEM_BOND = {
    "accused_name": "Mr. R. Vinoth", "accused_age": "29", "accused_parentage": "S/o Rajendran",
    "accused_address": "No. 22, Fairlands, Salem", "offence_section": "s.303(2) BNS",
    "bail_granted": True, "bail_order_court": "Judicial Magistrate No. II, Salem",
    "bail_order_date": "2026-10-30", "forfeiture_sum": "Rs. 10,000",
    "sureties": [{"name": "[surety 1 to be provided]", "forfeiture_sum": "Rs. 10,000"}],
    "case_ref": "Crime No. 310 of 2026, Hasthampatti Police Station", "place": "Salem",
    "court_place": "Salem", "police_station": "Hasthampatti Police Station",
}


def test_bail_bond_court_bnss_and_accused_particulars():
    text = _draft("bail_bond", SALEM_BOND)
    up = text.upper()
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. II, SALEM" in up
    assert "SALEM AT SALEM" not in up
    assert "Sections 478 to 485 of the Bharatiya Nagarik Suraksha Sanhita, 2023" in text
    assert "Code of Criminal Procedure" not in text
    assert "R. Vinoth, S/o Rajendran, aged 29 years, residing at No. 22, Fairlands, Salem" in text
    assert "State rep. by the Inspector of Police, Hasthampatti Police Station" in text
    assert "Court  whenever" not in text
    _no_doubles(text)


def test_bail_bond_pre_bnss_case_keeps_crpc():
    text = _draft("bail_bond", {**SALEM_BOND, "case_ref": "Crime No. 12 of 2023"})
    assert "Sections 436 to 441 of the Code of Criminal Procedure, 1973" in text


def test_surety_affidavit_court_parentage_state_and_no_doubled_rs():
    """The extractor put the court in court_place and "Rs. 10,000" in bail_sum."""
    text = _draft("surety_affidavit", {
        "surety_name": "Mr. K. Mohan", "surety_age": "47", "surety_parentage": "Kandasamy",
        "surety_address": "No. 3, Main Road, Attur", "surety_occupation": "shop owner",
        "property_particulars": "property worth Rs. 15,00,000",
        "accused_name": "Mr. R. Vinoth", "offence_section": "[offence section to be provided]",
        "bail_granted": True, "bail_sum": "Rs. 10,000", "id_proofs": ["[id proofs to be provided]"],
        "case_ref": "Crime No. 310 of 2026 of Hasthampatti Police Station", "place": "Salem",
        "court_place": "JUDICIAL MAGISTRATE NO. II, SALEM", "crime_no": "Crime No. 310 of 2026",
        "police_station": "Hasthampatti Police Station"})
    up = text.upper()
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. II, SALEM" in up
    assert " AT JUDICIAL" not in up
    assert "I, Mr. K. Mohan, S/o Kandasamy, aged 47 years, residing at" in text
    assert "State rep. by the Inspector of Police, Hasthampatti Police Station" in text
    assert "in the sum of Rs. 10,000." in text
    assert "(Crime No. 310 of 2026)" not in text  # already in the case line
    _no_doubles(text)


def test_affidavit_of_surety_no_doubled_prefixes_and_particulars_filled():
    text = _draft("affidavit_of_surety", {
        "court_name": "Judicial Magistrate No. II, Salem", "court_place": "Salem",
        "crime_no": "Crime No. 310 of 2026", "police_station": "Hasthampatti Police Station",
        "accused_name": "Mr. R. Vinoth", "bail_order_date": "30.10.2026",
        "surety_name": "Mr. P. Ganesan", "surety_parentage": "S/o Palanisamy", "surety_age": "52",
        "surety_address": "No. 7, Market Street, Salem", "surety_occupation": "textile merchant",
        "property_particulars": "a house at Salem worth Rs. 25,00,000 (Patta No. 412)",
        "bail_sum": "Rs. 10,000", "place": "Salem"})
    up = text.upper()
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. II :: AT SALEM" in up
    assert "Crime No. 310 of 2026" in text and "of 2026 of" not in text
    assert "Hasthampatti Police Station" in text
    assert "Mr. R. Vinoth  ---Accused" in text
    assert "Mr. P. Ganesan S/o Palanisamy" in text
    assert "textile merchant" in text and "Patta No. 412" in text and "25,00,000" in text
    assert "in the sum of Rs 10,000 (Rupees Ten Thousand only)" in text
    _no_doubles(text)


def test_surety_memo_cause_title_sureties_and_documents():
    text = _draft("surety_memo", {
        "court_name": "Judicial Magistrate No. II, Salem", "court_place": "Salem",
        "crime_no": "Crime No. 310 of 2026 of Hasthampatti Police Station",
        "police_station": "Hasthampatti Police Station", "accused_name": "Mr. R. Vinoth",
        "sureties": [{"name": "Mr. P. Ganesan", "address": "Salem", "amount": "Rs. 10,000"},
                     {"name": "Mr. K. Mohan", "address": "Attur", "amount": "10,000"}],
        "documents": ["their property documents", "identity proofs"], "place": "Salem"})
    up = text.upper()
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. II :: AT SALEM" in up
    assert "Crime No. 310 of 2026" in text and "of 2026 of" not in text
    assert "Inspector of Police, Hasthampatti Police Station" in text
    assert "1. Mr. P. Ganesan, Salem, for Rs. 10,000" in text
    assert "2. Mr. K. Mohan, Attur, for Rs. 10,000" in text
    assert "The sureties produce their property documents, identity proofs." in text
    _no_doubles(text)


def test_memorandum_furnish_sureties_court_sureties_and_no_order_ref_gap():
    text = _draft("memorandum_furnish_sureties", {
        "accused_name": "Mr. R. Vinoth", "granting_court": "the Judicial Magistrate No. II, Salem",
        "bail_granted": True, "bail_order_date": "2026-10-30",
        "case_ref": "Crime No. 310 of 2026 of Hasthampatti Police Station", "place": "Salem",
        "court_place": "Salem", "police_station": "Hasthampatti",
        "sureties": [{"name": "Mr. P. Ganesan", "address": "Salem", "amount": "Rs. 10,000"},
                     {"name": "Mr. K. Mohan", "address": "Attur", "amount": "Rs. 10,000"}]})
    up = text.upper()
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. II, SALEM" in up
    assert "SALEM AT SALEM" not in up
    assert "State rep. by the Inspector of Police, Hasthampatti Police Station" in text
    assert "by the Judicial Magistrate No. II, Salem by its order dated" in text
    assert "to be provided" not in text and " in  by" not in text
    assert "1. Mr. P. Ganesan, Salem, for Rs. 10,000" in text
    assert "2. Mr. K. Mohan, Attur, for Rs. 10,000" in text
    _no_doubles(text)


_BNSS = "Bharatiya Nagarik Suraksha Sanhita, 2023"


def test_recall_petition_bnss_reason_and_undertaking():
    text = _draft("recall_petition", {
        "court_name": "Judicial Magistrate No. I", "court_place": "Madurai",
        "cc_no": "C.C. No. 412 of 2025", "accused_name": "Mr. B. Senthil",
        "warrant_type": "non-bailable warrant", "warrant_date": "2026-10-15",
        "absence_reason": "He was admitted in Meenakshi Mission Hospital, Madurai from "
                          "13.10.2026 to 18.10.2026 for dengue.",
        "undertakes_to_appear": True, "place": "Madurai"})
    assert "PETITION UNDER SECTION 72(2) OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023" in text
    assert "Cr.P.C." not in text
    assert "court, as he was admitted in Meenakshi Mission Hospital" in text
    assert "non-bailable warrant on 15.10.2026 against" in text
    assert "reliably understands" in text
    assert "undertakes to appear before this Honourable court on every hearing date" in text


def test_recall_warrant_bnss_court_state_respondent_and_certificate():
    text = _draft("recall_warrant", {
        "accused_name": "Mr. B. Senthil", "warrant_pending": True,
        "absence_reason": "he was hospitalised for dengue from 13.10.2026 to 18.10.2026 at "
                          "Meenakshi Mission Hospital, Madurai",
        "undertaking_future_appearance": True, "case_ref": "C.C. No. 412 of 2025",
        "court_name": "Judicial Magistrate No. I, Madurai", "court_place": "Madurai",
        "warrant_date": "2026-10-15", "documents": ["the medical certificate"], "place": "Madurai"})
    up = text.upper()
    assert f"SECTION 72(2) OF THE {_BNSS.upper()} TO RECALL WARRANT" in up
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. I, MADURAI" in up
    assert "State rep. by the Inspector of Police, [police station to be provided]" in text
    assert "on 15.10.2026, when this Hon'ble Court issued a warrant" in text
    assert "files herewith the medical certificate" in text
    assert "Code of Criminal Procedure" not in text


def test_s256_condone_absence_bnss_past_date_post_for_evidence_and_court():
    text = _draft("s256_condone_absence", {
        "complainant_name": "M/s. Sri Murugan Traders", "accused_name": "[accused name to be provided]",
        "absence_reason": "The proprietor, Mr. K. Senthil, was travelling to Delhi for a family wedding.",
        "case_ref": "S.T.C. No. 118 of 2026", "place": "Coimbatore",
        "court_designation": "Judicial Magistrate No. I, Coimbatore", "court_place": "Coimbatore",
        "absence_date": "2026-10-28", "post_for": "evidence"})
    up = text.upper()
    assert f"PETITION UNDER SECTION 279 OF THE {_BNSS.upper()}" in up
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. I, COIMBATORE" in up
    assert "was unable to attend this Hon'ble Court on 28.10.2026, as the proprietor" in text
    assert "today" not in text
    # r12: a case not dismissed is not "restored" -- condone and post it for evidence.
    assert "and post the case for evidence" in text and "restore" not in text.lower()
    assert "Code of Criminal Procedure" not in text and "wedding.." not in text


def test_s317_dispense_presence_bnss_hearing_date_identity_and_court():
    text = _draft("s317_dispense_presence", {
        "accused_name": "Mr. P. Ravi", "complainant_name": "[complainant name to be provided]",
        "absence_reason": "He is undergoing knee surgery at Ganga Hospital, Coimbatore",
        "absence_not_wanton": True, "case_ref": "S.T.C. No. 118 of 2026", "place": "Coimbatore",
        "magistrate_designation": "Judicial Magistrate No. I", "court_place": "Coimbatore",
        "hearing_date": "2026-11-20", "identity_not_disputed": True})
    up = text.upper()
    assert f"PETITION UNDER SECTION 355 OF THE {_BNSS.upper()}" in up
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. I AT COIMBATORE" in up
    assert "on 20.11.2026, as he is undergoing knee surgery" in text
    assert "in this case on 20.11.2026." in text and "today" not in text
    assert "will not dispute his/her identity" in text


def test_court_warrant_arrest_kind_form2_bnss_court_and_return_date():
    """The brief's criminal warrant of arrest had no engine kind and fell to AI composition."""
    text = _draft("court_warrant", {
        "kind": "arrest", "case_ref": "C.C. No. 412 of 2025", "place": "Madurai",
        "court_name": "Judicial Magistrate No. I, Madurai", "court_place": "Madurai",
        "accused_name": "Mr. B. Senthil", "accused_address": "No. 8, Simmakkal, Madurai",
        "default_date": "2026-10-15", "despite_summons": True, "return_date": "2026-11-20",
        "addressed_to": "The Inspector of Police, Thallakulam Police Station, Madurai"})
    up = text.upper()
    assert f"WARRANT OF ARREST (SEE SECTION 72 OF THE {_BNSS.upper()})" in up
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. I, MADURAI" in up
    assert "Mr. B. Senthil                          ... Accused" in text
    assert "To, The Inspector of Police, Thallakulam Police Station, Madurai" in text
    assert "failed to appear before this Court on 15.10.2026 in spite of the summons" in text
    assert "produce him/her before this Court on or before 20.11.2026. Herein fail not." in text
    assert "[offence(s) and section(s) to be provided]" in text  # not in the brief
    assert "Decree-Holder" not in text and "Judgment-Debtor" not in text


def test_court_warrant_arrest_refuses_without_accused():
    r = client.post("/v1/draft/court_warrant", json={"matter": MATTER, "fields": {
        "kind": "arrest", "case_ref": "C.C. No. 412 of 2025", "place": "Madurai"}})
    assert r.status_code == 200 and r.json()["outcome"] == "refused"


def test_s317_pre_bnss_case_keeps_crpc_and_2024_case_is_bracketed():
    base = {"accused_name": "P. Ravi", "complainant_name": "K. Arun", "absence_reason": "he is unwell",
            "absence_not_wanton": True, "place": "Coimbatore"}
    old = _draft("s317_dispense_presence", {**base, "case_ref": "C.C. No. 5 of 2022"})
    assert "SECTION 317 OF THE CODE OF CRIMINAL PROCEDURE, 1973" in old.upper()
    mid = _draft("s317_dispense_presence", {**base, "case_ref": "C.C. No. 5 of 2024"})
    assert "TO BE CONFIRMED]" in mid.upper()
