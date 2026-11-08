"""r10 reviewer defects in writs, appeals and interlocutory applications, each
pinned on the engine render of the brief's facts."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R10-WAI", "version": 1}


def _text(doc_type, fields, **top):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **top})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


def test_writ_petition_keeps_ampersand_in_respondent_name():
    """r10: "Accountant General (A&E)" rendered "(A)" — docxtpl dropped the raw "&"."""
    text = _text("writ_petition", {
        "petitioner_name": "Mr. A. Natarajan",
        "respondents": [{"serial": 1, "name": "State of Tamil Nadu"},
                        {"serial": 2, "name": "The Director of School Education"},
                        {"serial": 3, "name": "The Accountant General (A&E), Tamil Nadu"}],
        "court_place": "Madras", "writ_type": "mandamus", "legal_right": "pension",
        "public_duty": "sanction", "prior_demand_and_refusal": "representation dated 10.06.2026",
        "alternative_remedy_addressed": True, "alternative_remedy_basis": "none",
        "filing_date": "2026-11-07", "no_similar_petition": True, "place": "Chennai",
        "day": "7th", "month": "November", "year": "2026"})
    assert "Accountant General (A&E), Tamil Nadu" in text
    assert "(A)," not in text


CRP = {"petitioner_names": ["M/s. Sri Murugan Textiles, Tiruppur"], "respondent_names": ["R. Kannan"],
       "impugned_order_ref": "I.A. No. 610 of 2026 in O.S. No. 412 of 2024", "impugned_order_date": "2026-09-22",
       "lower_court": "II Additional District Court, Tiruppur", "proceeding_ref": "O.S. No. 412 of 2024",
       "filing_date": "2026-11-07", "place": "Tiruppur"}


def test_civil_revision_prayer_sets_aside_the_order_not_the_ia_and_names_the_suit_once():
    """r10: "set aside I.A. No. 610 ... in O.S. No. 412 of 2024 dated ... passed in O.S. No. 412 of 2024"."""
    text = _text("civil_revision", CRP)
    assert ("set aside the order dated 22.09.2026 passed in I.A. No. 610 of 2026 in O.S. No. 412 of 2024 "
            "on the file of the II Additional District Court, Tiruppur") in text
    assert "passed in O.S. No. 412 of 2024 on the file" not in text
    assert "INTERIM PRAYER" not in text


def test_civil_revision_stay_of_trial_is_prayed_when_sought():
    """r10: the brief asked to stay the trial pending the revision; the draft had no stay prayer."""
    text = _text("civil_revision", {**CRP, "stay_of_proceedings_sought": True})
    assert "INTERIM PRAYER" in text
    assert "interim stay of all further proceedings in O.S. No. 412 of 2024" in text


def test_civil_revision_order_date_once_place_hc_seat_and_stay_cmp():
    """r12: "Order dated 22.09.2026 in I.A. ... dated 22.09.2026"; Place: Tiruppur; no stay CMP."""
    text = _text("civil_revision", {**CRP, "stay_of_proceedings_sought": True,
                                    "impugned_order_ref": "Order dated 22.09.2026 in I.A. No. 610 of 2026"})
    assert text.count("dated 22.09.2026") == text.count("Order dated 22.09.2026")
    assert "Place: Chennai" in text and "Place: Tiruppur" not in text
    assert "C.M.P. No. ______ of 2026" in text
    assert "PETITION FOR INTERIM STAY UNDER SECTION 151 OF THE CODE OF CIVIL PROCEDURE, 1908" in text
    assert "{%" not in text


def test_civil_first_appeal_by_defendant_prays_to_dismiss_the_suit():
    """r10: the prayer only set aside the decree; a defendant-appellant asks that the suit be dismissed."""
    text = _text("civil_first_appeal", {
        "forum": "district_court", "appellant_names": ["Mr. A. Abdul Kareem"], "respondent_names": ["Mr. R. Pandi"],
        "appellant_trial_role": "defendant", "suit_ref": "O.S. No. 156 of 2022",
        "trial_court": "District Munsif Court, Thirumangalam", "decree_date": "2026-10-14",
        "copy_applied_date": "2026-10-15", "copy_ready_date": "2026-10-24",
        "filing_date": "2026-11-07", "place": "Madurai", "court_name": "Principal District Court, Madurai"})
    assert ("set aside the judgment and decree dated 14.10.2026 passed in O.S. No. 156 of 2022 on the file of "
            "District Munsif Court, Thirumangalam and dismiss the suit in O.S. No. 156 of 2022, with costs") in text


SLP = {"slp_kind": "civil", "petitioner_name": "P. Alagarsamy", "respondents": ["M. Karuppan"],
       "impugned_court": "the Madurai Bench of the Madras High Court", "impugned_judgment_date": "2026-08-28",
       "impugned_case_ref": "S.A. No. 412 of 2019", "grounds": ["The High Court decided an unframed point."],
       "no_other_slp": True, "annexures_true_copies": True, "filing_date": "2026-11-07", "place": "New Delhi",
       "impugned_in_second_appeal": True,
       "substantial_questions_framed": ["Whether the unregistered partition list of 1974 is valid"]}


def test_special_leave_petition_synopsis_is_drafted_from_the_given_particulars():
    """r10: the synopsis was a bare "[Synopsis ... to be provided]" though the brief gives the facts."""
    text = _text("special_leave_petition", SLP)
    assert "[Synopsis" not in text
    assert ("The petitioner seeks special leave to appeal against the final judgment and order dated 28.08.2026 "
            "passed by the Madurai Bench of the Madras High Court in S.A. No. 412 of 2019, a Second Appeal") in text
    assert "admitted the Second Appeal on the substantial question(s) of law: (1) Whether the unregistered partition list of 1974" in text


def test_special_leave_petition_prays_status_quo_on_possession_of_the_property():
    """r10: no interim prayer; a title suit lost in second appeal needs status quo on possession."""
    prop = "1.20 acres of land in Survey No. 88/3, Melur taluk, Madurai District"
    text = _text("special_leave_petition", {**SLP, "subject_property": prop})
    assert "PRAYER FOR INTERIM RELIEF" in text
    assert f"directing the parties to maintain status quo as regards possession of {prop}" in text
    assert "PRAYER FOR INTERIM RELIEF" not in _text("special_leave_petition", SLP)


INJ = {"suit_ref": "O.S. No. 214 of 2026", "subject_matter": "2 cents of vacant house site in S.F. No. 118/3, Vadavalli village",
       "applicant_name": "K. Murugesan", "applicant_role": "plaintiff", "prima_facie_case": "registered sale deed",
       "balance_of_convenience": "status quo", "irreparable_injury": "loss of land", "urgency_conduct": "Prompt complaint.",
       "undertaking_as_to_damages": True, "is_ex_parte": True, "notice_futility": "trenching continues",
       "act_restrained": "Putting up any construction on the suit property till disposal of the suit",
       "place": "Coimbatore", "opposite_party_name": "S. Palanisamy"}


def test_injunction_schedule_of_suit_property_is_annexed():
    """r10: an O.XXXIX application over land had no schedule of the suit property."""
    text = _text("injunction", {**INJ, "property_schedule": "Coimbatore District, Vadavalli village, S.F. No. 118/3, 2 cents."})
    assert "SCHEDULE OF PROPERTY\nCoimbatore District, Vadavalli village, S.F. No. 118/3, 2 cents." in text
    assert "Boundaries: [North, South, East and West boundaries of the suit property to be provided]" in text
    assert "SCHEDULE OF PROPERTY" not in _text("injunction", INJ)


def test_injunction_prayer_does_not_repeat_pending_disposal_or_capitalise_the_act():
    """r10: "restrain the defendant from Putting up ... till disposal of the suit, pending the final disposal"."""
    text = _text("injunction", INJ)
    assert "restrain the defendant from putting up any construction on the suit property, pending the final disposal" in text


EP = {"decree_holder_name": "Mrs. R. Kalaivani", "judgment_debtor_name": "Mr. P. Senthilnathan",
      "execution_court": "Subordinate Court, Thanjavur", "suit_no": "O.S. No. 201 of 2022", "decree_date": "2025-01-18",
      "appeal_filed": False, "decretal_amount": 780000, "costs_amount": 42500,
      "execution_against": "House at Door No. 14, Medical College Road, Thanjavur in Survey No. 1123/2; "
                           "salary of the judgment debtor drawn through Canara Bank, Thanjavur Main branch",
      "mode_of_assistance": "Attachment and sale of the house; attachment of salary",
      "certified_copy_attached": True, "filing_date": "2026-11-07", "place": "Thanjavur"}


def test_execution_application_item_i_names_the_judgment_debtor_not_the_property():
    """r10: item (i) listed the house and the salary instead of Mr. P. Senthilnathan."""
    text = _text("execution_application", EP)
    assert "enforcement of the decree is sought: Mr. P. Senthilnathan, the Judgment Debtor" in text


def test_execution_application_schedules_the_property_and_asks_for_the_employer():
    """r10: no property schedule (O.XXI R.13) and no employer for the salary attachment."""
    text = _text("execution_application", EP)
    assert "SCHEDULE OF PROPERTY\nHouse at Door No. 14, Medical College Road, Thanjavur in Survey No. 1123/2\nBoundaries:" in text
    assert "employer / disbursing officer of the Judgment Debtor: [name and address of the employer" in text
    text = _text("execution_application", {**EP, "employer": "the Manager, XYZ Sugars Ltd."})
    assert "disbursing officer of the Judgment Debtor: the Manager, XYZ Sugars Ltd." in text


def test_special_leave_petition_unframed_question_gap_is_a_to_be_provided_marker():
    """r10: "[Whether the High Court formulated ... to be stated.]" was never filled by compose,
    which fills only "[... to be provided]" markers the facts answer."""
    text = _text("special_leave_petition", {**SLP, "substantial_questions_framed": []})
    assert "[the substantial question(s) of law on which the High Court admitted the Second Appeal " \
           "under Section 100(4) and (5) CPC to be provided]" in text


AMD = {"applicant_name": "Mrs. S. Jayalakshmi", "applicant_role": "plaintiff",
       "respondent_name": "[respondent name to be provided]", "suit_ref": "O.S. No. 88 of 2025",
       "pleading": "plaint", "proposed_amendments": ["To add Item 3 to the plaint schedule"],
       "trial_commenced": False, "filing_date": "2026-11-07", "place": "Tiruchirappalli",
       "civil_court": "Subordinate Court, Tiruchirappalli"}


def test_amendment_ia_arrays_both_brother_defendants():
    """r10: "against her two brothers" became a single "[respondent name]" party."""
    text = _text("amendment_ia", {**AMD, "respondent_count": 2}, allow_placeholders=True)
    assert "1. [name of defendant 1 to be provided]\n2. [name of defendant 2 to be provided]" in text
    assert "... RESPONDENTS / DEFENDANTS" in text
    assert "[respondent name to be provided]" not in text


def test_amendment_ia_pleads_due_diligence_even_before_trial():
    """r10: issues were framed; the proviso's due-diligence averment was absent."""
    text = _text("amendment_ia", {**AMD, "due_diligence_explanation": "the omission came to light only while collecting documents for trial"},
                 allow_placeholders=True)
    assert ("The trial has not commenced. Even so, in terms of the proviso to Order VI Rule 17 CPC, the petitioner "
            "states that in spite of due diligence the matter could not have been raised earlier: the omission") in text


def test_amendment_ia_prayer_no_para_number_and_diligence_before_trial():
    """r12: the prayer cited "paragraph 2" though compose put the amendments in para 3;
    diligence was argued against the filing of the plaint, not the commencement of trial."""
    text = _text("amendment_ia", {**AMD, "due_diligence_explanation": "the omission came to light only while collecting documents for trial."},
                 allow_placeholders=True)
    assert "paragraph 2 above" not in text
    assert "by carrying out the proposed amendments set out above" in text
    assert "documents for trial. The amendment is sought before the commencement of trial." in text


def test_counter_affidavit_sole_respondent_balance_of_convenience_documents():
    """r12: "1st respondent / acting on behalf"; no prima facie / balance of convenience
    answer to an injunction IA; no list of the documents relied on."""
    text = _text("counter_affidavit", {
        "petition_ref": "I.A. No. 1120 of 2026", "main_case_ref": "O.S. No. 540 of 2026",
        "court_name": "Principal District Munsif Court, Coimbatore",
        "petitioner_names": ["Mr. K. Arumugam"], "respondent_names": ["Mr. M. Selvaraj"],
        "answering_respondent_serial": 1, "deponent_name": "Mr. M. Selvaraj",
        "deponent_description": "[deponent description to be provided]", "petition_para_count": 2,
        "para_replies": [{"para": 1, "stance": "not_admitted"}, {"para": 2, "stance": "denied", "text": "No pathway exists."}],
        "affirm_date": "2026-11-06", "place": "Coimbatore",
        "documents": ["Sale deed of 2004", "Patta", "FMB sketch"]}, allow_placeholders=True)
    assert "FILED ON BEHALF OF THE RESPONDENT\n" in text
    assert "1. I am the respondent herein. I am well acquainted with the facts" in text
    assert "acting on behalf" not in text and "1st respondent" not in text.lower()
    assert "The balance of convenience is not in favour of the petitioner" in text
    assert "DOCUMENTS RELIED ON BY THE RESPONDENT:\n1. Sale deed of 2004\n2. Patta\n3. FMB sketch" in text
    assert "aged about ___ years" in text and "{%" not in text


def test_written_statement_additional_pleas_and_no_written_acknowledgment():
    """r12: no additional-pleas section; a limitation defence did not deny a written
    acknowledgment (s.18) or a payment acknowledged in writing (s.19)."""
    text = _text("written_statement", {
        "plaintiff_name": "Mr. P. Raju", "defendant_name": "Mr. K. Lakshmanan", "suit_ref": "O.S. No. 790 of 2026",
        "plaint_para_count": 2,
        "preliminary_objections": [{"text": "The suit is barred by limitation."}],
        "merit_replies": [{"plaint_para": 1, "stance": "not_admitted", "text": "Not admitted."},
                          {"plaint_para": 2, "stance": "denied", "text": "Denied."}],
        "additional_pleas": ["The defendant borrowed only Rs. 1,00,000 in February 2023 and repaid it in cash by June 2024."],
        "filing_date": "2026-11-07", "place": "Tiruchirappalli"})
    assert "ADDITIONAL PLEAS:\n   3. The defendant borrowed only Rs. 1,00,000" in text
    assert "4. The defendant never made any acknowledgment of liability in writing" in text
    assert "Section 19 of that Act" in text
    assert text.index("ADDITIONAL PLEAS") < text.index("PRAYER:") and "{%" not in text


def test_divorce_mutual_second_marriage_date_and_joint_affidavit():
    """r12: the brief's marriage date (25.08.2017) was lost; only a NOTE stood for the joint affidavit."""
    text = _text("divorce_mutual_second", {
        "party_a": "Mr. L. Prakash", "party_b": "Mrs. P. Shalini", "first_motion_order_date": "2026-04-15",
        "second_motion_date": "2026-11-07", "settlement_implemented": False, "place": "Chennai",
        "family_court": "Family Court, Chennai", "first_motion_case_no": "H.M.O.P. No. 912 of 2026",
        "marriage_date": "2017-08-25", "separation_date": "2025-03-01"})
    assert "Their marriage was solemnised on 25.08.2017, and they have lived separately since 01.03.2025." in text
    assert "JOINT AFFIDAVIT OF THE PETITIONERS FILED IN SUPPORT OF THE PETITION" in text
    assert "[NOTE: This joint petition must be supported" not in text and "{%" not in text


def test_permanent_injunction_schedule_from_brief_facts():
    """r12: the schedule was a "[to be drafted]" slot though the brief gave the land."""
    prop = ("3.40 acres of dry land in Survey Nos. 412/1 and 412/2, Pappini village, "
            "together with the well in Survey No. 412/2.")
    text = _text("permanent_injunction", {
        "plaintiff_name": "Mr. T. Ramalingam", "defendant_names": ["Mr. K. Duraisamy"], "suit_property": prop,
        "possession_basis": "family partition deed of 1989; patta No. 645", "act_restrained": "interfering with the well",
        "cause_of_action_date": "2026-10-02", "cause_of_action_place": "Pappini village", "court_fee": 500,
        "valuation": "Rs. 1,00,000/-", "jurisdiction_basis": "the property is within the court's limits",
        "filing_date": "2026-11-07", "place": "Kangeyam"}, allow_placeholders=True)
    schedule = text.split("SCHEDULE OF THE SUIT PROPERTY\n")[1]
    assert schedule.startswith(prop + "\n[Registration District")
    assert text.index("VERIFICATION:") < text.index("SCHEDULE OF THE SUIT PROPERTY") and "{%" not in text


ADJ = {"petitioner_name": "K. Palanisamy", "respondent_name": "R. Kumar",
       "posted_for": "cross-examination of PW1 on 10.11.2026",
       "adjournment_reason": "The petitioner underwent cataract surgery on 30.10.2026.\n"
                             "He is the only person who can instruct counsel.\n"
                             "The defendant is willing to pay costs if the court imposes them.",
       "case_ref": "O.S. No. 214 of 2024", "place": "Salem", "court_place": "Salem"}


def test_adjournment_petition_names_the_court_and_the_hearing_date():
    """r10: court left blank; "posted today for cross-examination of PW1 on 10.11.2026"."""
    text = _text("adjournment_petition", {**ADJ, "court_name": "Principal District Munsif Court, Salem"})
    assert "IN THE COURT OF THE PRINCIPAL DISTRICT MUNSIF, SALEM" in text
    assert "1. The above case is posted on 10.11.2026 for cross-examination of PW1." in text
    assert "posted today" not in text


def test_adjournment_petition_reason_lines_stay_in_one_paragraph():
    """r10: a multi-line reason printed its later lines as loose text (and "them..")."""
    text = _text("adjournment_petition", ADJ)
    assert ("2. The petitioner underwent cataract surgery on 30.10.2026. He is the only person who can instruct "
            "counsel. The defendant is willing to pay costs if the court imposes them.\n") in text
    assert "them.." not in text


def test_adjournment_petition_prays_four_weeks_with_supporting_affidavit():
    """r10: prayer was "to some other date" and the petition had no supporting affidavit."""
    text = _text("adjournment_petition", {**ADJ, "adjournment_period": "four weeks"})
    assert "adjourn the hearing of the above case posted on 10.11.2026 by four weeks" in text
    assert "AFFIDAVIT FILED IN SUPPORT OF THE PETITION\nI, K. Palanisamy," in text


SS = {"deponent_name": "Plaintiff in O.S. No. 66 of 2026 (client)", "deponent_role": "Plaintiff",
      "petitioner_name": "Plaintiff in O.S. No. 66 of 2026 (client)", "respondent_name": "Mr. V. Ravichandran",
      "prior_service_attempts": 3, "newspaper": "a Tamil daily circulating in Kumbakonam",
      "case_ref": "O.S. No. 66 of 2026", "place": "Kumbakonam",
      "court_name": "Additional Subordinate Court, Kumbakonam", "filing_date": "2026-11-07"}


def test_substituted_service_role_is_not_printed_as_the_plaintiffs_name():
    """r10: the cause title read "Plaintiff in O.S. No. 66 of 2026 (client)"."""
    text = _text("substituted_service", SS)
    assert "(client)" not in text
    assert "[name of the plaintiff to be provided]                          ... Petitioner/Plaintiff" in text
    assert "I, [name of the plaintiff to be provided], the Plaintiff" in text


def test_substituted_service_is_a_petition_with_a_supporting_affidavit():
    """r10: only an affidavit under a petition heading; now the I.A. petition, then its affidavit."""
    text = _text("substituted_service", SS)
    assert "I.A. No. ______ of 2026\nin\nO.S. No. 66 of 2026" in text
    petition = text.index("For the reasons stated in the accompanying affidavit, the petitioner prays")
    affidavit = text.index("AFFIDAVIT FILED IN SUPPORT OF THE PETITION")
    assert petition < affidavit < text.index("Solemnly affirmed at Kumbakonam")


def test_condone_delay_petition_has_the_petitioners_affidavit_with_hospital_records():
    """r10: the supporting affidavit was only a "[NOTE: To be supported by ...]"."""
    text = _text("condone_delay_petition", {
        "main_proceeding": "appeal", "main_proceeding_desc": "A.S. No. ___ of 2026", "petitioner_name": "Mrs. P. Meena",
        "respondent_names": ["R. Suresh"], "court_name": "THE PRINCIPAL DISTRICT JUDGE, VELLORE",
        "impugned_order_ref": "the judgment and decree in O.S. No. 73 of 2023", "impugned_order_date": "2026-06-12",
        "period_days": 30, "filing_date": "2026-11-07", "place": "Vellore",
        "sufficient_cause": "the petitioner was admitted at CMC Hospital, Vellore from 20.07.2026 to 02.09.2026",
        "supporting_documents": "the discharge summary and hospital records of CMC Hospital, Vellore"})
    assert "[NOTE: To be supported" not in text
    assert "AFFIDAVIT FILED IN SUPPORT OF THE PETITION\nI, Mrs. P. Meena," in text
    # b2 item 12: the affidavit is the deponent's own word (this asserted the third-person slip)
    assert "I state that the delay was caused because I was admitted at CMC Hospital" in text
    assert "I produce the discharge summary and hospital records of CMC Hospital, Vellore, marked as annexures" in text
    assert "DEPONENT" in text
