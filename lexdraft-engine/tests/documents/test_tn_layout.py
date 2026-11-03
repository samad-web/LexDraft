"""Madras / Tamil Nadu layout + the legal fixes from the senior-advocate review
(2026-11-03). Two guards:

  * no shipped template carries a Delhi-style idiom ("IN THE MATTER OF", "R/o",
    "SUIT NO.", "Non-applicant", "S.H.O.", "High Court of Chennai");
  * each reviewed format renders the TN form and the corrected law.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient

from src.service.app import app
from tests.service.test_all_adapters_roundtrip import PAYLOADS

_SHARED = Path(__file__).resolve().parents[2] / "templates" / "shared"
_DELHI = re.compile(r"IN THE MATTER OF|\bR/o |SUIT NO\.|Non-applicant|S\.H\.O|"
                    r"High Court of Chennai|HIGH COURT OF MADRAS HIGH COURT", re.I)


def _template_text(path: Path) -> str:
    doc = Document(str(path))
    cells = [c.text for t in doc.tables for row in t.rows for c in row.cells]
    return "\n".join([p.text for p in doc.paragraphs] + cells)


@pytest.mark.parametrize("path", sorted(_SHARED.glob("*.docx")), ids=lambda p: p.name)
def test_no_delhi_idioms_in_any_template(path):
    hits = _DELHI.findall(_template_text(path))
    assert not hits, f"{path.name} carries Delhi-style idioms: {hits}"


_client = TestClient(app)


def _draft(doc_type: str, **over) -> str:
    fields = {**PAYLOADS[doc_type], **over}
    body = _client.post(f"/v1/draft/{doc_type}", json={
        "matter": {"matter_id": "M", "version": 1}, "fields": fields}).json()
    assert body.get("outcome") == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# -- criminal subordinate courts --------------------------------------------

def test_anticipatory_bail_tn_cause_title_prayer_and_no_prior_petition():
    t = _draft("anticipatory_bail", bail_court="Principal Sessions Judge, Coimbatore")
    assert "IN THE COURT OF THE PRINCIPAL SESSIONS JUDGE, COIMBATORE" in t
    assert "Crl.M.P. No. ______ of" in t
    assert "(In Crime No. 45/2024 on the file of the Inspector of Police, E4" in t
    assert "residing at Chennai" in t and "-Vs-" in t
    assert "State rep. by the Inspector of Police" in t
    assert "BHARATIYA NAGARIK SURAKSHA SANHITA, 2023" in t
    assert "not filed any other petition for anticipatory bail" in t and "[confirm before filing]" in t
    assert "in the event of his arrest by the respondent police in Crime No. 45/2024" in t
    assert "and thus render justice" in t and "Counsel for the Petitioner" in t
    assert "S.H.O" not in t and "APPLICANT" not in t


def test_regular_bail_never_asserts_charge_sheet_without_the_field():
    unknown = PAYLOADS["regular_bail"].copy()
    unknown.pop("chargesheet_filed")
    body = _client.post("/v1/draft/regular_bail", json={
        "matter": {"matter_id": "M", "version": 1}, "fields": unknown}).json()
    t = "\n".join(b["text"] for b in body["blocks"])
    assert "the final report (charge sheet) has been filed." not in t
    assert "[whether the final report (charge sheet) has been filed — to be confirmed]" in t
    assert "the final report (charge sheet) has been filed." in _draft(
        "regular_bail", chargesheet_filed=True)


# -- High Court headings ------------------------------------------------------

@pytest.mark.parametrize("hc", ["Madras High Court", "High Court of Chennai", "", "Chennai"])
def test_contempt_heading_is_madras_never_doubled(hc):
    t = _draft("contempt_petition", high_court=hc or None)
    assert "IN THE HIGH COURT OF JUDICATURE AT MADRAS" in t
    assert "MADRAS HIGH COURT" not in t and "OF CHENNAI" not in t
    assert "Cont.P. No. ______ of 2024" in t


def test_contempt_madurai_bench_named_contemnor_and_ss10_12_prayer():
    t = _draft("contempt_petition", high_court="Madras High Court, Madurai Bench",
               respondents=["The Commissioner, Coimbatore Corporation"])
    assert "(MADURAI BENCH)" in t
    assert "[name of the officer to be provided], The Commissioner" in t
    assert "Respondent/Contemnor" in t and "Respondents/Contemnors" not in t
    assert "punish the respondent/contemnor under Sections 10 to 12 of the Contempt of " \
           "Courts Act, 1971" in t
    assert "direct the respondent to comply with the said order forthwith" in t


def test_writ_petition_madras_heading_affidavit_memo_and_specific_relief():
    t = _draft("writ_petition", court_place="Chennai", impugned_order_number="",
               impugned_order_date=None,
               relief_sought="sanction and disburse the petitioner's pension",
               petitioner_description="S/o Arumugam, aged 62, residing at Vadapalani")
    assert "IN THE HIGH COURT OF JUDICATURE AT MADRAS" in t and "OF CHENNAI" not in t
    assert "(SPECIAL ORIGINAL JURISDICTION)" in t and "W.P. No. ______ of 2024" in t
    assert ("directing the respondent to sanction and disburse the petitioner's "
            "pension") in t
    assert "MEMO OF PARTIES" in t
    assert "AFFIDAVIT FILED IN SUPPORT OF THE WRIT PETITION" in t
    assert "I, Citizen A, S/o Arumugam, aged 62, residing at Vadapalani, do hereby " \
           "solemnly affirm and sincerely state as follows:" in t
    assert "DEPONENT" in t and "BEFORE ME," in t


def test_writ_criminal_detenu_in_custody_is_habeas_corpus():
    t = _draft("writ_criminal", pre_execution_stage=False, high_court="Madurai Bench",
               detenu_name="R. Saravanan",
               detention_place="Central Prison, Tiruchirappalli")
    assert "H.C.P. No. ______ of 2016" in t and "(MADURAI BENCH)" in t
    assert "HABEAS CORPUS PETITION FILED UNDER ARTICLE 226" in t
    assert "issue a Writ of Habeas Corpus, calling for the records relating to the " \
           "detention order" in t
    assert "produce the detenu, R. Saravanan, now confined at Central Prison, " \
           "Tiruchirappalli, before this Hon'ble Court and set the detenu at liberty" in t
    assert "482 OF THE CODE OF CRIMINAL PROCEDURE" not in t


def test_writ_criminal_pre_execution_stays_a_writ_petition():
    t = _draft("writ_criminal")
    assert "W.P.(Crl.) No." in t and "Habeas Corpus" not in t


def test_transfer_within_state_is_s24_tr_cmp():
    t = _draft("transfer_petition", from_court="Family Court, Chennai",
               from_state="Tamil Nadu", to_court="Family Court, Madurai",
               to_state="Tamil Nadu")
    assert "IN THE HIGH COURT OF JUDICATURE AT MADRAS" in t
    assert "Tr.C.M.P. No. ______ of 2024" in t
    assert "PETITION FILED UNDER SECTION 24 OF THE CODE OF CIVIL PROCEDURE" in t
    assert "SUPREME COURT" not in t


# -- civil ---------------------------------------------------------------------

def test_permanent_injunction_never_rs_0_and_pleads_s27c():
    t = _draft("permanent_injunction", court_fee=0)
    assert "Rs. 0/-" not in t
    assert "Section 27(c) of the Tamil Nadu Court Fees and Suits Valuation Act, 1955" in t
    assert "[court fee to be provided]" in t
    assert "O.S. No. ______ of 2024" in t and "SUIT NO" not in t


def test_injunction_ia_in_os():
    t = _draft("injunction")
    assert "I.A. No. ______ of" in t and "in O.S." in t
    assert "Respondent/Defendant" in t and "NON-APPLICANT" not in t.upper()


def test_civil_revision_art227_is_crp_pd():
    t = _draft("civil_revision")
    assert "C.R.P.(PD) No. ______ of 2025" in t
    assert "Civil Revision Petition filed under Article 227 of the Constitution of India" in t
    assert "Section 115" not in t


def test_indigent_application_is_the_plaint_with_r2_schedule():
    t = _draft("indigent_application")
    assert "pending disposal" not in t
    assert "Order XXXIII Rule 8" in t
    assert "SCHEDULE OF THE MOVABLE AND IMMOVABLE PROPERTY" in t
    t2 = _draft("indigent_application", property_schedule=["Nil"])
    assert "1. Nil" in t2


def test_execution_petition_o21_r11_particulars():
    t = _draft("execution_application", interest_note="")
    for item in ("(a) Number of the suit", "(g) The amount with interest due",
                 "(j) The mode in which the assistance of the Court is required"):
        assert item in t
    assert "Order XXI Rules 54 and 64" in t and "Rules 48 / 48A" in t
    assert "[rate, period and amount of interest due" in t
    assert "E.P. No. ______ of 2024" in t


def test_succession_certificate_state_is_never_a_respondent():
    t = _draft("succession_certificate")
    assert "The State" not in t
    assert "other legal heirs" in t


def test_slp_synopsis_limitation_and_second_appeal():
    t = _draft("special_leave_petition", impugned_in_second_appeal=True,
               list_of_dates=["14.12.2015 — impugned judgment"])
    assert "SYNOPSIS AND LIST OF DATES" in t and "14.12.2015 — impugned judgment" in t
    assert "LIMITATION: the period of ninety days" in t
    assert "Second Appeal under Section 100 of the Code of Civil Procedure" in t
    assert "Section 100(4) and (5) CPC" in t


# -- family / tribunals ----------------------------------------------------------

def test_maintenance_interim_under_proviso_to_s144_1():
    t = _draft("maintenance")
    assert "second proviso to sub-section (1) of Section 144 BNSS" in t
    assert "144(2)" not in t


def test_mact_s166_3_limitation_averment():
    t = _draft("mact_claim", filing_date="2024-06-01")
    assert "filed within six months of the accident" in t
    assert "inserted by the Motor Vehicles (Amendment) Act, 2019" in t
    assert "omitted" not in t.lower()
    late = _draft("mact_claim", filing_date="2025-01-15")
    assert "more than six months thereafter" in late
    assert "M.C.O.P. No." in t


def test_rcr_and_js_no_stock_certified_copy_and_s19():
    for dt in ("restitution_conjugal_rights", "judicial_separation"):
        t = _draft(dt)
        assert "certified copy" not in t
        assert "Section 19 of the Hindu Marriage Act, 1955" in t
        assert "F.C.O.P. No." in t


def test_judicial_separation_custody_prayer_s26_when_sought():
    t = _draft("judicial_separation", custody_sought="the minor son, R. Arjun, aged 4")
    assert "(b) grant custody of the minor son, R. Arjun, aged 4 to the petitioner " \
           "under Section 26 of the Hindu Marriage Act, 1955" in t
    assert "(iii-a)" in t
    assert "Section 26" not in _draft("judicial_separation")


def test_s106_notice_no_end_of_month_requirement():
    t = _draft("s106_notice")
    assert "end of a month" not in t and "month of the tenancy" not in t
    assert "fifteen days from the date of receipt of this notice" in t
