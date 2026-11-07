"""2026-11-07 drafting-quality r12 -> Competes: criminal court forms (default
bail, recall, s.279 absence, H.C.P., sureties). Each test pins one reviewer
defect from the r12 suite briefs (Tiruchirappalli, Madurai, Coimbatore, Salem)."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.pipelines._court import pronouns, subject_clause  # noqa: E402
from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-CRIM-COMPETES", "version": 1}
_ALTS = ("he/she", "his/her", "him/her", "was / were", "was/were", "son/daughter",
         "him / her", "his / her")


def _draft(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields,
                                                       "allow_placeholders": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


def _no_alternatives(text):
    low = text.lower()
    for a in _ALTS:
        assert a not in low, a


def test_pronouns_resolve_from_title_or_gender():
    assert pronouns("Mr. B. Senthil")["he"] == "he"
    assert pronouns("Selvi R. Priya")["his"] == "her"
    assert pronouns("Tmt. K. Lakshmi")["child"] == "daughter"
    assert pronouns("R. Priya", "female")["him"] == "her"
    assert pronouns("R. Priya")["he"] == "he/she"  # unknowable: the form's choice stays
    assert subject_clause("Hospitalised for dengue", "he") == "he was hospitalised for dengue"
    assert subject_clause("had to travel to Delhi", "she") == "she had to travel to Delhi"
    assert subject_clause("He was ill.", "he") == "he was ill"


DEFAULT_BAIL = {
    "accused_name": "Mr. K. Mohan", "age": 35, "occupation": "[occupation to be provided]",
    "address": "No. 9, Thillai Nagar, Tiruchirappalli 620018",
    "fir_no": "Crime No. 301 of 2026", "police_station": "Cantonment Police Station",
    "district": "Tiruchirappalli", "sections": ["Section 318(4) BNS"],
    "offence_date": "2026-08-09", "proceeding_start_date": "2026-08-09",
    "first_remand_date": "2026-08-10",
    "offence_max_punishment_years": 7, "as_on": "2026-10-25",
    "application_ts": "2026-11-07T10:00:00", "readiness_to_furnish_bail": True,
    "place": "Tiruchirappalli", "bail_court": "Judicial Magistrate No. I, Tiruchirappalli",
    "application_date": "2026-11-07",
}


def test_default_bail_bnss_period_section_not_crpc():
    text = _draft("default_bail", DEFAULT_BAIL)
    assert "60 days (Section 187(3) BNSS)" in text
    assert "167" not in text and "CrPC" not in text


def test_default_bail_no_final_report_as_on_petition_date():
    text = _draft("default_bail", DEFAULT_BAIL)
    assert "no final report has been filed even as on the date of this petition, 07.11.2026" in text


def test_default_bail_supporting_affidavit():
    text = _draft("default_bail", DEFAULT_BAIL)
    assert "AFFIDAVIT" in text and "solemnly affirm" in text
    assert "No final report has been filed even as on the date of this affidavit" in text
    assert "BEFORE ME" in text and "aged 35 years" in text


RECALL_PETITION = {
    "court_name": "Judicial Magistrate No. I", "court_place": "Madurai",
    "cc_no": "C.C. No. 412 of 2025", "accused_name": "Mr. B. Senthil",
    "warrant_type": "non-bailable warrant", "warrant_date": "2026-10-15",
    "absence_reason": "admitted in Meenakshi Mission Hospital, Madurai from 13.10.2026 "
                      "to 18.10.2026 for dengue",
    "undertakes_to_appear": True, "place": "Madurai", "filing_date": "2026-11-07"}


def test_recall_petition_alternatives_resolved():
    text = _draft("recall_petition", RECALL_PETITION)
    _no_alternatives(text)
    assert "against him." in text and "on his own bond" in text
    assert "as he was admitted in Meenakshi Mission Hospital" in text


def test_recall_petition_medical_certificate_pleaded():
    text = _draft("recall_petition", RECALL_PETITION)
    assert "files herewith [the medical certificate / discharge summary]" in text
    text = _draft("recall_petition", {**RECALL_PETITION, "documents": ["the medical certificate"]})
    assert "The accused files herewith the medical certificate in support" in text


def test_recall_petition_police_station_state_party():
    text = _draft("recall_petition", RECALL_PETITION)
    assert "State rep. by the Inspector of Police, [police station to be provided]" in text
    text = _draft("recall_petition", {**RECALL_PETITION, "police_station": "Tallakulam"})
    assert "State rep. by the Inspector of Police, Tallakulam Police Station" in text
    assert "S.I. of Police" not in text


def test_recall_petition_supporting_affidavit():
    text = _draft("recall_petition", RECALL_PETITION)
    assert "AFFIDAVIT" in text and "I, Mr. B. Senthil," in text
    assert "as I was admitted in Meenakshi Mission Hospital" in text
    assert "I undertake to appear before this Hon'ble Court on every hearing date." in text
    assert "BEFORE ME" in text and "on this ____ day of ____________ 2026" in text


RECALL_WARRANT = {
    "accused_name": "Mr. B. Senthil", "warrant_pending": True,
    "absence_reason": "Hospitalised for dengue from 13.10.2026 to 18.10.2026 at "
                      "Meenakshi Mission Hospital, Madurai",
    "undertaking_future_appearance": True, "case_ref": "C.C. No. 412 of 2025",
    "court_name": "Judicial Magistrate No. I, Madurai", "court_place": "Madurai",
    "warrant_date": "2026-10-15", "documents": ["Medical certificate"], "place": "Madurai",
    "filing_date": "2026-11-07"}


def test_recall_warrant_as_hospitalised_grammar():
    text = _draft("recall_warrant", RECALL_WARRANT)
    assert "as he was hospitalised for dengue from 13.10.2026" in text
    assert "as Hospitalised" not in text


def test_recall_warrant_date_line():
    text = _draft("recall_warrant", RECALL_WARRANT)
    assert "Dated: 07.11.2026" in text
    no_date = {k: v for k, v in RECALL_WARRANT.items() if k != "filing_date"}
    assert "Dated: ____________" in _draft("recall_warrant", no_date)


def test_recall_warrant_undertaking_to_appear():
    text = _draft("recall_warrant", RECALL_WARRANT)
    assert "undertakes to appear before this Hon'ble Court on every date of hearing without fail" in text


S256 = {
    "complainant_name": "M/s. Sri Murugan Traders", "accused_name": "[accused name to be provided]",
    "absence_reason": "the proprietor Mr. K. Senthil was travelling to Delhi for a family wedding",
    "case_ref": "S.T.C. No. 118 of 2026", "place": "Coimbatore",
    "court_designation": "Judicial Magistrate No. I, Coimbatore", "court_place": "Coimbatore",
    "absence_date": "2026-10-28", "post_for": "evidence", "filing_date": "2026-11-07",
    "case_nature": "Section 138 of the Negotiable Instruments Act, 1881"}


def test_s256_condone_absence_bnss_s279():
    text = _draft("s256_condone_absence", S256)
    assert "PETITION UNDER SECTION 279 OF THE BHARATIYA NAGARIK SURAKSHA SANHITA, 2023" in text
    assert "256" not in text.replace("S.T.C.", "") and "Criminal Procedure" not in text


def test_s256_condone_absence_proprietor_affidavit_with_travel_proof():
    text = _draft("s256_condone_absence", S256)
    assert ("I, Mr. K. Senthil, [age, parentage and address], proprietor of "
            "M/s. Sri Murugan Traders, the complainant herein") in text
    assert "on 28.10.2026, as I was travelling to Delhi for a family wedding" in text
    assert "I file herewith [copies of the travel tickets] in proof of the same." in text
    assert "under Section 138 of the Negotiable Instruments Act, 1881" in text
    assert "Dated: 07.11.2026" in text


def test_s256_condone_absence_prays_condone_and_evidence_not_restore():
    text = _draft("s256_condone_absence", S256)
    assert ("condone the absence of the complainant on 28.10.2026 under Section 279 of the "
            "Bharatiya Nagarik Suraksha Sanhita, 2023 and permit the complainant to be "
            "represented by counsel and post the case for evidence") in text
    assert "restore" not in text.lower()
    dismissed = _draft("s256_condone_absence", {**S256, "case_dismissed": True})
    assert "restore the case to file and post the case for evidence" in dismissed
