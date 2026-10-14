"""Golden-file tests for the TN/Madras court forms set (generalised for any state).

These pin what an advocate receives for each of the new procedural doc-types:
appointment/appearance, registry coding sheets, process/service applications,
bail-support instruments, criminal & civil interlocutory petitions, and the
court-issued summonses/notices/warrants (which additionally carry the
[COURT ISSUES THIS] marker)."""

import os
from datetime import date
from pathlib import Path

from src.components.render import extract_text
from ._golden import render_golden

GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE = os.environ.get("LEXDRAFT_UPDATE_GOLDEN") == "1"

D = date(2026, 8, 1)


def _assert_golden(name: str, text: str):
    import pytest
    GOLDEN_DIR.mkdir(exist_ok=True)
    path = GOLDEN_DIR / f"{name}.txt"
    if UPDATE or not path.exists():
        path.write_text(text, encoding="utf-8")
        if not UPDATE:
            pytest.skip(f"golden {name} created; rerun to assert")
        return
    assert text == path.read_text(encoding="utf-8"), f"{name} drifted from golden"


def _g(template, context, tmp_path, name):
    out = tmp_path / f"{name}.docx"
    render_golden(template, context, out)
    return extract_text(out)


def _assert_vakalat_party_table(template, context, tmp_path):
    """The vakalat's advocate LEFT / party RIGHT details block (criminal /
    small-causes / generic). It now renders as tab-stopped paragraphs (advocate
    label + party label on one line) rather than a 2-col table, so it CAN be
    dropped for the civil form via paragraph-deletion. Assert its expected labels
    are present so the advocate-form block can't silently drift."""
    from docx import Document
    out = tmp_path / "vk_table.docx"
    render_golden(template, context, out)
    doc = Document(str(out))
    body = "\n".join(p.text for p in doc.paragraphs)
    assert "(Advocate — with Enrolment No)" in body
    assert "Details of the Parties :" in body
    assert "Enrolment No :" in body
    assert "Name :" in body


# ---- Cluster A: appointment / appearance ---------------------------------

def test_golden_vakalatnama_long(tmp_path):
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.LONG, executant_name="Ramesh Kumar",
                 party_role="Plaintiff", advocates=["S. Iyer", "P. Rao"],
                 case_ref="O.S. No. 12 of 2026", place="Chennai", execution_date=D,
                 court_name="THE CITY CIVIL COURT", court_place="Chennai")
    assert r.refused is False
    _assert_golden("tn_vakalatnama_long", _g(vk.TEMPLATE, r.context, tmp_path, "vk_long"))


def test_golden_vakalatnama_efiling(tmp_path):
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.EFILING, executant_name="Ramesh Kumar",
                 party_role="Petitioner", advocates=["S. Iyer"],
                 case_ref="O.P. No. 5 of 2026", place="Chennai", execution_date=D,
                 enrolment_no="MS/1234/2010", address_for_service="12 Law Chambers",
                 advocate_mobile="90000 00000", advocate_email="s@iyer.in",
                 party_contact="Ramesh, 99999 99999")
    assert r.refused is False
    _assert_golden("tn_vakalatnama_efiling", _g(vk.TEMPLATE, r.context, tmp_path, "vk_ef"))


def test_golden_vakalatnama_criminal(tmp_path):
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.LONG, executant_name="Ambeth Arivukarasan",
                 party_role="Accused", advocates=["M. Gowtham", "V. Srihari"],
                 case_ref="C.C. No. 1 of 2026", place="Chennai", execution_date=D,
                 court_name="THE JUDICIAL MAGISTRATE No. I", court_place="Chennai",
                 opposite_party_name="State", enrolment_no="MS/4687/2025",
                 state_language="Tamil", court_kind=vk.CourtKind.CRIMINAL)
    assert r.refused is False
    assert r.context["vakalat_title"] == "VAKALATNAMA"
    assert r.context["certificate_style"] == "read_over"
    txt = _g(vk.TEMPLATE, r.context, tmp_path, "vk_crim")
    # Verbatim advocate wording (criminal_vakalat.pdf) is locked here.
    assert ("do hereby appoint and retain M. Gowtham and V. Srihari to appear for "
            "me/us in the above case on my/our behalf and to plead and I/we further "
            "empower him/Her/them to accept on my/our behalf, service of notice of "
            "all Proceedings in the above case, until Disposal of the case.") in txt
    assert ("(Signature / LTI of the Complainant / Petitioner / Accused / "
            "Respondent)") in txt
    assert "read over and explained in Tamil (State Language)" in txt
    assert "I/we accept the Vakalatnama" in txt
    assert "... Respondent / Complainant / Accused" in txt  # opposite-role label
    # The advocate LEFT / party RIGHT details render in a 2-col table (not captured
    # by paragraph extraction); its content is asserted separately below.
    _assert_golden("tn_vakalatnama_criminal", txt)
    _assert_vakalat_party_table(vk.TEMPLATE, r.context, tmp_path)


def test_golden_vakalatnama_small_causes(tmp_path):
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.LONG, executant_name="Ramesh Kumar",
                 party_role="Plaintiff", advocates=["S. Iyer"],
                 case_ref="S.C. No. 7 of 2026", place="Madras", execution_date=D,
                 opposite_party_name="Suresh", court_kind=vk.CourtKind.SMALL_CAUSES,
                 counsel_fee="10,000")
    assert r.refused is False
    assert r.context["vakalat_title"] == "VAKALAT"
    assert r.context["has_fee_clause"] is True
    txt = _g(vk.TEMPLATE, r.context, tmp_path, "vk_sc")
    assert "COURT OF SMALL CAUSES AT MADRAS" in txt
    assert "out-fees" in txt
    assert "counter-agreement" in txt
    _assert_golden("tn_vakalatnama_small_causes", txt)


def test_golden_vakalatnama_civil(tmp_path):
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.LONG, executant_name="Ramesh Kumar",
                 party_role="Plaintiff", advocates=["S. Iyer"],
                 case_ref="O.S. No. 12 of 2026", place="Chennai", execution_date=D,
                 court_name="THE CITY CIVIL COURT", court_place="Chennai",
                 opposite_party_name="Suresh", court_kind=vk.CourtKind.CIVIL)
    assert r.refused is False
    assert r.context["vakalat_title"] == "VAKALAT"
    assert r.context["certificate_style"] == "read_out"
    # Civil form carries the ACCEPTED "address for service" clause and omits the
    # 2-column advocate/party details block (unlike criminal/small-causes).
    assert r.context["date_style"] == "dated_at"
    assert r.context["show_details_block"] is False
    assert r.context["advocate_sign_label"] == "Advocate for"
    # Civil advocate form has NO title on page 1 (the appoint clause follows the
    # parties directly; the VAKALAT title shows only on the page-2 backing sheet).
    assert r.context["show_page1_title"] is False
    txt = _g(vk.TEMPLATE, r.context, tmp_path, "vk_civil")
    # No "VAKALAT" title appears on page 1 before the body clause.
    _body_at = txt.find("do hereby appoint")
    assert _body_at != -1 and "VAKALAT" not in txt[:_body_at], (
        "civil page-1 must not carry a VAKALAT title before the body clause"
    )
    # Verbatim civil body wording (civil_vakalat.pdf) is locked here.
    assert ("do hereby appoint S. Iyer To appear for And retain Me/Us In the above "
            "Suit/Original/Miscellaneous Petition and to conduct and prosecute Or "
            "defend the same") in txt
    # Tail sequence in the advocate's order: Dated at -> certificate -> Advocate
    # caption -> ACCEPTED address-for-service -> Advocate for.
    assert "Dated at Chennai this" in txt
    assert "read out and explained" in txt
    assert "ACCEPTED : The address for service of the said Advocate is :" in txt
    assert "Advocate for S. Iyer" in txt
    assert "depute other counsel" in txt.lower()
    # Stacked party labels (Plaintiff / Petitioner & Defendant / Respondent).
    assert "... Plaintiff / Petitioner" in txt
    assert "... Defendant / Respondent" in txt
    _assert_golden("tn_vakalatnama_civil", txt)
    # The civil form must NOT render the advocate/party details block at all
    # (dropped via {%p if show_details_block %} paragraph-deletion).
    assert "Details of the Parties :" not in txt
    assert "(Advocate — with Enrolment No)" not in txt


def test_golden_memo_of_appearance(tmp_path):
    from src.pipelines import memo_of_appearance as mo
    r = mo.build(counsel_name="A. Menon", party_represented="Respondent",
                 party_name="Suresh", case_ref="A.S. No. 3 of 2026", place="Chennai",
                 addressed_to="The Deputy Registrar, Appellate Side",
                 enrolment_no="MS/9/2011")
    assert r.refused is False
    _assert_golden("tn_memo_of_appearance", _g(mo.TEMPLATE, r.context, tmp_path, "memo"))


# ---- Cluster B: coding sheet ---------------------------------------------

def test_golden_coding_sheet_original(tmp_path):
    from src.pipelines import coding_sheet as cs
    r = cs.build(side=cs.CodingSide.ORIGINAL, petitioner_name="Anand",
                 respondent_name="Balu", act_and_provision="Order VII CPC",
                 subject_matter="recovery of money", court_place="Chennai",
                 case_type="C.S.", value_of_claim="2,50,000", court_fee="10,000",
                 order_violated="")
    assert r.refused is False
    _assert_golden("tn_coding_sheet_original", _g(cs.TEMPLATE, r.context, tmp_path, "cs_o"))


def test_golden_coding_sheet_criminal_hcp(tmp_path):
    from src.pipelines import coding_sheet as cs
    r = cs.build(side=cs.CodingSide.CRIMINAL, petitioner_name="Vijay",
                 respondent_name="State", act_and_provision="Article 226",
                 subject_matter="habeas corpus", court_place="Chennai",
                 in_jail=True, crime_no="Cr. No. 55 of 2026",
                 police_station="Egmore", is_hcp=True,
                 detaining_authority="Commissioner of Police")
    assert r.refused is False
    _assert_golden("tn_coding_sheet_criminal", _g(cs.TEMPLATE, r.context, tmp_path, "cs_c"))


# ---- Cluster C: process / service applications ---------------------------

def test_golden_process_application_civil(tmp_path):
    from src.pipelines import process_application as pa
    r = pa.build(forum=pa.Forum.CIVIL, case_ref="O.S. No. 12 of 2026",
                 applicant_name="Anand", applicant_role="Plaintiff",
                 rows=[pa.ProcessRow("summons to the defendant", "the defendant",
                                     "Chennai", process_fee="50")],
                 place="Chennai", value_of_claim="2,50,000", filing_date=D)
    assert r.refused is False
    _assert_golden("tn_process_application", _g(pa.TEMPLATE, r.context, tmp_path, "pa"))


def test_golden_copy_application(tmp_path):
    from src.pipelines import copy_application as ca
    r = ca.build(forum=ca.Forum.CITY_CIVIL, case_ref="O.S. No. 12 of 2026",
                 applicant_name="Anand", applicant_role="Plaintiff",
                 documents=[ca.CopyDocRow("the decree", date_of_document="2026-06-01",
                                          date_of_filing="2026-05-01",
                                          order_under_which="Order dated 1.6.2026"),
                            ca.CopyDocRow("the plaint", date_of_document="2026-05-01")],
                 place="Chennai", addressed_to="The Copying Officer", rule_ref="43",
                 court_name="City Civil Court", court_place="Chennai",
                 opposite_party_name="Balu", os_no="12", os_year="26", filing_date=D)
    assert r.refused is False
    txt = _g(ca.TEMPLATE, r.context, tmp_path, "ca")
    # New advocate format (04_Copy_Application_Civil_and_Crime.pdf) locked here:
    assert "IN THE COURT" in txt and "SUBORDINATE JUDGE" in txt and "DISTRICT MUNSIFF" in txt
    assert "O.S. No." in txt
    # title "Application for Certified Copies" appears BELOW the parties (after To)
    assert txt.index("Versus") < txt.index("Application for Certified Copies")
    assert "UNDER RULE" in txt
    assert "It is requested that" in txt and "hereunder mentioned" in txt
    _assert_golden("tn_copy_application", txt)
    # The 5-column schedule renders as a TABLE (extract_text skips tables) — assert
    # its header + the autofilled rows via the docx table cells.
    from docx import Document
    _out = tmp_path / "ca_tbl.docx"
    render_golden(ca.TEMPLATE, r.context, _out)
    _tables = Document(str(_out)).tables
    assert _tables, "copy application schedule table missing"
    _cells = " | ".join(
        p.text for t in _tables for row in t.rows for c in row.cells for p in c.paragraphs
    )
    assert "Serial" in _cells and "Description of Document" in _cells
    assert "Order if any under which" in _cells
    # both documents rendered as rows
    assert "the decree" in _cells and "the plaint" in _cells


def test_copy_application_is_civil_form_for_any_case(tmp_path):
    """The copy-application form is a CIVIL copying form and must render the SAME
    way for ANY case the advocate gives — criminal, civil, writ, empty. Regardless
    of the case's roles / statute:
      - roles are ALWAYS Plaintiff / Defendant (never Complainant/Accused/etc.);
      - "Counsel for Plaintiff" (never the case role);
      - UNDER RULE is ALWAYS blank (never the case's offence sections);
      - no [DRAFT] review banner;
      - a long court name never collides the heading labels ("JUDGEAT").
    This locks the general behaviour, not just the Thoorigai case.
    """
    from src.pipelines import copy_application as ca
    cases = [
        # (label, build kwargs) — criminal, writ, and a long court name.
        ("criminal_s138", dict(
            applicant_name="ABC Traders", applicant_role="Complainant",
            opposite_party_name="XYZ Ltd", opposite_role="Accused",
            court_name="JMFC Court", rule_ref="s.138 NI Act",
            documents=[ca.CopyDocRow("Cheque", date_of_document="2026-01-01")])),
        ("writ", dict(
            applicant_name="Petnr", applicant_role="Petitioner",
            opposite_party_name="State", opposite_role="Respondent",
            court_name="High Court", rule_ref="Article 226",
            documents=[ca.CopyDocRow("order")])),
        ("long_court_name", dict(
            applicant_name="P", opposite_party_name="D",
            court_name="The Principal District and Sessions Court, Coimbatore",
            court_place="Coimbatore",
            documents=[ca.CopyDocRow("judgment", date_of_document="2026-03-03")])),
    ]
    for label, kw in cases:
        r = ca.build(**kw)
        assert r.refused is False, label
        txt = _g(ca.TEMPLATE, r.context, tmp_path, f"ca_{label}")
        assert "Plaintiff" in txt and "Defendant" in txt, label
        assert "Complainant" not in txt and "Accused" not in txt, label
        assert "Respondent" not in txt and "Petitioner" not in txt, label
        assert "Counsel for Plaintiff" in txt, label
        assert "UNDER RULE ______" in txt, label          # always blank
        assert "s.138" not in txt and "Article 226" not in txt, label  # no statute
        assert "[DRAFT" not in txt, label                  # no review banner
        assert "JUDGEAT" not in txt, label                 # no heading collision


def test_golden_call_for_memo(tmp_path):
    from src.pipelines import call_for_memo as cm
    r = cm.build(court_name="George Town", court_place="Chennai", pincode="600 016",
                 cc_no="125", cc_year="6", complainant_name="Anand",
                 accused_name="Balu",
                 documents=["the complaint", "the sworn statement", "the cheque"],
                 court_fee="50", place="Chennai", filing_date=D)
    assert r.refused is False
    txt = _g(cm.TEMPLATE, r.context, tmp_path, "cfm")
    # Advocate format (01_Call_for_Memo.pdf) locked here:
    assert "In the Court of Hon'ble Judicial Magistrate" in txt
    assert "C.C.No." in txt
    assert "... Complainant" in txt and "... Accused" in txt
    assert "-Versus-" in txt
    assert "CALL FOR MEMO" in txt
    assert "applied for certified copy of the following documents" in txt
    # numbered documents autofilled
    assert "1) the complaint" in txt and "3) the cheque" in txt
    assert "Court fee of Rs." in txt
    assert "COUNSEL FOR ACCUSED" in txt
    _assert_golden("tn_call_for_memo", txt)


def test_call_for_memo_fill_in_blank_when_empty(tmp_path):
    """FILL-IN FORM: with nothing supplied it renders the blank form (five blank
    numbered lines + fill-in blanks), never refuses."""
    from src.pipelines import call_for_memo as cm
    r = cm.build()
    assert r.refused is False
    txt = _g(cm.TEMPLATE, r.context, tmp_path, "cfm_empty")
    assert "CALL FOR MEMO" in txt
    # the five blank numbered lines are present
    for n in range(1, 6):
        assert f"{n})" in txt


def test_golden_batta_witness(tmp_path):
    from src.pipelines import batta_witness as bw
    r = bw.build(court_name="City Civil Court", court_place="Chennai",
                 os_no="12", os_year="26", plaintiff_name="Anand",
                 defendant_name="Balu", applicant_role="Plaintiff",
                 value_of_claim="2,50,000", court_day="15-10-2026",
                 rows=[bw.BattaRow(nature_of_process="Summons to witness u/O.16 CPC",
                                   person_description="Dr. K. Rao, Doctor",
                                   place_of_service="Egmore, Chennai",
                                   distance_miles="3", process_fees="50")],
                 place="Chennai", filing_date=D)
    assert r.refused is False
    txt = _g(bw.TEMPLATE, r.context, tmp_path, "bw")
    # Advocate format (05_Batta_Witness.pdf) — paragraph-level bits:
    assert "IN THE COURT OF" in txt
    assert "O.S. No." in txt
    assert "issue of Process (and Deposit of witness Batta Etc.)" in txt
    assert "Counsel for" in txt
    _assert_golden("tn_batta_witness", txt)
    # The header block (parties / value / court day) and the 10-column schedule
    # render in TABLES (extract_text skips tables) — assert via the docx cells.
    from docx import Document
    _out = tmp_path / "bw_tbl.docx"
    render_golden(bw.TEMPLATE, r.context, _out)
    _cells = " | ".join(
        p.text for t in Document(str(_out)).tables for row in t.rows
        for c in row.cells for p in c.paragraphs
    )
    assert "Plaintiff" in _cells and "Defendant" in _cells
    assert "Value of the claim Rs." in _cells and "Court day" in _cells
    assert "Nature of process" in _cells
    assert "Travelling" in _cells and "Process fees" in _cells and "Remarks" in _cells
    assert "Summons to witness u/O.16 CPC" in _cells   # autofilled row
    assert "Dr. K. Rao, Doctor" in _cells


def test_batta_witness_blank_when_empty(tmp_path):
    """FILL-IN FORM: with nothing supplied it renders the blank ruled form (empty
    10-column table + fill-in blanks), never refuses."""
    from src.pipelines import batta_witness as bw
    r = bw.build()
    assert r.refused is False
    from docx import Document
    _out = tmp_path / "bw_empty.docx"
    render_golden(bw.TEMPLATE, r.context, _out)
    doc = Document(str(_out))
    # the 10-column table (with the header) is present even with no data rows
    assert doc.tables, "batta schedule table missing"
    hdr = " | ".join(c.text for c in doc.tables[-1].rows[0].cells)
    assert "Nature of process" in hdr and "Remarks" in hdr


def test_golden_recall_petition(tmp_path):
    from src.pipelines import recall_petition as rp
    r = rp.build(court_name="Magistrate First Class Court, Chennai", court_place="Chennai",
                 cc_no="C.C. No. 125 of 2026", accused_name="Anand",
                 complainant_name="State by S.I. of Police, Egmore",
                 warrant_type="N.B.W.", place="Chennai", filing_date=D)
    assert r.refused is False
    txt = _g(rp.TEMPLATE, r.context, tmp_path, "rp")
    # Advocate format (02_Recall_Petition.pdf) locked here:
    assert "In the Court of Hon'ble Judicial Magistrate" in txt
    assert "C.C. / Crime No." in txt
    assert "... Petitioner / Accused" in txt and "Complainant / Respondent" in txt
    assert "-Vs-" in txt
    assert "PETITION U/S.70 (2) Cr.P.C." in txt
    assert "neither wilful nor wanton" in txt
    assert "recall the warrant of arrest issued against the accused" in txt
    assert "Accused Signature" in txt and "Counsel for the Accused" in txt
    # heading de-duplicated (no doubled "Magistrate ... Magistrate ... Court")
    assert "Magistrate First Class, Chennai" in txt
    # cc_no redundant "C.C. No." prefix stripped
    assert "C.C. / Crime No. 125 of 2026" in txt
    _assert_golden("tn_recall_petition", txt)


def test_recall_petition_blank_when_empty(tmp_path):
    """FILL-IN FORM: with nothing supplied it renders the verbatim clauses with
    blank fill-in particulars, never refuses."""
    from src.pipelines import recall_petition as rp
    r = rp.build()
    assert r.refused is False
    txt = _g(rp.TEMPLATE, r.context, tmp_path, "rp_empty")
    assert "PETITION U/S.70 (2) Cr.P.C." in txt
    assert "N.B.W. / B.W." in txt   # both shown when warrant type unknown


def test_golden_process_memo(tmp_path):
    from src.pipelines import process_memo as pm
    r = pm.build(court_name="Judicial Magistrate First Class Court, Chennai",
                 court_place="Chennai", case_no="125", case_year="26",
                 petitioner_name="Anand", respondent_name="Balu",
                 process_type="summons",
                 address_for_service="No. 5, Main Road, Chennai", place="Chennai",
                 filing_date=D)
    assert r.refused is False
    txt = _g(pm.TEMPLATE, r.context, tmp_path, "pm")
    # Advocate format (03_Process_Memo.pdf) locked here:
    assert "IN THE COURT OF" in txt and "MAGISTRATE" in txt
    assert "DVC No." in txt
    assert "- Petitioner" in txt and "- Respondents" in txt
    assert "- Vs -" in txt
    assert "PROCESS MEMO" in txt
    assert "It is prayed that this Hon'ble court may be pleased issue summons" in txt
    assert "Address for Service" in txt
    assert "COUNSEL FOR THE PETITIONER" in txt
    # court de-duplicated (no doubled "Magistrate ... Magistrate ... Court")
    assert "First Class, Chennai" in txt
    _assert_golden("tn_process_memo", txt)


def test_process_memo_blank_when_empty(tmp_path):
    """FILL-IN FORM: with nothing supplied it renders the verbatim prayer with
    blank fill-in particulars, never refuses."""
    from src.pipelines import process_memo as pm
    r = pm.build()
    assert r.refused is False
    txt = _g(pm.TEMPLATE, r.context, tmp_path, "pm_empty")
    assert "PROCESS MEMO" in txt
    assert "summons / warrant" in txt   # both shown when process type unknown


def test_golden_surety_memo(tmp_path):
    from src.pipelines import surety_memo as sm
    r = sm.build(court_name="Judicial Magistrate First Class Court, Chennai",
                 court_place="Chennai", crime_no="1234", crime_year="26",
                 state_name="State of Tamil Nadu", police_inspector="Egmore P.S.",
                 accused_name="Anand", place="Chennai", filing_date=D)
    assert r.refused is False
    txt = _g(sm.TEMPLATE, r.context, tmp_path, "sm")
    # Advocate format (06_Surety_Memo.pdf) locked here:
    assert "IN THE COURT OF" in txt and "MAGISTRATE" in txt
    assert "Crime No." in txt and "(On the file of the Respondent)" in txt
    assert "State :" in txt and "Inspector of Police," in txt
    assert "Complainant" in txt and "Accused" in txt
    assert "- Versus -" in txt
    assert "SURETY MEMO" in txt
    assert ("as per the orders of this Hon'ble Court, the sureties is being "
            "furnished for the accused above named") in txt
    assert "released on bail and thus render justice" in txt
    assert "Counsel For Petitioner / Accused" in txt
    # crime year normalised to full 4 digits
    assert "Crime No. 1234 of 2026" in txt
    # court de-duplicated
    assert "First Class, Chennai" in txt
    _assert_golden("tn_surety_memo", txt)


def test_surety_memo_blank_when_empty(tmp_path):
    """FILL-IN FORM: with nothing supplied it renders the verbatim clause with
    blank fill-in particulars, never refuses."""
    from src.pipelines import surety_memo as sm
    r = sm.build()
    assert r.refused is False
    txt = _g(sm.TEMPLATE, r.context, tmp_path, "sm_empty")
    assert "SURETY MEMO" in txt
    assert "sureties is being furnished" in txt


def test_golden_affidavit_of_surety(tmp_path):
    from src.pipelines import affidavit_of_surety as af
    r = af.build(court_name="Judicial Magistrate First Class Court, Chennai",
                 court_place="Chennai", crime_no="1234", crime_year="26",
                 state_name="State of Tamil Nadu", police_station="Egmore",
                 accused_name="Vijay", offence_sections="s.420 IPC",
                 bail_sum="50,000", bail_sum_words="Fifty Thousand",
                 bail_order_date="01-07-2026", place="Chennai", filing_date=D)
    assert r.refused is False
    txt = _g(af.TEMPLATE, r.context, tmp_path, "aos")
    # Advocate format (07_Affidavit_of_Surety.pdf) locked here:
    assert "IN THE COURT OF" in txt and "MAGISTRATE" in txt
    assert "Crime No." in txt and "(On the file of the Complainant)" in txt
    assert "AFFIDAVIT OF SURETY" in txt
    assert "I beg to offer myself as a surety for the accused" in txt
    # clause-1 particulars autofilled
    assert "s.420 IPC" in txt and "50,000" in txt and "Fifty Thousand" in txt
    # the A-G questionnaire labels are present
    assert "Full name of the surety" in txt
    assert "Occupation or business" in txt
    assert "Length of time for which the Surety has known the accused" in txt
    # proof list + prayer + jurat
    assert "As per sub-rule (4) of Rule 14" in txt
    assert "I pray that I may be accepted as a surety" in txt
    assert "Solemnly affirmed at" in txt
    assert "Signature of Surety" in txt
    _assert_golden("tn_affidavit_of_surety", txt)


def test_affidavit_of_surety_blank_when_empty(tmp_path):
    """FILL-IN FORM: with nothing supplied it renders the full statutory form with
    blank fill-in particulars, never refuses."""
    from src.pipelines import affidavit_of_surety as af
    r = af.build()
    assert r.refused is False
    txt = _g(af.TEMPLATE, r.context, tmp_path, "aos_empty")
    assert "AFFIDAVIT OF SURETY" in txt
    assert "Full name of the surety" in txt


def test_golden_service_of_process(tmp_path):
    from src.pipelines import service_of_process_application as sp
    r = sp.build(case_ref="A.S. No. 3 of 2026",
                 respondents=[sp.RespondentToServe("Suresh", father_or_guardian="S/o Kumar",
                              occupation="trader", district="Chennai")],
                 place="Chennai", court_fee_amount="100", hearing_date=D)
    assert r.refused is False
    _assert_golden("tn_service_of_process", _g(sp.TEMPLATE, r.context, tmp_path, "svc"))


def test_golden_affidavit_of_service(tmp_path):
    from src.pipelines import affidavit_of_service as af
    r = af.build(deponent_name="K. Menon",
                 deponent_role="registered clerk of the petitioner's counsel",
                 petitioner_name="Ramesh", respondent_name="Suresh",
                 notice_returnable_date=date(2026, 7, 15),
                 endorsement=af.Endorsement.UNCLAIMED,
                 case_ref="I.A. No. 5 of 2026 in O.S. No. 12 of 2026", place="Chennai",
                 deponent_age="35", deponent_address="9 Clerk Lane", affirm_date=D,
                 court_name="THE CITY CIVIL COURT", ia_no="5", ia_year="26",
                 os_no="12", os_year="26")
    assert r.refused is False
    txt = _g(af.TEMPLATE, r.context, tmp_path, "af")
    # New advocate format (08_Affidavit_of_Service.pdf) locked here:
    # - cause title "In the Court of" (title-case), NOT the old top "AFFIDAVIT..."
    assert "In the Court of" in txt
    # - the title "Affidavit of Service" appears BELOW the parties (after Versus)
    assert txt.index("Versus") < txt.index("Affidavit of Service")
    # - two case-reference lines
    assert "I.A. No." in txt and "O.S.No." in txt
    # - stacked party role labels
    assert "... Petitioner / Applicant / Plaintiff" in txt
    assert "... Respondent / Defendent" in txt
    # - verbatim clause 1 opening
    assert "I am, the registered Clerk of the Petitioners Counsel on record" in txt
    _assert_golden("tn_affidavit_of_service", txt)
    # The two-column closing (Solemnly affirmed | BEFORE ME / ADVOCATE / COUNSEL
    # FOR …) renders in a table, which extract_text does not read — assert it via
    # the docx table cells so the attestation block can't silently drift.
    from docx import Document
    _out = tmp_path / "af_tbl.docx"
    render_golden(af.TEMPLATE, r.context, _out)
    _cells = " | ".join(
        p.text for t in Document(str(_out)).tables for row in t.rows
        for c in row.cells for p in c.paragraphs
    )
    assert "Solemnly affirmed at" in _cells
    assert "BEFORE ME" in _cells
    # "PLANTIFF" verbatim per the advocate's supplied form (typo reproduced on purpose).
    assert "COUNSEL FOR PETITIONER / APPLICANT / PLANTIFF" in _cells


def test_golden_substituted_service(tmp_path):
    from src.pipelines import substituted_service as ss
    r = ss.build(deponent_name="K. Menon", deponent_role="counsel for the plaintiff",
                 petitioner_name="Ramesh", respondent_name="Suresh",
                 prior_service_attempts=3, newspaper="The Daily News",
                 case_ref="I.A. No. 6 of 2026 in O.S. No. 12 of 2026", place="Chennai",
                 filing_date=D)
    assert r.refused is False
    _assert_golden("tn_substituted_service", _g(ss.TEMPLATE, r.context, tmp_path, "ss"))


# ---- Cluster D: bail-support ---------------------------------------------

def test_golden_bail_bond(tmp_path):
    from src.pipelines import bail_bond as bb
    r = bb.build(accused_name="Vijay", offence_section="s.420 IPC", bail_granted=True,
                 bail_order_court="the Principal Sessions Court", bail_order_date=date(2026, 7, 1),
                 forfeiture_sum="50,000",
                 sureties=[bb.Surety("Gopal", "5 Surety Street", "50,000")],
                 case_ref="Crl.M.P. No. 88 of 2026", place="Chennai",
                 complainant_name="State", attend_date=date(2026, 8, 10), bond_date=D)
    assert r.refused is False
    _assert_golden("tn_bail_bond", _g(bb.TEMPLATE, r.context, tmp_path, "bb"))


def test_golden_surety_affidavit(tmp_path):
    from src.pipelines import surety_affidavit as sa
    r = sa.build(surety_name="Gopal", accused_name="Vijay", offence_section="s.420 IPC",
                 bail_granted=True, bail_sum="50,000", id_proofs=["PAN card", "Aadhaar"],
                 case_ref="Crl.M.P. No. 88 of 2026", place="Chennai",
                 surety_occupation="trader", monthly_income="40,000",
                 surety_relationship_to_accused="friend")
    assert r.refused is False
    _assert_golden("tn_surety_affidavit", _g(sa.TEMPLATE, r.context, tmp_path, "sa"))


def test_golden_memorandum_furnish_sureties(tmp_path):
    from src.pipelines import memorandum_furnish_sureties as mm
    r = mm.build(accused_name="Vijay", granting_court="the Principal Sessions Court",
                 bail_granted=True, bail_order_ref="Crl.M.P. No. 88 of 2026",
                 bail_order_date=date(2026, 7, 1), case_ref="C.C. No. 10 of 2026",
                 place="Chennai", memo_date=D)
    assert r.refused is False
    _assert_golden("tn_memorandum_sureties", _g(mm.TEMPLATE, r.context, tmp_path, "mm"))


def test_golden_surrender_petition(tmp_path):
    from src.pipelines import surrender_petition as su
    r = su.build(accused_name="Vijay", offence_section="s.420 IPC", crime_no="Cr. No. 55 of 2026",
                 identification_marks=["mole on left cheek", "scar on right hand"],
                 case_ref="Crl.M.P. No. 90 of 2026", place="Chennai",
                 accused_address="7 Accused Street", state_rep_by="State",
                 police_station="Egmore", petition_date=D)
    assert r.refused is False
    _assert_golden("tn_surrender_petition", _g(su.TEMPLATE, r.context, tmp_path, "su"))


# ---- Cluster E: criminal interlocutory -----------------------------------

def test_golden_s256(tmp_path):
    from src.pipelines import s256_condone_absence as s256
    r = s256.build(complainant_name="Ramesh", accused_name="Vijay",
                   absence_reason="he is unwell and unable to travel",
                   case_ref="C.C. No. 10 of 2026", place="Chennai", petition_date=D)
    assert r.refused is False
    _assert_golden("tn_s256", _g(s256.TEMPLATE, r.context, tmp_path, "s256"))


def test_golden_s317(tmp_path):
    from src.pipelines import s317_dispense_presence as s317
    r = s317.build(accused_name="Vijay", complainant_name="Ramesh",
                   absence_reason="he is out of station on urgent work",
                   absence_not_wanton=True, case_ref="C.C. No. 10 of 2026",
                   place="Chennai", petition_date=D)
    assert r.refused is False
    _assert_golden("tn_s317", _g(s317.TEMPLATE, r.context, tmp_path, "s317"))


def test_golden_recall_warrant(tmp_path):
    from src.pipelines import recall_warrant as rw
    r = rw.build(accused_name="Vijay", absence_reason="he was hospitalised",
                 warrant_pending=True, undertaking_future_appearance=True,
                 case_ref="C.C. No. 10 of 2026", place="Chennai",
                 state_rep_by="State", police_station="Egmore", petition_date=D)
    assert r.refused is False
    _assert_golden("tn_recall_warrant", _g(rw.TEMPLATE, r.context, tmp_path, "rw"))


# ---- Cluster F: civil interlocutory --------------------------------------

def test_golden_adjournment(tmp_path):
    from src.pipelines import adjournment_petition as ap
    r = ap.build(petitioner_name="Anand", respondent_name="Balu", posted_for="trial",
                 adjournment_reason="counsel is engaged before the High Court",
                 case_ref="O.S. No. 12 of 2026", place="Chennai", petition_date=D)
    assert r.refused is False
    _assert_golden("tn_adjournment", _g(ap.TEMPLATE, r.context, tmp_path, "ap"))


def test_golden_urgent_petition(tmp_path):
    from src.pipelines import urgent_petition as up
    r = up.build(petitioner_name="Anand", respondent_name="Balu",
                 underlying_application="I.A. for interim injunction",
                 orders_prayed="an interim injunction restraining alienation",
                 case_ref="O.S. No. 12 of 2026", place="Chennai", petition_date=D)
    assert r.refused is False
    _assert_golden("tn_urgent_petition", _g(up.TEMPLATE, r.context, tmp_path, "up"))


def test_golden_appeal_record(tmp_path):
    from src.pipelines import appeal_record_cost_schedule as arc
    r = arc.build(appeal_ref="A.S. No. 3 of 2026", on_behalf_of="the appellant",
                  documents=[arc.RecordDocRow("the plaint", whole_or_part="whole",
                             pages_translation="5", pages_printing="5",
                             cost_estimate="500")],
                  place="Chennai", court_type="High Court", court_place="Madras",
                  copies_required="2", counsel_name="S. Iyer")
    assert r.refused is False
    _assert_golden("tn_appeal_record", _g(arc.TEMPLATE, r.context, tmp_path, "arc"))


# ---- Cluster G: COURT-ISSUED instruments ---------------------------------

def test_golden_summons_civil(tmp_path):
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.CIVIL_DEFENDANT, case_ref="O.S. No. 12 of 2026",
                 plaintiff_name="Anand", defendant_or_witness_name="Balu", place="Chennai",
                 cause_of_action="recovery of money", appearance_date=D, seal_date=D)
    assert r.refused is False
    assert r.context["court_issues"] is True
    _assert_golden("tn_summons_civil", _g(sm.TEMPLATE, r.context, tmp_path, "sm_c"))


def test_golden_summons_witness(tmp_path):
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.WITNESS, case_ref="O.P. No. 5 of 2026",
                 plaintiff_name="Anand", defendant_or_witness_name="Dr. K. Rao",
                 place="Chennai", appearance_date=D,
                 documents_to_produce="the accident register and case sheet",
                 expenses_tendered="Rs. 500", seal_date=D)
    assert r.refused is False
    _assert_golden("tn_summons_witness", _g(sm.TEMPLATE, r.context, tmp_path, "sm_w"))


def test_golden_summons_summary_suit(tmp_path):
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.SUMMARY_SUIT, case_ref="Summary Suit No. 4 of 2026",
                 plaintiff_name="Anand", defendant_or_witness_name="Balu", place="Chennai",
                 claim_amount="2,50,000", costs="5,000", seal_date=D)
    assert r.refused is False
    _assert_golden("tn_summons_summary_suit", _g(sm.TEMPLATE, r.context, tmp_path, "sm_s"))


def test_golden_court_notice_show_cause(tmp_path):
    from src.pipelines import court_notice as cn
    r = cn.build(kind=cn.NoticeKind.SHOW_CAUSE, case_ref="I.A. No. 1 of 2026",
                 applicant_or_petitioner_name="Anand", addressee_name="Balu",
                 place="Chennai", application_or_relief="an interim injunction",
                 appearance_date=D, seal_date=D)
    assert r.refused is False
    assert r.context["court_issues"] is True
    _assert_golden("tn_court_notice_show_cause", _g(cn.TEMPLATE, r.context, tmp_path, "cn_s"))


def test_golden_court_notice_family(tmp_path):
    from src.pipelines import court_notice as cn
    r = cn.build(kind=cn.NoticeKind.FAMILY_COURT, case_ref="H.M.O.P. No. 20 of 2026",
                 applicant_or_petitioner_name="Wife", addressee_name="Husband",
                 place="Chennai", application_or_relief="dissolution of marriage",
                 appearance_date=D, written_statement_date=D, seal_date=D)
    assert r.refused is False
    _assert_golden("tn_court_notice_family", _g(cn.TEMPLATE, r.context, tmp_path, "cn_f"))


def test_golden_court_warrant_attach_immovable(tmp_path):
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.ATTACH_IMMOVABLE, case_ref="E.P. No. 2 of 2026",
                 decree_holder_or_petitioner_name="Anand",
                 judgment_debtor_or_respondent_name="Balu", place="Chennai",
                 decree_or_order_ref="O.S. No. 12 of 2026", decree_or_order_date=date(2026, 6, 1),
                 property_schedule="House and ground at 5 Main Street, Chennai",
                 addressed_to="The Judgment-Debtor", seal_date=D)
    assert r.refused is False
    assert r.context["court_issues"] is True
    _assert_golden("tn_court_warrant_attach_immovable",
                   _g(cw.TEMPLATE, r.context, tmp_path, "cw_ai"))


def test_golden_court_warrant_injunction(tmp_path):
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.INJUNCTION_ORDER, case_ref="I.A. No. 1 of 2026",
                 decree_holder_or_petitioner_name="Anand",
                 judgment_debtor_or_respondent_name="Balu", place="Chennai",
                 restraint_text="alienating or encumbering the suit property",
                 addressed_to="The Respondent", seal_date=D)
    assert r.refused is False
    _assert_golden("tn_court_warrant_injunction",
                   _g(cw.TEMPLATE, r.context, tmp_path, "cw_inj"))
