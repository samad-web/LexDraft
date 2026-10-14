"""Refusal-path tests for the Batch-3 pleadings (new-from-DPC-book pipelines).

The golden tests pin the happy-path structure; these pin the hard-stops — the
legal guards that make a document refuse rather than generate a defective pleading.
Each test drives one pipeline into a specific refusal and asserts its stable code.
"""

from datetime import date

import pytest

from src.pipelines import permanent_injunction as pi
from src.pipelines import specific_performance as sp
from src.pipelines import ejectment as ej
from src.pipelines import indigent_application as ia
from src.pipelines import o39_r2a_application as o39
from src.pipelines import caveat as cv
from src.pipelines import transfer_petition as tp
from src.pipelines import execution_application as ex
from src.pipelines import restitution_conjugal_rights as rcr
from src.pipelines import judicial_separation as js
from src.pipelines import succession_grant as sg
from src.pipelines import succession_certificate as sc
from src.pipelines import writ_criminal as wc
from src.pipelines import special_leave_petition as slp
from src.pipelines import contempt_petition as cp


# --------------------------------------------------------------------------
# permanent injunction
# --------------------------------------------------------------------------

def _pi(**over):
    kw = dict(
        plaintiff_name="P", defendant_names=["D"],
        suit_property="the premises at Chennai",
        possession_basis="tenant in settled possession",
        act_restrained="dispossessing the plaintiff from the premises",
        threat_narrative="",
        cause_of_action_date=date(2024, 3, 1), cause_of_action_place="Chennai",
        court_fee=200, valuation="Rs. 2,00,000/-",
        jurisdiction_basis="property within jurisdiction",
        filing_date=date(2024, 5, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_permanent_injunction_needs_possession():
    r = pi.build(**_pi(possession_basis="  "))
    assert r.refused and r.refusal.code == "permanent_injunction_possession_not_pleaded"


def test_permanent_injunction_vague_prayer():
    r = pi.build(**_pi(act_restrained="interfere"))
    assert r.refused and r.refusal.code == "permanent_injunction_vague_prayer"


def test_permanent_injunction_ok():
    assert pi.build(**_pi()).refused is False


# --------------------------------------------------------------------------
# specific performance — s.16(c) readiness, consideration arithmetic
# --------------------------------------------------------------------------

def _sp(**over):
    kw = dict(
        plaintiff_name="P", defendant_name="D", suit_property="Plot 1",
        agreement_date=date(2023, 6, 1), agreement_ref="agt 01-06-2023",
        total_consideration=5000000, earnest_paid=1000000, balance_amount=4000000,
        readiness_and_willingness=True, refusal_narrative="",
        notice_ref="notice", cause_of_action_date=date(2023, 9, 1),
        cause_of_action_place="Chennai", court_fee=50000,
        filing_date=date(2024, 2, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_specific_performance_needs_agreement():
    r = sp.build(**_sp(agreement_date=None))
    assert r.refused and r.refusal.code == "specific_performance_agreement_not_pleaded"


def test_specific_performance_needs_readiness():
    r = sp.build(**_sp(readiness_and_willingness=False))
    assert r.refused and r.refusal.code == "specific_performance_readiness_not_pleaded"


def test_specific_performance_consideration_must_reconcile():
    r = sp.build(**_sp(balance_amount=3000000))
    assert r.refused and r.refusal.code == "specific_performance_consideration_mismatch"


def test_specific_performance_ok():
    assert sp.build(**_sp()).refused is False


# --------------------------------------------------------------------------
# ejectment — s.106 notice + clear-15-days
# --------------------------------------------------------------------------

def _ej(**over):
    kw = dict(
        plaintiff_names=["P"], defendant_name="D", suit_premises="Flat 7",
        lease_ref="lease", lease_expiry_date=date(2023, 3, 31),
        s106_notice_ref="notice", s106_notice_served_date=date(2023, 11, 25),
        tenancy_end_date=date(2023, 12, 31), damages_rate_per_day=1000,
        wrongful_occupation_since=date(2024, 1, 1), annual_rent=81696,
        court_fee=6000, cause_of_action_date=date(2024, 1, 1),
        cause_of_action_place="Chennai", jurisdiction_basis="within jurisdiction",
        filing_date=date(2024, 3, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_ejectment_needs_s106_notice():
    r = ej.build(**_ej(s106_notice_ref="  "))
    assert r.refused and r.refusal.code == "ejectment_s106_notice_missing"


def test_ejectment_short_notice_refused():
    # served 25 Nov, tenancy ends 5 Dec -> only 10 clear days (< 15)
    r = ej.build(**_ej(tenancy_end_date=date(2023, 12, 5)))
    assert r.refused and r.refusal.code == "ejectment_s106_notice_short"


def test_ejectment_ok():
    assert ej.build(**_ej()).refused is False


# --------------------------------------------------------------------------
# indigent
# --------------------------------------------------------------------------

def _ia(**over):
    kw = dict(
        applicant_name="A", respondent_name="R", suit_ref="the suit",
        indigency_pleaded=True, indigency_particulars="no property, no income",
        undertakes_to_pay_if_decreed=True, filing_date=date(2024, 4, 1),
        place="Chennai",
    )
    kw.update(over)
    return kw


def test_indigent_needs_indigency():
    r = ia.build(**_ia(indigency_pleaded=False))
    assert r.refused and r.refusal.code == "indigent_indigency_not_pleaded"


def test_indigent_needs_undertaking():
    r = ia.build(**_ia(undertakes_to_pay_if_decreed=False))
    assert r.refused and r.refusal.code == "indigent_undertaking_missing"


def test_indigent_ok():
    assert ia.build(**_ia()).refused is False


# --------------------------------------------------------------------------
# O39 R2-A — order + knowledge
# --------------------------------------------------------------------------

def _o39(**over):
    kw = dict(
        applicant_name="A", respondent_name="R", suit_ref="O.S. 200/2023",
        injunction_order_date=date(2023, 8, 1), respondent_had_knowledge=True,
        disobedience_narrative="took forcible possession", disobedience_date=None,
        property_list_attached=True, filing_date=date(2024, 2, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_o39_needs_order():
    r = o39.build(**_o39(injunction_order_date=None))
    assert r.refused and r.refusal.code == "o39_r2a_injunction_order_not_identified"


def test_o39_needs_knowledge():
    r = o39.build(**_o39(respondent_had_knowledge=False))
    assert r.refused and r.refusal.code == "o39_r2a_knowledge_not_pleaded"


def test_o39_ok():
    assert o39.build(**_o39()).refused is False


# --------------------------------------------------------------------------
# caveat — s.148-A(2) service
# --------------------------------------------------------------------------

def _cv(**over):
    kw = dict(
        caveator_name="C", expected_petitioner_name="X",
        impugned_order_ref="order in Suit 100/2023",
        impugned_order_date=date(2024, 1, 10), lower_court="Civil Judge",
        apprehended_proceeding="CM(M) under Art.227",
        copy_served_on_petitioner=True, filing_date=date(2024, 2, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_caveat_needs_order():
    r = cv.build(**_cv(impugned_order_date=None))
    assert r.refused and r.refusal.code == "caveat_impugned_order_not_identified"


def test_caveat_needs_service():
    r = cv.build(**_cv(copy_served_on_petitioner=False))
    assert r.refused and r.refusal.code == "caveat_copy_not_served"


def test_caveat_ok():
    assert cv.build(**_cv()).refused is False


# --------------------------------------------------------------------------
# transfer petition — inter-State requirement (s.25 vs s.24)
# --------------------------------------------------------------------------

def _tp(**over):
    kw = dict(
        petitioner_name="P", respondents=["R"], case_to_transfer="WP 727/2015",
        from_court="HC Delhi", from_state="Delhi", to_court="HC Madras",
        to_state="Tamil Nadu", brief_facts="", grounds=["interest of justice"],
        no_other_transfer_petition=True, filing_date=date(2024, 3, 1),
        place="New Delhi",
    )
    kw.update(over)
    return kw


def test_transfer_needs_both_courts():
    r = tp.build(**_tp(to_court="  "))
    assert r.refused and r.refusal.code == "transfer_petition_courts_not_identified"


def test_transfer_must_be_inter_state():
    r = tp.build(**_tp(to_state="Delhi"))
    assert r.refused and r.refusal.code == "transfer_petition_not_inter_state"


def test_transfer_needs_grounds():
    r = tp.build(**_tp(grounds=[]))
    assert r.refused and r.refusal.code == "transfer_petition_no_grounds"


def test_transfer_ok():
    assert tp.build(**_tp()).refused is False


# --------------------------------------------------------------------------
# execution — decree + mode + certified copy
# --------------------------------------------------------------------------

def _ex(**over):
    kw = dict(
        decree_holder_name="A", judgment_debtor_name="B",
        execution_court="District Judge", suit_no="CS 150/2015",
        decree_date=date(2023, 12, 1), appeal_filed=False, payment_received="Nil",
        prior_applications="Nil", decretal_amount=419200,
        interest_note="with interest", costs_amount=15000,
        execution_against="B", mode_of_assistance="attachment and sale",
        certified_copy_attached=True, filing_date=date(2024, 2, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_execution_needs_decree():
    r = ex.build(**_ex(decree_date=None))
    assert r.refused and r.refusal.code == "execution_decree_not_identified"


def test_execution_needs_mode():
    r = ex.build(**_ex(mode_of_assistance="  "))
    assert r.refused and r.refusal.code == "execution_mode_not_stated"


def test_execution_needs_certified_copy():
    r = ex.build(**_ex(certified_copy_attached=False))
    assert r.refused and r.refusal.code == "execution_certified_copy_missing"


def test_execution_ok():
    assert ex.build(**_ex()).refused is False


# --------------------------------------------------------------------------
# restitution of conjugal rights
# --------------------------------------------------------------------------

def _rcr(**over):
    kw = dict(
        petitioner_name="P", respondent_name="R", marriage_date=date(2018, 5, 1),
        marriage_place="Chennai", marriage_registered=True,
        withdrawal_date=date(2023, 6, 1), withdrawal_narrative="left home",
        no_collusion=True, no_undue_delay=True, last_resided_together="Chennai",
        jurisdiction_basis="within jurisdiction", filing_date=date(2024, 1, 1),
        place="Chennai",
    )
    kw.update(over)
    return kw


def test_rcr_needs_marriage():
    r = rcr.build(**_rcr(marriage_date=None))
    assert r.refused and r.refusal.code == "rcr_marriage_not_pleaded"


def test_rcr_needs_withdrawal():
    r = rcr.build(**_rcr(withdrawal_date=None))
    assert r.refused and r.refusal.code == "rcr_withdrawal_not_pleaded"


def test_rcr_needs_no_collusion():
    r = rcr.build(**_rcr(no_collusion=False))
    assert r.refused and r.refusal.code == "rcr_collusion_not_negatived"


def test_rcr_ok():
    assert rcr.build(**_rcr()).refused is False


# --------------------------------------------------------------------------
# judicial separation — ground-specific bars
# --------------------------------------------------------------------------

def _js(**over):
    kw = dict(
        petitioner_name="P", respondent_name="R", marriage_date=date(2018, 5, 1),
        marriage_place="Chennai", marriage_registered=True,
        ground=js.Ground.CRUELTY, ground_narrative="cruelty instances",
        no_condonation=True, no_connivance=True, no_collusion=True,
        no_undue_delay=True, last_resided_together="Chennai",
        jurisdiction_basis="within jurisdiction", filing_date=date(2024, 1, 1),
        place="Chennai",
    )
    kw.update(over)
    return kw


def test_js_needs_ground():
    r = js.build(**_js(ground_narrative="  "))
    assert r.refused and r.refusal.code == "judicial_separation_no_ground"


def test_js_cruelty_needs_non_condonation():
    r = js.build(**_js(no_condonation=False))
    assert (r.refused and
            r.refusal.code == "judicial_separation_cruelty_condonation_not_negatived")


def test_js_adultery_needs_bars():
    r = js.build(**_js(ground=js.Ground.ADULTERY, no_connivance=False))
    assert (r.refused and
            r.refusal.code == "judicial_separation_adultery_bars_not_negatived")


def test_js_ok():
    assert js.build(**_js()).refused is False


# --------------------------------------------------------------------------
# succession grant — probate/LoA standing, will, citation
# --------------------------------------------------------------------------

def _sg(**over):
    kw = dict(
        grant_kind=sg.GrantKind.PROBATE, petitioner_name="P", deceased_name="D",
        death_date=date(2023, 4, 1), deceased_last_residence="Chennai",
        will_date=date(2020, 1, 15), will_duly_executed=True,
        bequest_narrative="house to son",
        relatives=[sg.Relative("Son", "P", "Chennai")],
        petitioner_is_named_executor=True, petitioner_standing="",
        assets_schedule_ref="Sch-A", undertakes_further_court_fee=True,
        no_impediment=True, jurisdiction_basis="within jurisdiction",
        filing_date=date(2024, 1, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_sg_needs_death():
    r = sg.build(**_sg(death_date=None))
    assert r.refused and r.refusal.code == "succession_grant_death_not_pleaded"


def test_sg_needs_will_execution():
    r = sg.build(**_sg(will_duly_executed=False))
    assert (r.refused and
            r.refusal.code == "succession_grant_will_execution_not_pleaded")


def test_sg_probate_needs_executor():
    r = sg.build(**_sg(petitioner_is_named_executor=False))
    assert (r.refused and
            r.refusal.code == "succession_grant_probate_petitioner_not_executor")


def test_sg_needs_relatives_cited():
    r = sg.build(**_sg(relatives=[]))
    assert r.refused and r.refusal.code == "succession_grant_relatives_not_listed"


def test_sg_loa_needs_standing():
    r = sg.build(**_sg(grant_kind=sg.GrantKind.LETTERS_OF_ADMINISTRATION,
                       petitioner_is_named_executor=False, petitioner_standing=""))
    assert (r.refused and
            r.refusal.code == "succession_grant_loa_standing_not_pleaded")


def test_sg_probate_ok():
    assert sg.build(**_sg()).refused is False


# --------------------------------------------------------------------------
# succession certificate — intestacy, Schedule I, s.370, duty
# --------------------------------------------------------------------------

def _sc(**over):
    kw = dict(
        petitioner_name="P", deceased_name="D", death_date=date(2023, 4, 1),
        deceased_residence="Chennai", law_of_succession="Mitakshara",
        diligent_search_no_will=True, next_of_kin="widow and son",
        petitioner_relation="widow",
        securities=[sc.Security("FD No. 1", 500000)],
        purpose="collect debts", no_impediment_s370=True,
        no_prior_application=True, ad_valorem_duty_paid=True,
        filing_date=date(2024, 1, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_sc_needs_intestacy():
    r = sc.build(**_sc(diligent_search_no_will=False))
    assert (r.refused and
            r.refusal.code == "succession_certificate_intestacy_not_pleaded")


def test_sc_needs_securities():
    r = sc.build(**_sc(securities=[]))
    assert r.refused and r.refusal.code == "succession_certificate_no_securities"


def test_sc_needs_duty_paid():
    r = sc.build(**_sc(ad_valorem_duty_paid=False))
    assert r.refused and r.refusal.code == "succession_certificate_duty_not_paid"


def test_sc_ok():
    assert sc.build(**_sc()).refused is False


# --------------------------------------------------------------------------
# writ criminal
# --------------------------------------------------------------------------

def _wc(**over):
    kw = dict(
        petitioner_name="P", respondents=["Union of India"],
        impugned_order_ref="Detention Order", impugned_order_date=date(2013, 9, 10),
        impugned_order_statute="s.3(1) PITNDPS", facts_narrative="",
        grounds=["delay in execution"], pre_execution_stage=True,
        no_similar_petition=True, filing_date=date(2016, 5, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_wc_needs_order():
    r = wc.build(**_wc(impugned_order_date=None))
    assert r.refused and r.refusal.code == "writ_criminal_impugned_order_not_identified"


def test_wc_needs_no_similar_petition():
    r = wc.build(**_wc(no_similar_petition=False))
    assert (r.refused and
            r.refusal.code == "writ_criminal_no_similar_petition_declaration_missing")


def test_wc_ok():
    assert wc.build(**_wc()).refused is False


# --------------------------------------------------------------------------
# SLP — 90-day limitation (condonation auto-attach, not refuse) + declarations
# --------------------------------------------------------------------------

def _slp(**over):
    kw = dict(
        slp_kind=slp.SLPKind.CIVIL, petitioner_name="P", respondents=["R"],
        impugned_court="HC Madras", impugned_judgment_date=date(2015, 12, 14),
        impugned_case_ref="WP 5427/2004", questions_of_law=["Q"], grounds=["G"],
        no_other_slp=True, annexures_true_copies=True,
        filing_date=date(2016, 2, 1), brief_facts="", interim_relief_sought="",
        place="New Delhi",
    )
    kw.update(over)
    return kw


def test_slp_needs_impugned_judgment():
    r = slp.build(**_slp(impugned_judgment_date=None))
    assert r.refused and r.refusal.code == "slp_impugned_judgment_not_identified"


def test_slp_needs_declaration():
    r = slp.build(**_slp(no_other_slp=False))
    assert r.refused and r.refusal.code == "slp_no_other_slp_declaration_missing"


def test_slp_within_90_days_no_condonation():
    # judgment 14 Dec 2015, filed 1 Feb 2016 -> ~49 days, within 90
    r = slp.build(**_slp())
    assert r.refused is False and r.context["condonation_required"] is False


def test_slp_beyond_90_days_auto_condonation_not_refused():
    # judgment 1 Jan 2015, filed 1 Feb 2016 -> far beyond 90 days
    r = slp.build(**_slp(impugned_judgment_date=date(2015, 1, 1)))
    assert r.refused is False and r.context["condonation_required"] is True


# --------------------------------------------------------------------------
# contempt — s.20 one-year absolute bar
# --------------------------------------------------------------------------

def _cp(**over):
    kw = dict(
        petitioner_names=["X"], respondents=["R"], parent_case_ref="WP 1/2020",
        order_disobeyed_date=date(2023, 10, 1), order_nature="status quo",
        contemnors_had_knowledge=True, disobedience_narrative="demolished",
        contempt_committed_date=date(2024, 1, 4), filing_date=date(2024, 6, 1),
        place="Chennai",
    )
    kw.update(over)
    return kw


def test_contempt_needs_order():
    r = cp.build(**_cp(order_disobeyed_date=None))
    assert r.refused and r.refusal.code == "contempt_order_not_identified"


def test_contempt_needs_knowledge():
    r = cp.build(**_cp(contemnors_had_knowledge=False))
    assert r.refused and r.refusal.code == "contempt_knowledge_not_pleaded"


def test_contempt_within_one_year_ok():
    assert cp.build(**_cp()).refused is False


def test_contempt_beyond_one_year_barred():
    # committed 1 Jan 2022, filed 1 Jun 2024 -> > 1 year, absolute s.20 bar
    r = cp.build(**_cp(contempt_committed_date=date(2022, 1, 1)))
    assert r.refused and r.refusal.code == "contempt_barred_by_s20_one_year"
