"""Drafting-quality fixes (2026-11-07) for affidavit, appeal_record_cost_schedule,
caveat, coding_sheet, s80_notice and vakalatnama, each driven by the advocate's brief."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-QUALITY-FORMS", "version": 1}


def _text(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields,
                                                       "allow_placeholders": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# --- affidavit: Tahsildar name-correction affidavit ------------------------------

_TAHSILDAR = {
    "matter_type": "other", "affidavit_kind": "supporting",
    "deponent_name": "K. Ramesh", "age": 45, "parentage_type": "S/o",
    "parentage_name": "Kandasamy", "occupation": "farmer",
    "address": "No. 12, Gandhi Road, Erode", "role": "[role to be provided]",
    "proceeding": "[proceeding to be provided]", "place": "Erode",
    "attestor": "[attesting officer to be provided]",
    "body_paras": ["My name is wrongly recorded as K. Ramaswamy in the patta for S.F. No. 88/2, Chithode village.",
                   "K. Ramesh and K. Ramaswamy are one and the same person."],
    "prayer": "[prayer to be provided]", "court_name": "Tahsildar, Erode",
}


def test_affidavit_authority_affidavit_has_no_suit_cause_title():
    text = _text("affidavit", _TAHSILDAR)
    assert "BEFORE THE TAHSILDAR, ERODE" in text
    for wrong in ("PLAINTIFF", "DEFENDANT", "[plaintiff name]", "IN THE COURT OF", "above suit",
                  "[role to be provided]"):
        assert wrong not in text, wrong
    assert "I am the deponent herein" in text


def test_affidavit_authority_prayer_is_the_actual_request():
    text = _text("affidavit", {**_TAHSILDAR, "prayer": "correct my name as K. Ramesh in the patta for S.F. No. 88/2"})
    assert "Hon'ble Court" not in text
    assert "I therefore request the Tahsildar, Erode to correct my name as K. Ramesh in the patta" in text
    # r12: a "wrongly recorded as" body now implies its request (see
    # test_affidavit_name_correction_request_stated); with no such fact the gap stays.
    missing = _text("affidavit", {**_TAHSILDAR, "body_paras": _TAHSILDAR["body_paras"][1:]})
    assert "I therefore request the Tahsildar, Erode to [request to be provided]." in missing


def test_affidavit_court_name_already_saying_court_is_not_doubled():
    text = _text("affidavit", {**_TAHSILDAR, "court_name": "District Munsif Court, Erode",
                               "role": "plaintiff", "prayer": "allow the application"})
    assert "IN THE DISTRICT MUNSIF COURT, ERODE" in text
    assert "COURT OF DISTRICT MUNSIF COURT" not in text
    assert "pleased to allow the application" in text


# --- caveat u/s 148-A CPC ------------------------------------------------------------

_CAVEAT = {
    "caveator_name": "Mr. R. Natarajan", "caveator_age": 60,
    "caveator_address": "No. 9, Mahalingapuram, Pollachi",
    "expected_petitioner_name": "Mr. K. Saravanan", "petitioner_address": "No. 31, Kovai Road, Pollachi",
    "impugned_order_ref": "decree for permanent injunction in O.S. No. 212 of 2024",
    "impugned_order_date": "2026-10-15", "lower_court": "District Munsif Court, Pollachi",
    "apprehended_proceeding": "Appeal with a stay petition against the decree in O.S. No. 212 of 2024",
    "copy_served_on_petitioner": True, "filing_date": "2026-11-07", "place": "Coimbatore",
    "court_name": "Principal District Court, Coimbatore",
}


def test_caveat_caveator_age_in_cause_title():
    text = _text("caveat", _CAVEAT)
    assert "Mr. R. Natarajan, aged about 60 years, residing at No. 9, Mahalingapuram, Pollachi" in text


def test_caveat_para2_names_the_decree_once():
    text = _text("caveat", _CAVEAT)
    assert ("may file Appeal with a stay petition against the said decree before this Hon'ble Court"
            in text)
    assert "against the said order" not in text
    assert "against the decree" not in text
    assert ("passed the decree for permanent injunction in O.S. No. 212 of 2024 on 15.10.2026"
            in text)
    assert "against the caveator." not in text  # the caveator obtained the decree


def test_caveat_has_caveators_affidavit():
    text = _text("caveat", _CAVEAT)
    assert "AFFIDAVIT OF THE CAVEATOR" in text
    assert "I, Mr. R. Natarajan, aged about 60 years, residing at No. 9, Mahalingapuram, Pollachi" in text
    assert "Section 148-A(2)" in text and "BEFORE ME" in text
    assert "[NOTE: An affidavit" not in text


# --- vakalatnama (civil) ---------------------------------------------------------------

_VAKALAT = {
    "court_kind": "civil", "executant_name": "R. Natarajan", "executant_age": 60,
    "party_address": "No. 9, Mahalingapuram, Pollachi", "party_role": "Plaintiff",
    "advocates": ["Mr. S. Arun"], "address_for_service": "No. 10, Court Road, Pollachi",
    "enrolment_no": "MS/1234/2010", "case_ref": "O.S. No. 212 of 2026",
    "court_name": "District Munsif Court, Pollachi", "place": "Pollachi",
}


def test_vakalatnama_endorsement_is_advocate_for_the_party():
    text = _text("vakalatnama", _VAKALAT)
    assert "Advocate for Plaintiff" in text
    assert "Advocate for Mr. S. Arun" not in text
    assert "Mr./Ms. Mr." not in text and "Mr. S. Arun" in text


def test_vakalatnama_advocate_address_and_client_particulars_filled():
    text = _text("vakalatnama", _VAKALAT)
    assert "address for service of the said Advocate is : No. 10, Court Road, Pollachi" in text
    assert "I/We, R. Natarajan, aged about 60 years, residing at No. 9, Mahalingapuram, Pollachi, the Plaintiff" in text


def test_vakalatnama_court_name_already_saying_court_is_not_doubled():
    text = _text("vakalatnama", _VAKALAT)
    assert "IN THE DISTRICT MUNSIF COURT, POLLACHI" in text
    assert "COURT OF DISTRICT MUNSIF COURT" not in text


# --- s80_notice ---------------------------------------------------------------------

_S80 = {
    "advocate": "[advocate to be provided]", "client": "Mr. V. Kumar, No. 5, Anna Nagar, Chennai",
    "addressee": "The Secretary, Revenue Department, State of Tamil Nadu, and The District Collector, Chennai",
    "government_body": "State of Tamil Nadu",
    "plaintiff_name_description": "Mr. V. Kumar, No. 5, Anna Nagar, Chennai",
    "cause_of_action": "Demolition of the compound wall on S.F. No. 101, Anna Nagar on 05.09.2026 without notice",
    "reliefs": ["Payment of compensation of Rs. 4,00,000 for the demolition of the compound wall",
                "Failing compliance, a suit will be filed after two months from the notice."],
    "notice_date": "2026-11-07", "place": "Chennai",
}


def test_s80_notice_states_title_and_illegality():
    text = _text("s80_notice", {**_S80,
                                "client_title": "My client is the owner of the land and compound wall in S.F. No. 101, Anna Nagar",
                                "illegality_ground": "it was demolished without any prior notice to my client"})
    assert ("Cause of action: My client is the owner of the land and compound wall in S.F. No. 101, Anna Nagar. "
            "Demolition of the compound wall") in text
    assert "The said act is illegal, in that it was demolished without any prior notice to my client." in text
    # r13: a cause of action "without notice" now states that ground itself; a ground
    # the facts do not give stays a named gap.
    bare = _text("s80_notice", _S80)
    assert "The said act is illegal, in that it was done without any notice to my client." in bare
    unknown = _text("s80_notice", {**_S80, "cause_of_action": "Demolition of the compound wall on S.F. No. 101, Anna Nagar on 05.09.2026"})
    assert "The said act is illegal: [ground on which the act is illegal to be provided]." in unknown


def test_s80_notice_clear_two_month_demand():
    text = _text("s80_notice", _S80)
    assert ("calls upon you to grant the above reliefs within two months from the date of service of this "
            "notice, failing which my client will institute a suit against State of Tamil Nadu") in text
    assert "a suit will be filed after two months" not in text  # said once, in the demand


# --- coding_sheet (Madras High Court, writ side) -------------------------------------

_CODING = {
    "side": "writ", "petitioner_name": "Mr. V. Kumar", "petitioner_address": "No. 5, Anna Nagar, Chennai",
    "respondent_name": "The District Collector, Chennai and the Tahsildar, Egmore",
    "respondents": ["The District Collector, Chennai", "The Tahsildar, Egmore"],
    "act_and_provision": "Article 226 of the Constitution of India",
    "subject_matter": "Mandamus to dispose of patta transfer application dated 12.05.2026",
    "nature_of_relief": "Writ of Mandamus", "court_place": "Chennai",
    "petitioner_counsel": "Mr. S. Arun", "counsel_enrolment_no": "MS/1234/2010",
    "case_type": "Writ Petition (Mandamus)",
}


def test_coding_sheet_heading_is_high_court_of_judicature_at_madras():
    text = _text("coding_sheet", _CODING)
    assert text.splitlines()[1] == "IN THE HIGH COURT OF JUDICATURE AT MADRAS"
    madurai = _text("coding_sheet", {**_CODING, "court_place": "Madurai"})
    assert "BEFORE THE MADURAI BENCH OF MADRAS HIGH COURT" in madurai


def test_coding_sheet_addresses_respondents_enrolment_and_relief():
    text = _text("coding_sheet", _CODING)
    assert "Petitioner / Appellant: Mr. V. Kumar, No. 5, Anna Nagar, Chennai" in text
    assert "R1: The District Collector, Chennai\nR2: The Tahsildar, Egmore" in text
    assert "Counsel for Petitioner/Appellant: Mr. S. Arun, Enrolment No. MS/1234/2010" in text
    assert "Nature of relief sought: Writ of Mandamus" in text
    bare = _text("coding_sheet", {k: v for k, v in _CODING.items()
                                  if k not in ("respondents", "counsel_enrolment_no", "nature_of_relief")})
    assert "R1: The District Collector, Chennai and the Tahsildar, Egmore" in bare
    assert "[enrolment no. to be provided]" in bare
    assert "Nature of relief sought: [writ / relief to be provided]" in bare


# --- appeal_record_cost_schedule ------------------------------------------------------

_ARCS = {
    "appeal_ref": "A.S. No. 58 of 2026", "on_behalf_of": "Mr. S. Ravi (appellant)",
    "documents": [{"description": "Typed matter of the record", "pages_printing": "120"},
                  {"description": "Exhibits (4 exhibits to be copied)"}],
    "place": "Madurai", "court_type": "Principal District Court", "court_place": "Madurai",
    "lower_court_case": "O.S. No. 156 of 2022", "lower_court": "District Munsif Court, Melur",
}


def test_appeal_record_cost_schedule_lower_court_particulars():
    text = _text("appeal_record_cost_schedule", _ARCS)
    assert "(Arising out of O.S. No. 156 of 2022 on the file of the District Munsif Court, Melur)" in text


def test_appeal_record_cost_schedule_costs_are_placeholders_without_rates():
    text = _text("appeal_record_cost_schedule", _ARCS)
    assert "Form 476" not in text  # unverified for a District Court A.S.: neutral label
    # evidence-tables: the Estimated cost column of each of the two rows
    assert text.count("| [to be computed at the rate prescribed by the Court] |") == 2
    assert "Total estimated cost: [to be computed at the rate prescribed by the Court]" in text
    priced = _text("appeal_record_cost_schedule", {**_ARCS, "documents": [
        {"description": "Typed matter", "cost_estimate": "Rs. 1,200"},
        {"description": "Exhibits", "cost_estimate": "300"}]})
    assert "Total estimated cost: Rs. 1,500" in priced
