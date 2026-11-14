"""b2 (civil batch) senior-advocate checklist FAILs, carried by the engine output itself
so the compose step cannot lose them. One test per item: test_<format>_item<N>."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from tests.service.test_r16_checklists import _text  # noqa: E402
from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402


def test_plaint_item2_firm_rep_by_managing_partner():
    firm = {**PAYLOADS["plaint"], "plaintiff_name": "M/s. Lotus Electricals", "variant": "partnership",
            "plaintiff_address": "No. 31, Ritchie Street, Chennai 600002"}
    for rep in ("Mr. G. Venkatesh, managing partner", "managing partner Mr. G. Venkatesh"):
        text = _text("plaint", {**firm, "plaintiff_representative": rep})
        assert ("M/s. Lotus Electricals, rep. by its Managing Partner Mr. G. Venkatesh, having its "
                "place of business at No. 31, Ritchie Street") in text
    # an individual plaintiff has no "rep. by"
    assert "rep. by" not in _text("plaint", {**PAYLOADS["plaint"], "plaintiff_representative": "Mr. X, agent"})


SUMMARY = {**PAYLOADS["summary_suit"], "forum": "high_court_os", "claim_basis": "written_contract",
           "instrument_ref": "written loan agreement dated 15.01.2026 and Cheque No. 300871 dated 15.07.2026",
           "interest_document_ref": None, "principal": 4500000, "interest_amount": None,
           "claimed_total": None}


def test_summary_suit_item1_pecuniary_reason_for_city_civil_court():
    text = _text("summary_suit", SUMMARY, allow_placeholders=True)
    assert "IN THE CITY CIVIL COURT" in text
    assert ("does not exceed Rs. 1,00,00,000/-, the pecuniary limit above which suits in the City of "
            "Chennai lie on the Original Side of the High Court of Judicature at Madras") in text
    # a suit filed where it was asked for carries no such reason
    assert "Original Side of the High Court" not in _text("summary_suit", PAYLOADS["summary_suit"])


def test_summary_suit_item7_agreed_rate_cites_the_loan_agreement():
    text = _text("summary_suit", SUMMARY, allow_placeholders=True)
    assert "12% per annum, the rate agreed between the parties, vide the written loan agreement dated 15.01.2026" in text
    assert "document fixing the agreed rate" not in text


def test_ejectment_item7_s106_as_amended_fifteen_days():
    text = _text("ejectment", PAYLOADS["ejectment"], allow_placeholders=True)
    assert ("Under Section 106 of the Transfer of Property Act, 1882, as amended in 2002, a tenancy from "
            "month to month is terminable by fifteen days' notice; the notice need not expire with the "
            "end of a month of the tenancy.") in text
    assert "expiring with the end of a month" not in text


def test_specific_performance_item12_schedule_of_suit_property():
    sp = {**PAYLOADS["specific_performance"],
          "suit_property": "a house site of 2,400 sq.ft. in Survey No. 175/2, Mathigiri village, Hosur taluk"}
    text = _text("specific_performance", sp, allow_placeholders=True)
    assert "SCHEDULE OF THE SUIT PROPERTY\nHouse site of 2,400 sq.ft. in Survey No. 175/2, Mathigiri village, Hosur taluk." in text


def test_injunction_item10_prayer_not_garbled():
    inj = {**PAYLOADS["injunction"], "act_restrained":
           "putting up any construction on the suit site or disturbing the plaintiff's possession, till the suit is disposed of."}
    text = _text("injunction", inj, allow_placeholders=True)
    assert ("restrain the defendant from putting up any construction on the suit site or disturbing the "
            "plaintiff's possession, pending the final disposal of the above suit") in text
    assert "disposed of." not in text


INDIGENT = {**PAYLOADS["indigent_application"], "applicant_name": "Mrs. V. Selvi",
            "applicant_address": "Sankarapuram, Kallakurichi District", "applicant_age": "42 years",
            "share_claimed": "one-third share", "property_value": 1800000,
            "cause_of_action": "Husband died on 11.02.2025 and his brothers refused to give any share"}


def test_indigent_application_item3_applicant_age():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert text.count("Mrs. V. Selvi, aged 42 years, residing at Sankarapuram") == 2   # petition + plaint


def test_indigent_application_item8_o33_r5e_no_disposal():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert ("has not, within two months next before the presentation of this petition, disposed of any "
            "property fraudulently or in order to be able to apply for permission to sue as an indigent "
            "person, and has no other means to pay the court fee (Order XXXIII Rule 5(e) CPC)") in text


def test_indigent_application_item11_co_heirs_accounted_for():
    text = _text("indigent_application", {**INDIGENT, "co_heirs": ["her two minor children"]},
                 allow_placeholders=True)
    assert ("The one-third share sued for devolved on the legal heirs, namely the petitioner and her two "
            "minor children. The petitioner claims her own share in it") in text
    assert "namely the plaintiff and her two minor children" in text
    assert "which devolved on the petitioner and her two minor children" in text   # valuation
    assert "became entitled to a one-third share" not in text
    # no co-heirs named -> nothing invented
    plain = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "CO-HEIRS" not in plain and "children" not in plain


def test_condone_delay_petition_item12_affidavit_in_first_person():
    cause = ("Earlier counsel undertook to apply for the decree copy but fell ill and did not do so. "
             "The petitioner was herself admitted at CMC Hospital, Vellore from 20.07.2026 to 02.09.2026 "
             "and could approach present counsel only on 25.09.2026; her son informed the petitioner of it")
    text = _text("condone_delay_petition", {**PAYLOADS["condone_delay_petition"],
                                            "petitioner_name": "Mrs. P. Meena", "sufficient_cause": cause},
                 allow_placeholders=True)
    assert ("3. I state that the delay was caused because earlier counsel undertook to apply for the decree "
            "copy but fell ill and did not do so. I was myself admitted at CMC Hospital, Vellore from "
            "20.07.2026 to 02.09.2026 and could approach present counsel only on 25.09.2026; my son "
            "informed me of it.") in text
    # the petition itself stays in the third person
    assert "The petitioner was herself admitted" in text


ADJ = {**PAYLOADS["adjournment_petition"], "petitioner_name": "Mr. K. Palanisamy", "petitioner_age": "67",
       "suit_nature": "Declaration and injunction over a cart-track"}


def test_adjournment_petition_item3_nature_of_suit():
    text = _text("adjournment_petition", ADJ, allow_placeholders=True)
    assert "1. The above case is a suit for declaration and injunction over a cart-track, and it is posted" in text


def test_adjournment_petition_item11_date_line():
    assert "Date:  ____________" in _text("adjournment_petition", ADJ, allow_placeholders=True)
    assert "Date:  08.11.2026" in _text("adjournment_petition", {**ADJ, "petition_date": "2026-11-08"},
                                        allow_placeholders=True)


def test_adjournment_petition_item12_deponent_age():
    text = _text("adjournment_petition", ADJ, allow_placeholders=True)
    assert "I, Mr. K. Palanisamy, aged 67 years, [parentage and address of the deponent to be provided]" in text


def test_substituted_service_item10_affidavit_prayer_not_garbled():
    text = _text("substituted_service", {**PAYLOADS["substituted_service"], "affix_court_notice_board": False,
                                         "affix_last_known_residence": True}, allow_placeholders=True)
    assert ("prayed that this Hon'ble Court may be pleased to order substituted service on the defendant (a) by "
            "affixture on the last known residence of the defendant, and (b) by publication") in text
    assert "defendant  and" not in text


EXEC = {**PAYLOADS["execution_application"], "mode_of_assistance": "attachment and sale of the house; attachment of salary",
        "employer": "a private sugar mill, where the judgment debtor works as a supervisor",
        "salary_bank": "Canara Bank, Thanjavur Main branch"}


def test_execution_application_item8_salary_employer_and_bank():
    text = _text("execution_application", EXEC, allow_placeholders=True)
    assert ("a private sugar mill, where the judgment debtor works as a supervisor; the salary is drawn "
            "through Canara Bank, Thanjavur Main branch") in text


def test_execution_application_item9_s60_salary_limits():
    text = _text("execution_application", EXEC, allow_placeholders=True)
    assert ("under clause (i) of the proviso to Section 60(1) CPC the first Rs. 1,000 and two-thirds of the "
            "remainder of the monthly salary are exempt") in text
    # no salary attachment -> no salary paragraph
    assert "Section 60(1)" not in _text("execution_application", PAYLOADS["execution_application"],
                                        allow_placeholders=True)


CRP = {**PAYLOADS["civil_revision"], "petitioner_names": ["M/s. Sri Murugan Textiles, Tiruppur"],
       "impugned_order_ref": "order dismissing I.A. No. 610 of 2026", "impugned_order_date": "2026-09-22",
       "proceeding_ref": "O.S. No. 412 of 2024", "filing_date": "2026-11-08", "copy_ready_date": "2026-10-05",
       "stay_of_proceedings_sought": True,
       "delay_explanation": None}


def test_civil_revision_item9_prayer_allows_the_ia():
    text = _text("civil_revision", {**CRP, "consequential_relief":
                 "To allow I.A. No. 610 of 2026 and refer the disputed signature to a handwriting expert."},
                 allow_placeholders=True)
    assert ("on the file of the District Munsif Court, Tambaram and allow I.A. No. 610 of 2026 and refer the "
            "disputed signature to a handwriting expert, and pass such other") in text
    # no relief extracted -> the dismissed I.A. is still allowed
    assert "Tambaram and allow I.A. No. 610 of 2026, and pass such other" in _text("civil_revision", CRP,
                                                                                allow_placeholders=True)


def test_civil_revision_item11_cmp_supporting_affidavit():
    text = _text("civil_revision", CRP, allow_placeholders=True)
    assert "AFFIDAVIT FILED IN SUPPORT OF THE PETITION FOR INTERIM STAY" in text
    assert ("I, [name, age and address of the deponent to be provided], the [partner / proprietor / authorised "
            "signatory] of M/s. Sri Murugan Textiles, Tiruppur, do hereby solemnly affirm") in text
    assert "pending disposal of the above Civil Revision Petition, and thus render justice." in text
    assert "AFFIDAVIT FILED IN SUPPORT" not in _text("civil_revision", {**CRP, "stay_of_proceedings_sought": False},
                                                     allow_placeholders=True)


def test_civil_revision_item12_art227_limitation_stated():
    text = _text("civil_revision", CRP, allow_placeholders=True)
    assert ("6. LIMITATION: No period of limitation is prescribed for a petition under Article 227 of the "
            "Constitution of India. The impugned order was passed on 22.09.2026, and the copy of the order was "
            "received on 05.10.2026. This petition is filed without delay") in text


CFA_FACTS = ("The trial court decreed the suit relying mainly on the Advocate Commissioner's report, although "
             "our objections to the report were never considered.")


def test_civil_first_appeal_item9_valuation_basis_stated():
    text = _text("civil_first_appeal", PAYLOADS["civil_first_appeal"], allow_placeholders=True)
    assert ("5. The appeal is valued at the value of the subject-matter of the appeal as it was valued in the suit "
            "[value of the relief as valued in the plaint to be provided]") in text
    assert "under Section 52 of the Tamil Nadu Court Fees and Suits Valuation Act, 1955" in text
    assert "Rs. ____" not in text


def test_civil_first_appeal_item12_order26_rule10_for_ignored_objections():
    slot = _text("civil_first_appeal", {**PAYLOADS["civil_first_appeal"], "facts_narrative": CFA_FACTS},
                 allow_placeholders=True)
    assert "Under Order XXVI Rule 10(2) CPC the report is evidence in the suit subject to the objections" in slot
    lettered = _text("civil_first_appeal", {**PAYLOADS["civil_first_appeal"], "facts_narrative": CFA_FACTS,
                                            "grounds_list": ["The FMB sketch was ignored."]}, allow_placeholders=True)
    assert "B. The trial court failed to consider the appellant's objections to the Commissioner's report." in lettered
    assert "Order XXVI" not in _text("civil_first_appeal", PAYLOADS["civil_first_appeal"], allow_placeholders=True)


SLP = {**PAYLOADS["special_leave_petition"], "impugned_court": "the Madurai Bench of the Madras High Court",
       "impugned_case_ref": "S.A. No. 412 of 2019", "impugned_judgment_date": "2026-08-28",
       "filing_date": "2026-11-08",
       "brief_facts": ("The petitioner won in O.S. No. 54 of 2011 before the District Munsif Court, Melur and again "
                       "in A.S. No. 31 of 2015 before the Principal Subordinate Court, Madurai. The High Court "
                       "allowed S.A. No. 412 of 2019. The certified copy of the judgment was received on 15.09.2026.")}


def test_special_leave_petition_item5_list_of_dates_from_the_brief():
    text = _text("special_leave_petition", SLP, allow_placeholders=True)
    # evidence-tables: the list of dates is a Date | Event table, one row per entry
    assert ("| 2011 | O.S. No. 54 of 2011 on the file of the District Munsif Court, Melur. |\n"
            "| 2015 | A.S. No. 31 of 2015 on the file of the Principal Subordinate Court, Madurai. |\n"
            "| 28.08.2026 | the Madurai Bench of the Madras High Court in S.A. No. 412 of 2019 passed the impugned "
            "final judgment and order. |\n"
            "| 15.09.2026 | The certified copy of the judgment was received on 15.09.2026. |") in text
    assert "List of dates and events" not in text


def test_special_leave_petition_item13_annexure_index():
    text = _text("special_leave_petition", SLP, allow_placeholders=True)
    # evidence-tables: the index of annexures is an Annexure | Description | Page table
    assert ("| P-2 | True copy of the judgment and decree in O.S. No. 54 of 2011 on the "
            "file of the District Munsif Court, Melur |  |\n| P-3 | True copy of the judgment and decree in "
            "A.S. No. 31 of 2015 on the file of the Principal Subordinate Court, Madurai |  |") in text


def test_transfer_petition_item11_deponent_age():
    text = _text("transfer_petition", {**PAYLOADS["transfer_petition"], "petitioner_name": "Mrs. S. Nandhini",
                                       "petitioner_age": "29"}, allow_placeholders=True)
    assert "I, Mrs. S. Nandhini, aged 29 years, [parentage and address of the deponent to be provided]" in text
    assert "[age, parentage" in _text("transfer_petition", PAYLOADS["transfer_petition"], allow_placeholders=True)


def test_o39_r2a_application_item11_no_list_attached_without_the_list():
    gap = _text("o39_r2a_application", PAYLOADS["o39_r2a_application"], allow_placeholders=True)
    assert "The list of properties is attached" not in gap
    assert "The property of the respondent liable to attachment is [the respondent's property to be attached" in gap
    given = _text("o39_r2a_application", {**PAYLOADS["o39_r2a_application"],
                                          "respondent_properties": ["House at Door No. 4, Anaiyur."]},
                  allow_placeholders=True)
    assert "The property of the respondent liable to attachment is: (1) House at Door No. 4, Anaiyur." in given


COUNTER = {**PAYLOADS["counter_affidavit"], "petition_ref": "I.A. No. 1120 of 2026", "respondent_names": ["Mr. M. Selvaraj"],
           "answering_respondent_serial": 1, "petition_para_count": 4,
           "preliminary_objections": ["The wall was completed on 25.09.2026, before the suit was filed on "
                                      "06.10.2026, so there is nothing left to restrain."],
           "para_replies": [dict(para=1, stance="not_admitted"),
                            dict(para=2, stance="denied", text="It is denied that the petitioner has any right over "
                                 "the pathway. The strip is part of the respondent's own land under his sale deed of 2004."),
                            dict(para=3, stance="not_admitted"),
                            dict(para=4, stance="not_admitted",
                                 allegation="on 20.09.2026 the respondent started building a compound wall blocking it")]}


def test_counter_affidavit_item6_para4_specific_reply():
    text = _text("counter_affidavit", COUNTER, allow_placeholders=True)
    assert ("4. The averments in paragraph 4 are not admitted, and the petitioner is put to strict proof of the same. "
            "The strip is part of the respondent's own land under his sale deed of 2004. The wall was completed on "
            "25.09.2026, before the suit was filed on 06.10.2026, so there is nothing left to restrain.") in text
    # no allegation given -> still the compose slot, nothing invented
    assert "3. The averments in paragraph 3 are not admitted, and the petitioner is put to strict proof of the same. [to be drafted]" in text


def test_counter_affidavit_item11_prayer_with_costs():
    assert "pleased to dismiss the petition with costs, and thus render justice" in _text(
        "counter_affidavit", COUNTER, allow_placeholders=True)
    kept = _text("counter_affidavit", {**COUNTER, "prayer_text": "dismiss the I.A. with exemplary costs"},
                 allow_placeholders=True)
    assert "dismiss the I.A. with exemplary costs, and" in kept
