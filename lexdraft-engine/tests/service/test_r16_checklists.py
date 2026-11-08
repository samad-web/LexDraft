"""r16 senior-advocate checklist FAILs (benchmark-h2h), pinned on the engine render
of the brief's facts through the real /v1/draft endpoint. One test per item."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.components.prayer import relief_clause  # noqa: E402
from src.service.app import app  # noqa: E402
from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R16", "version": 1}


def _text(doc_type, fields, **top):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **top})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# --- s138_notice ----------------------------------------------------------

NOTICE = {**PAYLOADS["s138_notice"], "dispatch_mode": "[how the notice is sent to be provided]"}


def test_s138_notice_proviso_b_invoked():
    text = _text("s138_notice", NOTICE, allow_placeholders=True)
    assert "UNDER CLAUSE (b) OF THE PROVISO TO SECTION 138" in text
    assert "within 30 days of the receipt of the said memo, as required by clause (b) of the proviso" in text


def test_s138_notice_mode_of_service_rpad():
    text = _text("s138_notice", NOTICE, allow_placeholders=True)
    assert "By Registered Post with Acknowledgement Due" in text
    assert "how the notice is sent" not in text
    # a mode the advocate chose is kept
    assert "By Speed Post" in _text("s138_notice", {**NOTICE, "dispatch_mode": "Speed Post"})


# --- regular_bail ---------------------------------------------------------

def test_regular_bail_cause_title_parentage():
    text = _text("regular_bail", {**PAYLOADS["regular_bail"], "accused_name": "Mr. D. Vignesh",
                                  "accused_parentage": "Mr. Dhanapal", "age": 24})
    assert "Mr. D. Vignesh, S/o Mr. Dhanapal, aged 24 years" in text
    # a relation the advocate gave is not doubled
    text = _text("regular_bail", {**PAYLOADS["regular_bail"], "accused_name": "Mr. D. Vignesh",
                                  "accused_parentage": "S/o Mr. Dhanapal"})
    assert "S/o S/o" not in text and "Mr. D. Vignesh, S/o Mr. Dhanapal" in text


# --- permanent_injunction -------------------------------------------------

PI = {**PAYLOADS["permanent_injunction"], "plaintiff_name": "Mr. T. Ramalingam",
      "plaintiff_age": "64", "plaintiff_occupation": "agriculturist",
      "plaintiff_address": "Kangeyam, Tiruppur District", "defendant_names": ["Mr. K. Duraisamy"],
      "act_restrained": "Restraining the defendant and his men from interfering with the "
                        "plaintiff's possession of the suit land and the well"}


def test_permanent_injunction_cause_title_age_occupation():
    text = _text("permanent_injunction", PI)
    assert ("Mr. T. Ramalingam, aged about 64 years, agriculturist, residing at Kangeyam, "
            "Tiruppur District.") in text


def test_permanent_injunction_pecuniary_jurisdiction():
    text = _text("permanent_injunction", PI)
    assert "within the pecuniary jurisdiction of this Hon'ble Court" in text
    assert "territorial jurisdiction to entertain this suit" in text


def test_permanent_injunction_clean_prayer():
    text = _text("permanent_injunction", PI)
    assert ("restraining the defendant, his men, agents, servants and all persons claiming "
            "under him from interfering with the plaintiff's possession of the suit land and the well;") in text
    assert "from Restraining" not in text and "from restraining" not in text
    for raw in ("restrain the defendants from dispossessing the plaintiff",
                "To restrain the defendant, his men and agents from dispossessing the plaintiff",
                "a decree of permanent injunction restraining the defendant from dispossessing the plaintiff"):
        assert relief_clause(raw, after_restraining=True) == "dispossessing the plaintiff"
    # a writ relief is not touched
    assert relief_clause("restrain the respondents from demolishing the shop").startswith("restrain")


# --- written_statement ----------------------------------------------------

WS = {**PAYLOADS["written_statement"],
      "preliminary_objections": [{"text": "The suit is barred by limitation; without the fabricated "
                                          "letter dated 10.01.2026 the suit filed on 20.07.2026 is out of time."}],
      "merit_replies": [{"plaint_para": 1, "stance": "admitted", "text": "admitted"},
                        {"plaint_para": 2, "stance": "denied", "text": "denied"},
                        {"plaint_para": 3, "stance": "denied",
                         "text": "The defendant denies the loan of Rs. 3,50,000 and the promissory note."}],
      "filing_date": "2026-11-08"}


def test_written_statement_limitation_article():
    text = _text("written_statement", WS)
    assert "governed by Article 35 of the Schedule to the Limitation Act, 1963" in text
    loan = {**WS, "merit_replies": [{**m, "text": m["text"].replace(" and the promissory note", "")}
                                    for m in WS["merit_replies"]]}
    assert "governed by Article 19 of the Schedule to the Limitation Act, 1963" in _text("written_statement", loan)


def test_written_statement_o8r1_delay_explained():
    text = _text("written_statement", {**WS, "summons_served_date": "2026-10-08"})
    assert ("served on the defendant on 08.10.2026, and this written statement is filed on "
            "08.11.2026, 31 days after service: 1 day beyond the 30 days in Order VIII Rule 1") in text
    assert "[cause of the delay in filing the written statement to be provided]" in text
    on_time = _text("written_statement", {**WS, "summons_served_date": "2026-10-10"})
    assert "Order VIII Rule 1" not in on_time


# --- divorce_mutual_first -------------------------------------------------

DIV = {**PAYLOADS["divorce_mutual_first"], "party_a": "Mr. L. Prakash", "party_b": "Mrs. P. Shalini",
       "party_a_age": 37, "party_a_address": "No. 21, T. Nagar, Chennai 600017",
       "party_b_age": 33, "party_b_address": "No. 5, Besant Nagar, Chennai 600090",
       "family_court": "Family Court", "city": "Chennai"}


def test_divorce_mutual_first_cause_title_ages_addresses():
    text = _text("divorce_mutual_first", DIV)
    head = text.split("JOINT PETITION")[0]
    assert "1. Mr. L. Prakash, Hindu, aged about 37 years, residing at No. 21, T. Nagar, Chennai 600017." in head
    assert "2. Mrs. P. Shalini, Hindu, aged about 33 years, residing at No. 5, Besant Nagar, Chennai 600090." in head


def test_divorce_mutual_first_hindus_governed_by_hma():
    text = _text("divorce_mutual_first", DIV)
    assert "Both the petitioners are Hindus and are governed by the Hindu Marriage Act, 1955." in text


def test_divorce_mutual_first_section_19_jurisdiction():
    text = _text("divorce_mutual_first", DIV)
    assert ("jurisdiction to entertain this petition under Section 19 of the Hindu Marriage Act, 1955, "
            "the marriage having been solemnised at Chennai, within its local limits.") in text
    elsewhere = _text("divorce_mutual_first", {**DIV, "marriage_place": "Madurai"})
    assert "under Section 19 of the Hindu Marriage Act, 1955." in elsewhere
    assert "solemnised at Madurai, within" not in elsewhere


# --- writ_petition --------------------------------------------------------

WRIT = {
    "petitioner_name": "Mr. A. Natarajan",
    "respondents": [
        {"serial": 1, "name": "State of Tamil Nadu represented by the Secretary, School Education Department",
         "address": "Fort St. George, Chennai 600009"},
        {"serial": 2, "name": "The Director of School Education", "address": "Chennai 600006"},
        {"serial": 3, "name": "The Accountant General (A&E), Tamil Nadu"}],
    "court_place": "Madras", "writ_type": "mandamus", "legal_right": "[to be drafted]",
    "public_duty": "[to be drafted]", "prior_demand_and_refusal": "[to be drafted]",
    "facts_narrative": "He made a representation dated 10.06.2026 to the 2nd respondent and a reminder dated 20.08.2026.",
    "alternative_remedy_addressed": True, "alternative_remedy_basis": "none",
    "filing_date": "2026-11-08", "no_similar_petition": True, "place": "Chennai",
    "day": "8th", "month": "November", "year": "2026",
    "relief_sought": "consider the petitioner's representation and sanction pension and terminal benefits within a time frame",
}


def test_writ_petition_pension_statutory_basis():
    text = _text("writ_petition", WRIT, allow_placeholders=True)
    assert "in accordance with the Tamil Nadu Pension Rules, 1978, within a period of eight weeks" in text  # r17 period
    assert "under the Tamil Nadu Pension Rules, 1978;" in text
    # not for a non-pension writ, nor against a non-TN authority
    assert "Pension Rules" not in _text("writ_petition", {**WRIT, "relief_sought": "issue patta"}, allow_placeholders=True)


def test_writ_petition_clean_prayer():
    text = _text("writ_petition", WRIT, allow_placeholders=True)
    assert ("directing the respondents to consider the petitioner's representation dated 10.06.2026 and "
            "sanction pension and terminal benefits in accordance with the Tamil Nadu Pension Rules, 1978, "
            "within a period of eight weeks from the date of receipt of a copy of this order, "  # r17
            "or within such time as this Hon'ble Court may fix") in text
    assert "time frame" not in text
    dated = _text("writ_petition", {**WRIT, "facts_narrative": "", "representation_date": "2026-06-10"},
                  allow_placeholders=True)
    assert "representation dated 10.06.2026 and sanction" in dated


# --- sale_deed / lease_deed -----------------------------------------------

def _witness_slots(text):
    tail = text.split("WITNESSES")[1]
    return ("1. [name, parentage and address of witness 1 to be provided]" in tail
            and "2. [name, parentage and address of witness 2 to be provided]" in tail)


def test_sale_deed_two_witness_slots():
    assert _witness_slots(_text("sale_deed", {**PAYLOADS["sale_deed"], "witnesses": ["[witnesses to be provided]"]},
                                allow_placeholders=True))
    named = _text("sale_deed", {**PAYLOADS["sale_deed"], "witnesses": ["Mr. K. Ravi"]})
    assert "1. Mr. K. Ravi" in named and "2. [name, parentage and address of witness 2 to be provided]" in named


def test_lease_deed_two_witness_slots():
    assert _witness_slots(_text("lease_deed", {**PAYLOADS["lease_deed"], "witnesses": ["[witnesses to be provided]"]},
                                allow_placeholders=True))
