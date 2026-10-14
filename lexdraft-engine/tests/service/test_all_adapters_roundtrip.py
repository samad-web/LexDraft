"""Integration test: every registered adapter coerces a valid inbound payload and
builds a non-refused result through the SERVICE boundary (inbound JSON -> engine).

This is the end-to-end proof that the TS-facing contract for each doc type maps to
its pipeline: the same JSON shape the frontend posts under `fields` reaches the
engine and produces a document (not a 422, not a crash). Refusal-path coverage
lives in the per-pipeline refusal tests; this pins the happy path across the whole
adapter registry.
"""

import pytest

from src.service.adapters import all_adapters, get_adapter


# One valid inbound payload per doc_type. Values mirror the golden-test facts.
PAYLOADS = {
    "affidavit": dict(
        matter_type="other", affidavit_kind="supporting",
        deponent_name="Revathi", age=42, parentage_type="W/o", parentage_name="Murugan",
        occupation="agriculturist", address="Salem", role="petitioner",
        proceeding="W.P. No. 3421 of 2024", place="Salem",
        attestor="Notary Public, Salem",
        body_paras=["The impugned order is illegal.", "There is no alternative remedy."],
        prayer="allow the writ petition", affirm_date="2024-09-04"),
    "s138_notice": dict(
        client="Ravi", advocate="A. Menon", advocate_enrolment="TN/123/2010",
        recipient_name="Suresh", recipient_address="Chennai",
        cheques=[dict(number="000123", date="2024-01-10", amount=100000,
                      bank="SBI", branch="Adyar", drawer="Suresh", payee="Ravi")],
        debt_nature="goods sold and delivered", presentation_date="2024-01-15",
        presentation_bank="Indian Bank", memo_date="2024-01-20",
        memo_received_date="2024-01-22", dishonour_reason="funds insufficient",
        notice_date="2024-02-01", dispatch_mode="RPAD",
        dispatch_tracking_placeholder="RPAD-0001", place="Chennai"),
    "s138_complaint": dict(
        complainant_name="Ravi", is_payee=True, accused_name="Suresh",
        cheques=[dict(number="000123", date="2024-01-10", amount=100000,
                      bank="SBI", branch="Adyar", drawer="Suresh", payee="Ravi")],
        presentation_date="2024-01-15", memo_date="2024-01-20",
        memo_received_date="2024-01-22", dishonour_reason="funds insufficient",
        notice_date="2024-02-01", notice_dispatch_date="2024-02-01",
        notice_delivery_date="2024-02-05", filing_date="2024-03-01",
        payee_bank_branch_in_jurisdiction=True,
        jurisdiction_basis="payee bank within jurisdiction", place="Chennai"),
    "regular_bail": dict(
        accused_name="X", age=30, occupation="driver", address="Chennai",
        fir_no="45/2024", police_station="E4", district="Chennai",
        sections=["BNS 318"], offence_date="2024-01-01", is_fresh_action=True,
        custody_since="2024-01-02", as_on="2024-03-10",
        prison="Puzhal", chargesheet_filed=False, court_level="sessions",
        place="Chennai"),
    "anticipatory_bail": dict(
        accused_name="X", age=20, occupation="director", address="Chennai",
        fir_no="45/2024", police_station="E4", district="Chennai",
        sections=["BNS 318"], offence_date="2024-01-01", is_fresh_action=True,
        apprehension_basis="false FIR", place="Chennai"),
    "default_bail": dict(
        accused_name="X", age=34, occupation="driver", address="Chennai",
        fir_no="123/2024", police_station="E4", district="Chennai",
        sections=["BNS 318"], offence_date="2024-01-01", is_fresh_action=True,
        first_remand_date="2024-01-02",
        offence_max_punishment_years=7, as_on="2024-03-10",
        application_ts="2024-03-05T10:00:00", chargesheet_filed_ts=None,
        readiness_to_furnish_bail=True, place="Chennai"),
    "general_notice": dict(
        client="Ravi", advocate="A. Menon", advocate_enrolment="TN/1",
        recipient_name="Suresh", recipient_address="Chennai", recipient_mode="RPAD",
        demand_amount=100000, act_required="pay the sum", compliance_days=15,
        civil_consequence="a civil suit for recovery",
        dispatch_tracking_placeholder="RPAD-1", notice_date="2024-02-01",
        place="Chennai"),
    "plaint": dict(
        plaintiff_name="ABC", defendant_names=["XYZ"], variant="individual",
        cause_of_action_date="2023-01-01", cause_of_action_place="Chennai",
        forum="subordinate_judge", territorial_bases=["defendant_resides"],
        principal=100000, interest_amount=12000, claimed_total=112000,
        interest_rate=18, interest_is_contractual=True,
        interest_document_ref="agreement", limitation_article="14",
        limitation_trigger_date="2023-01-01", filing_date="2024-05-01",
        place="Chennai"),
    "summary_suit": dict(
        plaintiff_name="Ramesh", defendant_names=["Suresh"],
        claim_basis="promissory_note", instrument_ref="pro-note 01-01-2023",
        cause_of_action_date="2023-01-01", cause_of_action_place="Chennai",
        forum="subordinate_judge", territorial_bases=["defendant_resides"],
        principal=100000, interest_amount=12000, claimed_total=112000,
        interest_rate=12, interest_is_contractual=True,
        interest_document_ref="pro-note", limitation_article="35",
        limitation_trigger_date="2023-01-01", filing_date="2024-05-01",
        place="Chennai"),
    "injunction": dict(
        suit_ref="O.S. 100/2024", subject_matter="the suit property",
        applicant_name="Ramesh", applicant_role="plaintiff",
        prima_facie_case="registered title", balance_of_convenience="settled possession",
        irreparable_injury="unique property", urgency_conduct="approached promptly",
        undertaking_as_to_damages=True,
        act_restrained="alienating the suit property", is_ex_parte=False,
        place="Chennai"),
    "writ_petition": dict(
        petitioner_name="Citizen A",
        respondents=[dict(serial=1, name="State of TN", is_authority=True)],
        court_place="Madras", court_side="Appellate", writ_type="mandamus",
        legal_right="statutory right", public_duty="duty to decide",
        prior_demand_and_refusal="demanded and refused",
        impugned_order_number="Proceedings No. 45/2024",
        impugned_order_date="2024-02-15", impugned_order_annexed=True,
        alternative_remedy_addressed=True, alternative_remedy_basis="illusory",
        filing_date="2024-03-01", no_similar_petition=True, place="Chennai",
        day="1", month="March", year="2024"),
    "maintenance": dict(
        petitioner_name="Lakshmi", relationship="wife", respondent_name="Murugan",
        offence_date="2024-01-01", is_fresh_action=True,
        neglect_or_refusal_pleaded=True, petitioner_rajnesh_affidavit=True,
        respondent_means="earns Rs.60000", petitioner_inability="no income",
        quantum=20000, quantum_basis="one-third income",
        jurisdiction_basis="respondent resides here", place="Chennai"),
    "dv_application": dict(
        aggrieved_name="Priya", respondent_name="Karthik",
        domestic_relationship_pleaded=True,
        domestic_relationship_basis="married and lived together",
        reliefs=[dict(head="s.18 protection", averment="restrain violence")],
        jurisdiction_basis="aggrieved resides here", place="Chennai"),
    "consumer_complaint": dict(
        complainant_name="Ravi", opposite_party_name="Acme Ltd", purpose="personal",
        consideration_paid=40000, transaction_date="2023-01-01", invoice_ref="INV-88",
        cause_of_action_date="2023-02-01", filing_date="2024-06-01",
        compensation=15000, compensation_basis="repair + agony", affidavit_present=True,
        evidence_affidavit_present=True, territorial_basis="OP carries business here",
        place="Chennai"),
    "mact_claim": dict(
        claim_kind="death", claimants=["Kavitha"], accident_date="2024-03-01",
        rash_negligent_pleaded=True, fir_ref="Crime 45/2024", vehicle_number="TN01AB1234",
        owner="R", driver="S", insurer="XYZ", policy_no="POL-99", policy_valid_on_accident=True,
        victim_age=35, victim_annual_income=300000, income_proof_present=True,
        employment="permanent_salaried", dependants=3, treatment_expenses=0,
        attendant_expenses=0, jurisdiction_basis="accident within jurisdiction",
        place="Chennai"),
    "divorce_contested": dict(
        petitioner_name="Anita", respondent_name="Rakesh", marriage_date="2018-05-01",
        marriage_place="Chennai", filing_date="2024-05-01", ground="cruelty",
        cruelty_instances=[dict(date="2023-01-10", description="assaulted")],
        no_collusion=True, no_connivance=True, no_condonation=True,
        jurisdiction_basis="marriage_solemnised", place="Chennai"),
    "divorce_mutual_first": dict(
        party_a="Anita", party_b="Rakesh", marriage_date="2015-01-01",
        marriage_place="Chennai", living_separately_since="2022-01-01",
        first_motion_date="2024-01-01", settlement_maintenance="Rs.10000/month",
        settlement_custody="with mother", settlement_property="flat to wife",
        joint_affidavit=True, place="Chennai"),
    "divorce_mutual_second": dict(
        party_a="Anita", party_b="Rakesh", first_motion_order_date="2024-01-01",
        second_motion_date="2024-09-01", settlement_implemented=True,
        waiver_sought=False, place="Chennai"),
    "permanent_injunction": dict(
        plaintiff_name="P", defendant_names=["D"], suit_property="premises",
        possession_basis="tenant", act_restrained="dispossessing the plaintiff",
        cause_of_action_date="2024-03-01", cause_of_action_place="Chennai",
        court_fee=200, valuation="Rs.2,00,000/-", jurisdiction_basis="within jurisdiction",
        filing_date="2024-05-01", place="Chennai"),
    "specific_performance": dict(
        plaintiff_name="P", defendant_name="D", suit_property="Plot 1",
        agreement_date="2023-06-01", agreement_ref="agt", total_consideration=5000000,
        earnest_paid=1000000, balance_amount=4000000, readiness_and_willingness=True,
        notice_ref="notice", cause_of_action_date="2023-09-01",
        cause_of_action_place="Chennai", court_fee=50000, filing_date="2024-02-01",
        place="Chennai"),
    "ejectment": dict(
        plaintiff_names=["P"], defendant_name="D", suit_premises="Flat 7",
        lease_ref="lease", lease_expiry_date="2023-03-31", s106_notice_ref="notice",
        s106_notice_served_date="2023-11-25", tenancy_end_date="2023-12-31",
        damages_rate_per_day=1000, annual_rent=81696, court_fee=6000,
        cause_of_action_date="2024-01-01", cause_of_action_place="Chennai",
        jurisdiction_basis="within jurisdiction", filing_date="2024-03-01",
        place="Chennai"),
    "indigent_application": dict(
        applicant_name="A", respondent_name="R", suit_ref="the suit",
        indigency_pleaded=True, indigency_particulars="no property no income",
        undertakes_to_pay_if_decreed=True, filing_date="2024-04-01", place="Chennai"),
    "o39_r2a_application": dict(
        applicant_name="A", respondent_name="R", suit_ref="O.S. 200/2023",
        injunction_order_date="2023-08-01", respondent_had_knowledge=True,
        disobedience_narrative="took forcible possession", property_list_attached=True,
        filing_date="2024-02-01", place="Chennai"),
    "caveat": dict(
        caveator_name="C", expected_petitioner_name="X",
        impugned_order_ref="order in Suit 100", impugned_order_date="2024-01-10",
        lower_court="Civil Judge", apprehended_proceeding="CM(M)",
        copy_served_on_petitioner=True, filing_date="2024-02-01", place="Chennai"),
    "transfer_petition": dict(
        petitioner_name="P", respondents=["Union of India"],
        case_to_transfer="WP 727/2015", from_court="HC Delhi", from_state="Delhi",
        to_court="HC Madras", to_state="Tamil Nadu",
        grounds=["interest of justice"], no_other_transfer_petition=True,
        filing_date="2024-03-01", place="New Delhi"),
    "execution_application": dict(
        decree_holder_name="A", judgment_debtor_name="B",
        execution_court="District Judge", suit_no="CS 150/2015",
        decree_date="2023-12-01", appeal_filed=False, decretal_amount=419200,
        costs_amount=15000, execution_against="B",
        mode_of_assistance="attachment and sale", certified_copy_attached=True,
        filing_date="2024-02-01", place="Chennai"),
    "restitution_conjugal_rights": dict(
        petitioner_name="Ramesh", respondent_name="Lakshmi",
        marriage_date="2018-05-01", marriage_place="Chennai", marriage_registered=True,
        withdrawal_date="2023-06-01", withdrawal_narrative="left home",
        no_collusion=True, no_undue_delay=True, last_resided_together="Chennai",
        jurisdiction_basis="within jurisdiction", filing_date="2024-01-01",
        place="Chennai"),
    "judicial_separation": dict(
        petitioner_name="Ramesh", respondent_name="Lakshmi", marriage_date="2018-05-01",
        marriage_place="Chennai", marriage_registered=True, ground="cruelty",
        ground_narrative="cruelty", no_condonation=True, no_connivance=True,
        no_collusion=True, no_undue_delay=True, last_resided_together="Chennai",
        jurisdiction_basis="within jurisdiction", filing_date="2024-01-01",
        place="Chennai"),
    "succession_grant": dict(
        grant_kind="probate", petitioner_name="Ramesh", deceased_name="Krishnan",
        death_date="2023-04-01", deceased_last_residence="Chennai",
        will_date="2020-01-15", will_duly_executed=True,
        relatives=[dict(relation="Son", name="Ramesh", address="Chennai")],
        petitioner_is_named_executor=True, assets_schedule_ref="Sch-A",
        undertakes_further_court_fee=True, no_impediment=True,
        jurisdiction_basis="fixed abode here", filing_date="2024-01-01",
        place="Chennai"),
    "succession_certificate": dict(
        petitioner_name="Kamala", deceased_name="Krishnan", death_date="2023-04-01",
        deceased_residence="Chennai", law_of_succession="Mitakshara",
        diligent_search_no_will=True, next_of_kin="widow and son",
        petitioner_relation="widow",
        securities=[dict(description="FD No. 1", value=500000)],
        purpose="collect debts", no_impediment_s370=True, no_prior_application=True,
        ad_valorem_duty_paid=True, filing_date="2024-01-01", place="Chennai"),
    "writ_criminal": dict(
        petitioner_name="N", respondents=["Union of India"],
        impugned_order_ref="Detention Order", impugned_order_date="2013-09-10",
        impugned_order_statute="s.3(1) PITNDPS", grounds=["delay"],
        pre_execution_stage=True, no_similar_petition=True, filing_date="2016-05-01",
        place="Chennai"),
    "special_leave_petition": dict(
        slp_kind="civil", petitioner_name="Vasant", respondents=["Digambar"],
        impugned_court="HC Madras", impugned_judgment_date="2015-12-14",
        impugned_case_ref="WP 5427/2004", questions_of_law=["Q"], grounds=["G"],
        no_other_slp=True, annexures_true_copies=True, filing_date="2016-02-01",
        place="New Delhi"),
    "contempt_petition": dict(
        petitioner_names=["X"], respondents=["Union of India"],
        parent_case_ref="WP 2420/2023", order_disobeyed_date="2023-10-01",
        order_nature="status quo", contemnors_had_knowledge=True,
        disobedience_narrative="demolished", contempt_committed_date="2024-01-04",
        filing_date="2024-06-01", place="Chennai"),
    "written_statement": dict(
        plaintiff_name="X", defendant_name="Y", suit_ref="SUIT 100/2024",
        plaint_para_count=3,
        preliminary_objections=[dict(text="barred by limitation")],
        merit_replies=[dict(plaint_para=1, stance="admitted", text="admitted"),
                       dict(plaint_para=2, stance="denied", text="denied"),
                       dict(plaint_para=3, stance="denied", text="denied")],
        filing_date="2024-06-01", place="Chennai"),
    "s106_notice": dict(
        advocate="A", client="Ramesh", recipient_name="Suresh",
        recipient_address="Chennai", property_desc="house No.7", monthly_rent=5000,
        notice_date="2024-01-01", quit_date="2024-01-31",
        damages_rate_note="at Rs.200/day", place="Chennai"),
    "s80_notice": dict(
        advocate="A", client="Kumar", addressee="The Secretary",
        government_body="Govt of TN", plaintiff_name_description="Kumar, employee",
        cause_of_action="illegally dismissed", reliefs=["reinstatement"],
        notice_date="2024-01-01", place="Chennai"),
    "s138_reply": dict(
        advocate="B", client="Suresh", opposing_advocate="A", notice_date="2015-06-09",
        defence_narrative="blank cheque misused", liability_denied=True,
        cheque_in_discharge_denied=True, place="Chennai"),
    "will": dict(
        testator_name="Rajan", testator_parentage="S/o Krishnan",
        testator_address="Chennai", execution_date="2024-01-01",
        bequests=[dict(property_desc="house", beneficiary="wife", relation="wife")],
        sound_mind_declared=True, witnesses=["W1", "W2"], place="Chennai"),
    "power_of_attorney": dict(
        poa_kind="general", executant_name="Co", executant_description="through MD",
        attorney_name="Y", attorney_description="ED",
        powers=["To conduct legal proceedings"], execution_date="2024-01-01",
        witnesses=["W1", "W2"], place="Chennai"),
    "agreement_for_sale": dict(
        vendor_name="A", vendor_description="S/o X", vendee_name="B",
        vendee_description="S/o Y", property_desc="Plot 1", total_consideration=5000000,
        earnest_money=500000, earnest_mode="cheque", completion_months=6,
        execution_date="2024-01-01", witnesses=["W1", "W2"], place="Chennai"),
    "sale_deed": dict(
        vendor_name="A", vendor_description="S/o X", vendee_name="B",
        vendee_description="S/o Y", property_desc="flat", boundary_east="Road",
        boundary_west="Lane", boundary_north="P2", boundary_south="P3",
        total_consideration=2500000, amount_already_paid=2000000,
        balance_paid_mode="cheque", prior_title_recital="prior deed",
        to_be_registered=True, execution_date="2024-01-01",
        witnesses=["W1", "W2"], place="Chennai"),
    "lease_deed": dict(
        lessor_name="L", lessor_description="W/o P", lessee_name="Co",
        lessee_description="through Director", property_desc="basement",
        term_months=24, commencement_date="2024-01-01", monthly_rent=4000,
        security_deposit=36000, notice_months=3, execution_date="2024-01-01",
        witnesses=["W1", "W2"], place="Chennai"),
    "mortgage_deed": dict(
        mortgagor_name="A", mortgagor_description="S/o X", mortgagee_name="Co",
        mortgagee_description="a company", property_desc="plot A-25", principal=200000,
        interest_rate=12, repayment_terms="monthly instalments",
        execution_date="2024-01-01", witnesses=["W1", "W2"], place="Chennai"),
    "partnership_deed": dict(
        firm_name="M/s XYZ",
        partners=[dict(name="X", description="S/o A", share_pct=51),
                  dict(name="Y", description="S/o B", share_pct=49)],
        business_nature="interior decoration", principal_place="Chennai",
        commencement_date="2024-01-01", execution_date="2024-01-01",
        witnesses=["W1", "W2"], place="Chennai"),
    "dissolution_deed": dict(
        firm_name="M/s ABC",
        partners=[dict(name="A", description="S/o X"),
                  dict(name="B", description="S/o Y")],
        original_deed_ref="deed 01-01-2020", dissolution_date="2024-01-01",
        records_custodian="First Party", execution_date="2024-01-01",
        witnesses=["W1", "W2"], place="Chennai"),
    "relinquishment_deed": dict(
        releasors=[dict(name="Avadh", description="D/o X")],
        releasee_name="Ragini", releasee_description="W/o X",
        property_desc="house", deceased_owner="X", releasors_share="4/5th",
        execution_date="2024-01-01", witnesses=["W1", "W2"], place="Chennai"),
    "gift_deed": dict(
        donor_name="XYZ", donor_description="S/o ABC", donee_name="PQR",
        donee_description="S/o XYZ", relation="son", property_desc="house",
        boundary_east="Road", boundary_west="Park", boundary_north="12",
        boundary_south="14", market_value=5000000, possession_delivered=True,
        to_be_registered=True, prior_title_recital="prior deed",
        execution_date="2024-01-01", witnesses=["W1", "W2"], place="Chennai"),
    # TN / Madras court forms set (generalised for any state).
    "vakalatnama": dict(
        kind="efiling", executant_name="Ramesh", party_role="Petitioner",
        advocates=["S. Iyer"], case_ref="O.P. No. 5 of 2026", place="Chennai",
        execution_date="2026-08-01", enrolment_no="MS/1234/2010"),
    "memo_of_appearance": dict(
        counsel_name="A. Menon", party_represented="Respondent", party_name="Suresh",
        case_ref="A.S. No. 3 of 2026", place="Chennai"),
    "coding_sheet": dict(
        side="criminal", petitioner_name="Vijay", respondent_name="State",
        act_and_provision="Article 226", subject_matter="habeas corpus",
        court_place="Chennai", is_hcp=True, detaining_authority="Commissioner of Police",
        crime_no="Cr. 55/2026", police_station="Egmore"),
    "process_application": dict(
        forum="civil", case_ref="O.S. No. 12 of 2026", applicant_name="Anand",
        applicant_role="Plaintiff",
        rows=[dict(nature_of_process="summons to the defendant", on_whom="the defendant",
                   place_of_service="Chennai")],
        place="Chennai"),
    "copy_application": dict(
        forum="city_civil", case_ref="O.S. No. 12 of 2026", applicant_name="Anand",
        applicant_role="Plaintiff",
        documents=[dict(description="the decree", number_of_copies="1")],
        place="Chennai", addressed_to="The Registrar", rule_ref="Rule 43"),
    "call_for_memo": dict(
        court_name="George Town", pincode="600 016", cc_no="125", cc_year="6",
        complainant_name="Anand", accused_name="Balu",
        documents=["the complaint", "the cheque"], court_fee="50", place="Chennai"),
    "batta_witness": dict(
        court_name="City Civil Court", os_no="12", os_year="26",
        plaintiff_name="Anand", defendant_name="Balu", applicant_role="Plaintiff",
        value_of_claim="2,50,000", court_day="15-10-2026",
        rows=[dict(nature_of_process="Summons to witness u/O.16 CPC",
                   person_description="Dr. K. Rao", place_of_service="Egmore",
                   process_fees="50")],
        place="Chennai"),
    "recall_petition": dict(
        court_name="Magistrate First Class Court, Chennai", court_place="Chennai",
        cc_no="C.C. No. 125 of 2026", accused_name="Anand",
        complainant_name="State by S.I. of Police, Egmore", warrant_type="N.B.W.",
        place="Chennai"),
    "process_memo": dict(
        court_name="Judicial Magistrate First Class Court, Chennai",
        court_place="Chennai", case_no="125", case_year="26",
        petitioner_name="Anand", respondent_name="Balu", process_type="summons",
        address_for_service="No. 5, Main Road, Chennai", place="Chennai"),
    "surety_memo": dict(
        court_name="Judicial Magistrate First Class Court, Chennai",
        court_place="Chennai", crime_no="1234", crime_year="26",
        state_name="State of Tamil Nadu", police_inspector="Egmore P.S.",
        accused_name="Anand", place="Chennai"),
    "affidavit_of_surety": dict(
        court_name="Judicial Magistrate First Class Court, Chennai",
        court_place="Chennai", crime_no="1234", crime_year="26",
        state_name="State of Tamil Nadu", police_station="Egmore",
        accused_name="Vijay", offence_sections="s.420 IPC", bail_sum="50,000",
        bail_sum_words="Fifty Thousand", bail_order_date="01-07-2026",
        place="Chennai"),
    "service_of_process_application": dict(
        case_ref="A.S. No. 3 of 2026",
        respondents=[dict(name="Suresh", occupation="trader", district="Chennai")],
        place="Chennai"),
    "affidavit_of_service": dict(
        deponent_name="K. Menon", deponent_role="registered clerk of counsel",
        petitioner_name="Ramesh", respondent_name="Suresh",
        notice_returnable_date="2026-07-15", endorsement="unclaimed",
        case_ref="I.A. No. 5 of 2026", place="Chennai"),
    "substituted_service": dict(
        deponent_name="K. Menon", deponent_role="counsel for the plaintiff",
        petitioner_name="Ramesh", respondent_name="Suresh", prior_service_attempts=3,
        newspaper="The Daily News", case_ref="I.A. No. 6 of 2026", place="Chennai"),
    "bail_bond": dict(
        accused_name="Vijay", offence_section="s.420 IPC", bail_granted=True,
        bail_order_court="the Principal Sessions Court", bail_order_date="2026-07-01",
        forfeiture_sum="50,000",
        sureties=[dict(name="Gopal", address="5 Surety Street", forfeiture_sum="50,000")],
        case_ref="Crl.M.P. No. 88 of 2026", place="Chennai"),
    "surety_affidavit": dict(
        surety_name="Gopal", accused_name="Vijay", offence_section="s.420 IPC",
        bail_granted=True, bail_sum="50,000", id_proofs=["PAN card"],
        case_ref="Crl.M.P. No. 88 of 2026", place="Chennai"),
    "memorandum_furnish_sureties": dict(
        accused_name="Vijay", granting_court="the Principal Sessions Court",
        bail_granted=True, bail_order_ref="Crl.M.P. No. 88 of 2026",
        bail_order_date="2026-07-01", case_ref="C.C. No. 10 of 2026", place="Chennai"),
    "surrender_petition": dict(
        accused_name="Vijay", offence_section="s.420 IPC", crime_no="Cr. 55/2026",
        identification_marks=["mole on left cheek"], case_ref="Crl.M.P. No. 90 of 2026",
        place="Chennai"),
    "s256_condone_absence": dict(
        complainant_name="Ramesh", accused_name="Vijay",
        absence_reason="he is unwell", case_ref="C.C. No. 10 of 2026", place="Chennai"),
    "s317_dispense_presence": dict(
        accused_name="Vijay", complainant_name="Ramesh",
        absence_reason="he is out of station", absence_not_wanton=True,
        case_ref="C.C. No. 10 of 2026", place="Chennai"),
    "recall_warrant": dict(
        accused_name="Vijay", absence_reason="he was hospitalised", warrant_pending=True,
        undertaking_future_appearance=True, case_ref="C.C. No. 10 of 2026",
        place="Chennai"),
    "adjournment_petition": dict(
        petitioner_name="Anand", respondent_name="Balu", posted_for="trial",
        adjournment_reason="counsel is engaged before the High Court",
        case_ref="O.S. No. 12 of 2026", place="Chennai"),
    "urgent_petition": dict(
        petitioner_name="Anand", respondent_name="Balu",
        underlying_application="I.A. for interim injunction",
        orders_prayed="an interim injunction", case_ref="O.S. No. 12 of 2026",
        place="Chennai"),
    "appeal_record_cost_schedule": dict(
        appeal_ref="A.S. No. 3 of 2026", on_behalf_of="the appellant",
        documents=[dict(description="the plaint", pages_translation="5")],
        place="Chennai", court_type="High Court"),
    "summons": dict(
        kind="summary_suit", case_ref="Summary Suit No. 4 of 2026",
        plaintiff_name="Anand", defendant_or_witness_name="Balu", place="Chennai",
        claim_amount="2,50,000", costs="5,000"),
    "court_notice": dict(
        kind="show_cause", case_ref="I.A. No. 1 of 2026",
        applicant_or_petitioner_name="Anand", addressee_name="Balu", place="Chennai",
        application_or_relief="an interim injunction"),
    "court_warrant": dict(
        kind="attach_immovable", case_ref="E.P. No. 2 of 2026",
        decree_holder_or_petitioner_name="Anand", judgment_debtor_or_respondent_name="Balu",
        place="Chennai", decree_or_order_ref="O.S. No. 12 of 2026",
        decree_or_order_date="2026-06-01",
        property_schedule="House and ground at 5 Main Street", addressed_to="The Judgment-Debtor"),
}


def test_every_adapter_has_a_payload():
    registered = {a.doc_type for a in all_adapters()}
    covered = set(PAYLOADS)
    assert registered == covered, (
        f"payload coverage mismatch — missing: {registered - covered}; "
        f"extra: {covered - registered}")


@pytest.mark.parametrize("doc_type", sorted(PAYLOADS))
def test_adapter_roundtrip_builds(doc_type):
    adapter = get_adapter(doc_type)
    kwargs = adapter.coerce(PAYLOADS[doc_type])   # 422 boundary: must not raise
    result = adapter.build(**kwargs)              # engine: must not crash
    assert result.refused is False, (
        f"{doc_type}: valid payload produced a refusal "
        f"({getattr(result.refusal, 'code', '?')})")


@pytest.mark.parametrize("doc_type", sorted(PAYLOADS))
def test_adapter_describe_shape(doc_type):
    d = get_adapter(doc_type).describe()
    assert d["doc_type"] == doc_type
    assert isinstance(d["fields"], list) and d["fields"]
