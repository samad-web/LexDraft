"""Refusal-path tests for the TN/Madras court forms set.

Each test drives a pipeline to a hard-stop and asserts the specific refusal code,
proving the legal precondition is enforced (never silently drafted around). The
happy paths are pinned by the golden tests; this file pins the refusals.
"""

from datetime import date

D = date(2026, 8, 1)


# ---- vakalatnama ----------------------------------------------------------

def test_vakalatnama_fills_in_missing_advocate():
    # FILL-IN, never refuse (user rule): no advocate on record -> a clearly-marked
    # placeholder the advocate completes, NOT a refusal.
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.LONG, executant_name="R", party_role="Plaintiff",
                 advocates=[], case_ref="OS 1", place="P")
    assert not r.refused
    assert r.context["advocates"] == ["[advocate name to be provided]"]


def test_vakalatnama_fills_in_missing_executant():
    # FILL-IN, never refuse: no executant on record -> placeholder, not a refusal.
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.LONG, executant_name="  ", party_role="Plaintiff",
                 advocates=["A"], case_ref="OS 1", place="P")
    assert not r.refused
    assert "to be provided" in r.context["executant_name"]


def test_vakalatnama_efiling_refuses_no_enrolment():
    from src.pipelines import vakalatnama as vk
    r = vk.build(kind=vk.VakalatKind.EFILING, executant_name="R", party_role="Plaintiff",
                 advocates=["A"], case_ref="OS 1", place="P")
    assert r.refused and r.refusal.code == "vakalatnama_enrolment_no_missing"


# ---- memo_of_appearance ---------------------------------------------------

def test_memo_refuses_no_party_represented():
    from src.pipelines import memo_of_appearance as mo
    r = mo.build(counsel_name="A", party_represented="", party_name="R",
                 case_ref="OS 1", place="P")
    assert r.refused and r.refusal.code == "memo_party_represented_missing"


def test_memo_refuses_no_counsel():
    from src.pipelines import memo_of_appearance as mo
    r = mo.build(counsel_name="   ", party_represented="Petitioner", party_name="R",
                 case_ref="OS 1", place="P")
    assert r.refused and r.refusal.code == "memo_counsel_not_named"


# ---- coding_sheet ---------------------------------------------------------

def test_coding_sheet_refuses_missing_parties():
    from src.pipelines import coding_sheet as cs
    r = cs.build(side=cs.CodingSide.ORIGINAL, petitioner_name="", respondent_name="S",
                 act_and_provision="Order VII", subject_matter="recovery", court_place="P")
    assert r.refused and r.refusal.code == "coding_sheet_parties_missing"


def test_coding_sheet_refuses_missing_subject():
    from src.pipelines import coding_sheet as cs
    r = cs.build(side=cs.CodingSide.ORIGINAL, petitioner_name="R", respondent_name="S",
                 act_and_provision="  ", subject_matter="recovery", court_place="P")
    assert r.refused and r.refusal.code == "coding_sheet_subject_missing"


def test_coding_sheet_criminal_hcp_refuses_no_detaining_authority():
    from src.pipelines import coding_sheet as cs
    r = cs.build(side=cs.CodingSide.CRIMINAL, petitioner_name="R", respondent_name="S",
                 act_and_provision="Art 226", subject_matter="hcp", court_place="P",
                 is_hcp=True, detaining_authority=None)
    assert r.refused and r.refusal.code == "coding_sheet_hcp_detaining_authority_missing"


# ---- process_application --------------------------------------------------

def test_process_application_refuses_no_rows():
    from src.pipelines import process_application as pa
    r = pa.build(forum=pa.Forum.CIVIL, case_ref="OS 1", applicant_name="R",
                 applicant_role="Plaintiff", rows=[], place="P")
    assert r.refused and r.refusal.code == "process_application_no_process_rows"


def test_process_application_refuses_no_applicant():
    from src.pipelines import process_application as pa
    r = pa.build(forum=pa.Forum.CIVIL, case_ref="OS 1", applicant_name="  ",
                 applicant_role="Plaintiff",
                 rows=[pa.ProcessRow("summons", "D", "Chennai")], place="P")
    assert r.refused and r.refusal.code == "process_application_applicant_missing"


# ---- copy_application -----------------------------------------------------
# FILL-IN COURT FORM: a missing applicant / no documents is NOT a refusal — it
# renders the form's blank lines (autofill from the case, or the advocate
# completes by hand). The old "refuse on no documents / no applicant" contract was
# replaced.

def test_copy_application_no_documents_renders_blank_not_refused():
    from src.pipelines import copy_application as ca
    r = ca.build(forum=ca.Forum.CITY_CIVIL, case_ref="OS 1", applicant_name="R",
                 applicant_role="Plaintiff", documents=[], place="P")
    assert r.refused is False


def test_copy_application_fully_empty_renders_blank_form():
    from src.pipelines import copy_application as ca
    r = ca.build()  # nothing extracted at all
    assert r.refused is False


# ---- call_for_memo --------------------------------------------------------
# FILL-IN COURT FORM: never refuses; renders blanks for anything not supplied.

def test_call_for_memo_fully_empty_renders_blank_form():
    from src.pipelines import call_for_memo as cm
    r = cm.build()  # nothing extracted at all
    assert r.refused is False


def test_call_for_memo_tolerates_documents_none():
    # The adapter passes documents=None when the field is omitted; the pipeline
    # must treat that as "no documents" (not crash iterating None).
    from src.pipelines import call_for_memo as cm
    r = cm.build(documents=None)
    assert r.refused is False
    assert r.context["documents"] == []


def test_call_for_memo_dedupes_court_heading():
    # The heading already says "Judicial Magistrate"; a case court like "Court of
    # the Magistrate First Class Court, Chennai" must be de-duplicated so it does
    # not double the heading. Only the distinguishing remainder is kept.
    from src.pipelines import call_for_memo as cm
    r = cm.build(court_name="Court of the Magistrate First Class Court, Chennai")
    cn = r.context["court_name"]
    assert "First Class" in cn and "Chennai" in cn
    assert "Court of" not in cn and "Magistrate" not in cn


def test_call_for_memo_lifts_pincode_from_place():
    # A 6-digit pincode present in the court place is lifted into the pincode line.
    from src.pipelines import call_for_memo as cm
    r = cm.build(court_place="Chennai - 600 016")
    assert r.context["pincode"] == "600 016"


# ---- batta_witness --------------------------------------------------------

def test_batta_witness_no_doubled_at_when_place_in_court_name():
    # "AT <place>" is dropped when the place already appears in the court name
    # (avoids "... Court, Chennai AT Chennai").
    from src.pipelines import batta_witness as bw
    r = bw.build(court_name="Magistrate First Class Court, Chennai", court_place="Chennai")
    assert r.context["court_at"] == ""


def test_batta_witness_keeps_at_when_place_not_in_court_name():
    from src.pipelines import batta_witness as bw
    r = bw.build(court_name="City Civil Court", court_place="Coimbatore")
    assert r.context["court_at"] == "Coimbatore"


def test_batta_witness_blank_form_has_several_rows():
    # With nothing extracted, the schedule is pre-filled with blank ruled rows so
    # the advocate can hand-enter several witnesses (each cell auto-grows in Word).
    from src.pipelines import batta_witness as bw
    r = bw.build()
    assert len(r.context["rows"]) >= 4
    assert all(row["nature_of_process"] == "" for row in r.context["rows"])


def test_batta_witness_uses_actual_rows_when_present():
    from src.pipelines import batta_witness as bw
    r = bw.build(rows=[bw.BattaRow(nature_of_process="Summons")])
    assert len(r.context["rows"]) == 1
    assert r.context["rows"][0]["nature_of_process"] == "Summons"


def test_batta_witness_formats_date_parts():
    from datetime import date
    from src.pipelines import batta_witness as bw
    r = bw.build(filing_date=date(2026, 9, 8))
    assert r.context["filing_day"] == "8"
    assert r.context["filing_month"] == "September"
    assert r.context["filing_year"] == "2026"
    # no date -> blank parts (advocate fills)
    r2 = bw.build()
    assert r2.context["filing_day"] is None


# ---- service_of_process_application ---------------------------------------

def test_service_of_process_refuses_no_respondents():
    from src.pipelines import service_of_process_application as sp
    r = sp.build(case_ref="AS 1", respondents=[], place="P")
    assert r.refused and r.refusal.code == "service_of_process_no_respondents"


# ---- affidavit_of_service -------------------------------------------------
# This is a FILL-IN COURT FORM: a missing value is NOT a refusal — it renders as
# the form's blank line for the advocate to complete (autofill from the case, or
# edit by hand). So the pipeline never refuses; the old "refuse on missing
# deponent / returnable date" contract was replaced.

def test_affidavit_of_service_missing_deponent_renders_blank_not_refused():
    from src.pipelines import affidavit_of_service as af
    r = af.build(deponent_name="  ", deponent_role="clerk", petitioner_name="R",
                 respondent_name="S", notice_returnable_date=D,
                 endorsement=af.Endorsement.LEFT, case_ref="IA 5", place="P")
    assert r.refused is False


def test_affidavit_of_service_missing_returnable_date_renders_blank_not_refused():
    from src.pipelines import affidavit_of_service as af
    r = af.build(deponent_name="K", deponent_role="clerk", petitioner_name="R",
                 respondent_name="S", notice_returnable_date=None,
                 endorsement=af.Endorsement.LEFT, case_ref="IA 5", place="P")
    assert r.refused is False
    assert r.context["notice_returnable_date"] is None


def test_affidavit_of_service_fully_empty_renders_blank_form():
    from src.pipelines import affidavit_of_service as af
    r = af.build()  # nothing extracted at all
    assert r.refused is False


# ---- substituted_service --------------------------------------------------

def test_substituted_service_refuses_no_prior_attempts():
    from src.pipelines import substituted_service as ss
    r = ss.build(deponent_name="K", deponent_role="counsel", petitioner_name="R",
                 respondent_name="S", prior_service_attempts=0, newspaper="News",
                 case_ref="IA 6", place="P")
    assert r.refused and r.refusal.code == "substituted_service_no_prior_attempts"


def test_substituted_service_refuses_no_newspaper():
    from src.pipelines import substituted_service as ss
    r = ss.build(deponent_name="K", deponent_role="counsel", petitioner_name="R",
                 respondent_name="S", prior_service_attempts=2, newspaper="  ",
                 case_ref="IA 6", place="P")
    assert r.refused and r.refusal.code == "substituted_service_newspaper_missing"


# ---- bail_bond ------------------------------------------------------------

def test_bail_bond_refuses_bail_not_granted():
    from src.pipelines import bail_bond as bb
    r = bb.build(accused_name="V", offence_section="s.420", bail_granted=False,
                 bail_order_court="Sessions", bail_order_date=None, forfeiture_sum="50000",
                 sureties=[bb.Surety("G")], case_ref="CMP 1", place="P")
    assert r.refused and r.refusal.code == "bail_bond_bail_not_granted"


def test_bail_bond_refuses_no_forfeiture_sum():
    from src.pipelines import bail_bond as bb
    r = bb.build(accused_name="V", offence_section="s.420", bail_granted=True,
                 bail_order_court="Sessions", bail_order_date=D, forfeiture_sum="  ",
                 sureties=[bb.Surety("G")], case_ref="CMP 1", place="P")
    assert r.refused and r.refusal.code == "bail_bond_forfeiture_sum_missing"


# ---- surety_affidavit -----------------------------------------------------

def test_surety_affidavit_refuses_bail_not_granted():
    from src.pipelines import surety_affidavit as sa
    r = sa.build(surety_name="G", accused_name="V", offence_section="s.420",
                 bail_granted=False, bail_sum="50000", id_proofs=["PAN"],
                 case_ref="CMP 1", place="P")
    assert r.refused and r.refusal.code == "surety_affidavit_bail_not_granted"


def test_surety_affidavit_refuses_no_id_proof():
    from src.pipelines import surety_affidavit as sa
    r = sa.build(surety_name="G", accused_name="V", offence_section="s.420",
                 bail_granted=True, bail_sum="50000", id_proofs=[], case_ref="CMP 1",
                 place="P")
    assert r.refused and r.refusal.code == "surety_affidavit_no_id_proof"


# ---- memorandum_furnish_sureties ------------------------------------------

def test_memorandum_sureties_refuses_bail_not_granted():
    from src.pipelines import memorandum_furnish_sureties as mm
    r = mm.build(accused_name="V", granting_court="Sessions", bail_granted=False,
                 bail_order_ref="CMP 1", bail_order_date=None, case_ref="CC 1", place="P")
    assert r.refused and r.refusal.code == "memorandum_sureties_bail_not_granted"


# ---- surrender_petition ---------------------------------------------------

def test_surrender_refuses_no_offence_section():
    from src.pipelines import surrender_petition as su
    r = su.build(accused_name="V", offence_section="  ", crime_no="Cr 5",
                 identification_marks=["mole"], case_ref="CMP 1", place="P")
    assert r.refused and r.refusal.code == "surrender_petition_offence_section_missing"


def test_surrender_refuses_no_identification_marks():
    from src.pipelines import surrender_petition as su
    r = su.build(accused_name="V", offence_section="s.420", crime_no="Cr 5",
                 identification_marks=[], case_ref="CMP 1", place="P")
    assert r.refused and r.refusal.code == "surrender_petition_no_identification_marks"


# ---- s256 / s317 / recall_warrant -----------------------------------------

def test_s256_refuses_no_absence_reason():
    from src.pipelines import s256_condone_absence as s256
    r = s256.build(complainant_name="R", accused_name="V", absence_reason="  ",
                   case_ref="CC 1", place="P")
    assert r.refused and r.refusal.code == "s256_absence_reason_missing"


def test_s317_refuses_absence_not_averred_non_wanton():
    from src.pipelines import s317_dispense_presence as s317
    r = s317.build(accused_name="V", complainant_name="R", absence_reason="ill",
                   absence_not_wanton=False, case_ref="CC 1", place="P")
    assert r.refused and r.refusal.code == "s317_absence_not_averred_non_wanton"


def test_recall_warrant_refuses_no_warrant_pending():
    from src.pipelines import recall_warrant as rw
    r = rw.build(accused_name="V", absence_reason="ill", warrant_pending=False,
                 undertaking_future_appearance=True, case_ref="CC 1", place="P")
    assert r.refused and r.refusal.code == "recall_warrant_no_warrant_pending"


def test_recall_warrant_refuses_no_undertaking():
    from src.pipelines import recall_warrant as rw
    r = rw.build(accused_name="V", absence_reason="ill", warrant_pending=True,
                 undertaking_future_appearance=False, case_ref="CC 1", place="P")
    assert r.refused and r.refusal.code == "recall_warrant_no_undertaking"


# ---- adjournment / urgent / appeal_record ---------------------------------

def test_adjournment_refuses_no_posted_for():
    from src.pipelines import adjournment_petition as ap
    r = ap.build(petitioner_name="A", respondent_name="B", posted_for="  ",
                 adjournment_reason="engaged", case_ref="OS 1", place="P")
    assert r.refused and r.refusal.code == "adjournment_posted_for_missing"


def test_urgent_refuses_no_underlying_application():
    from src.pipelines import urgent_petition as up
    r = up.build(petitioner_name="A", respondent_name="B", underlying_application="  ",
                 orders_prayed="injunction", case_ref="OS 1", place="P")
    assert r.refused and r.refusal.code == "urgent_petition_no_underlying_application"


def test_appeal_record_refuses_no_documents():
    from src.pipelines import appeal_record_cost_schedule as arc
    r = arc.build(appeal_ref="AS 1", on_behalf_of="appellant", documents=[], place="P")
    assert r.refused and r.refusal.code == "appeal_record_no_documents"


# ---- summons (court-issued) -----------------------------------------------

def test_summons_refuses_missing_parties():
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.CIVIL_DEFENDANT, case_ref="OS 1", plaintiff_name="",
                 defendant_or_witness_name="B", place="P")
    assert r.refused and r.refusal.code == "summons_parties_missing"


def test_summons_witness_refuses_no_particulars():
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.WITNESS, case_ref="OP 1", plaintiff_name="A",
                 defendant_or_witness_name="W", place="P",
                 documents_to_produce=None, appearance_date=None)
    assert r.refused and r.refusal.code == "summons_witness_no_particulars"


def test_summons_summary_suit_refuses_no_claim():
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.SUMMARY_SUIT, case_ref="SS 1", plaintiff_name="A",
                 defendant_or_witness_name="B", place="P", claim_amount=None)
    assert r.refused and r.refusal.code == "summons_summary_suit_claim_missing"


def test_summons_sets_court_issues():
    from src.pipelines import summons as sm
    r = sm.build(kind=sm.SummonsKind.CIVIL_DEFENDANT, case_ref="OS 1", plaintiff_name="A",
                 defendant_or_witness_name="B", place="P", cause_of_action="recovery")
    assert not r.refused and r.context["court_issues"] is True


# ---- court_notice (court-issued) ------------------------------------------

def test_court_notice_refuses_no_addressee():
    from src.pipelines import court_notice as cn
    r = cn.build(kind=cn.NoticeKind.SHOW_CAUSE, case_ref="IA 1",
                 applicant_or_petitioner_name="A", addressee_name="  ", place="P",
                 application_or_relief="injunction")
    assert r.refused and r.refusal.code == "court_notice_addressee_missing"


def test_court_notice_show_cause_refuses_no_application():
    from src.pipelines import court_notice as cn
    r = cn.build(kind=cn.NoticeKind.SHOW_CAUSE, case_ref="IA 1",
                 applicant_or_petitioner_name="A", addressee_name="B", place="P",
                 application_or_relief=None)
    assert r.refused and r.refusal.code == "court_notice_application_not_identified"


def test_court_notice_produce_refuses_no_documents():
    from src.pipelines import court_notice as cn
    r = cn.build(kind=cn.NoticeKind.PRODUCE_DOCUMENTS, case_ref="IA 1",
                 applicant_or_petitioner_name="A", addressee_name="B", place="P",
                 documents_description=None)
    assert r.refused and r.refusal.code == "court_notice_documents_not_identified"


# ---- court_warrant (court-issued) -----------------------------------------

def test_court_warrant_refuses_missing_parties():
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.ATTACH_MOVABLE, case_ref="EP 1",
                 decree_holder_or_petitioner_name="", judgment_debtor_or_respondent_name="B",
                 place="P")
    assert r.refused and r.refusal.code == "court_warrant_parties_missing"


def test_court_warrant_execution_refuses_no_decree():
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.ATTACH_IMMOVABLE, case_ref="EP 1",
                 decree_holder_or_petitioner_name="A", judgment_debtor_or_respondent_name="B",
                 place="P", decree_or_order_ref=None, decree_or_order_date=None,
                 property_schedule="house")
    assert r.refused and r.refusal.code == "court_warrant_decree_not_identified"


def test_court_warrant_execution_refuses_no_schedule():
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.POSSESSION, case_ref="EP 1",
                 decree_holder_or_petitioner_name="A", judgment_debtor_or_respondent_name="B",
                 place="P", decree_or_order_ref="OS 1", decree_or_order_date=D,
                 property_schedule=None)
    assert r.refused and r.refusal.code == "court_warrant_schedule_missing"


def test_court_warrant_injunction_refuses_no_restraint():
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.INJUNCTION_ORDER, case_ref="IA 1",
                 decree_holder_or_petitioner_name="A", judgment_debtor_or_respondent_name="B",
                 place="P", restraint_text=None)
    assert r.refused and r.refusal.code == "court_warrant_restraint_missing"


def test_court_warrant_sets_court_issues():
    from src.pipelines import court_warrant as cw
    r = cw.build(kind=cw.WarrantKind.INJUNCTION_ORDER, case_ref="IA 1",
                 decree_holder_or_petitioner_name="A", judgment_debtor_or_respondent_name="B",
                 place="P", restraint_text="alienating the property")
    assert not r.refused and r.context["court_issues"] is True
