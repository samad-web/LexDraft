"""Phase-3 coverage pipelines: quash petition, criminal revision, criminal appeal,
civil first appeal, civil revision, Rent Court eviction (TN Act 42 of 2017),
s.5 condone-delay petition, O.VI R.17 amendment, counter affidavit.

Each type: a generated case that renders through its real template (key formal
text pinned), and its hard stops by stable refusal code.
"""

from datetime import date

import pytest

from src.components.render import extract_text, render_to_docx
from src.pipelines import amendment_ia as am
from src.pipelines import civil_first_appeal as cfa
from src.pipelines import civil_revision as cr
from src.pipelines import condone_delay_petition as cd
from src.pipelines import counter_affidavit as ca
from src.pipelines import criminal_appeal as cap
from src.pipelines import criminal_revision as crv
from src.pipelines import hrcp_eviction as he
from src.pipelines import quash_petition as qp


def _text(mod, result, tmp_path):
    assert result.refused is False, result.reason
    ctx = dict(result.context)
    ctx.setdefault("review_banner", "")
    out = render_to_docx(mod.TEMPLATE, ctx, tmp_path / f"{mod.__name__}.docx")
    text = extract_text(out)
    assert "{{" not in text and "{%" not in text
    return text


# --------------------------------------------------------------------------
# quash petition — s.528 BNSS / s.482 CrPC
# --------------------------------------------------------------------------

def _qp(**over):
    kw = dict(
        petitioner_names=["Ravi"], respondent_names=["State rep. by Inspector of Police"],
        target=qp.QuashTarget.FIR, proceeding_ref="Crime No. 45 of 2025",
        proceeding_forum="E4 Police Station, Chennai", sections=["BNS 318(4)"],
        offence_date=date(2025, 1, 10), filing_date=date(2025, 6, 1), place="Chennai",
    )
    kw.update(over)
    # An offence before 1.7.2024 is charged under the IPC (Art. 20(1)); the router
    # refuses BNS sections for it, so old-FIR tests get IPC unless they set sections.
    if "sections" not in over and kw.get("offence_date") and kw["offence_date"] < date(2024, 7, 1):
        kw["sections"] = ["IPC s.420"]
    return kw


def test_quash_generates_under_528_bnss(tmp_path):
    r = qp.build(**_qp())
    assert r.context["section_label"] == "Section 528 BNSS"
    text = _text(qp, r, tmp_path)
    assert "CRL.O.P. No. ______ of 2025" in text
    assert ("filed under Section 528 of the Bharatiya Nagarik Suraksha Sanhita, 2023"
            in text)
    assert "3. FACTS: [to be drafted]" in text
    assert "PRAYER:" in text


def test_quash_fresh_petition_on_old_fir_still_bnss():
    r = qp.build(**_qp(offence_date=date(2023, 5, 1)))
    assert r.context["section_label"] == "Section 528 BNSS"


def test_quash_pending_pre_bnss_proceeding_cites_482_crpc():
    r = qp.build(**_qp(offence_date=date(2023, 5, 1), is_fresh_action=False,
                       proceeding_start_date=date(2024, 3, 1)))
    assert r.context["section_label"] == "Section 482 CrPC"
    assert r.context["section_full"] == (
        "Section 482 of the Code of Criminal Procedure, 1973")


def test_quash_needs_proceeding_identified():
    r = qp.build(**_qp(proceeding_ref="  "))
    assert r.refused and r.refusal.code == "quash_petition_proceeding_not_identified"


def test_quash_needs_sections():
    r = qp.build(**_qp(sections=[]))
    assert r.refused and r.refusal.code == "quash_petition_no_sections"


def test_quash_compromise_needs_complainant_and_memo():
    r = qp.build(**_qp(quash_basis=qp.QuashBasis.COMPROMISE))
    assert r.refused and r.refusal.code == "quash_petition_compromise_complainant_not_party"
    r = qp.build(**_qp(quash_basis=qp.QuashBasis.COMPROMISE,
                       de_facto_complainant_is_respondent=True))
    assert r.refused and r.refusal.code == "quash_petition_compromise_memo_not_annexed"


def test_quash_not_a_second_revision():
    r = qp.build(**_qp(prior_revision_dismissed=True))
    assert r.refused and r.refusal.code == "quash_petition_second_revision_bar"
    assert qp.build(**_qp(prior_revision_dismissed=True,
                          special_circumstances="gross abuse")).refused is False


def test_quash_router_refusal_passes_through():
    r = qp.build(**_qp(offence_date=None))
    assert r.refused and r.refusal.code == "code_framework_offence_date_missing"


# --------------------------------------------------------------------------
# criminal revision — ss.438/442 (HC), ss.438/440 (Sessions)
# --------------------------------------------------------------------------

def _crv(**over):
    kw = dict(
        forum=crv.RevisionForum.HIGH_COURT, petitioner_names=["Ravi"],
        respondent_names=["State"], impugned_order_ref="order dismissing discharge",
        impugned_order_date=date(2025, 5, 1), lower_court="Sessions Judge, Chennai",
        case_ref="S.C. No. 1 of 2025", offence_date=date(2025, 1, 10),
        filing_date=date(2025, 6, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_revision_high_court_generates(tmp_path):
    r = crv.build(**_crv())
    assert r.context["section_label"] == "Sections 438 and 442 BNSS"
    text = _text(crv, r, tmp_path)
    assert "CRL.R.C. No. ______ of 2025" in text
    assert "Article 131 of the Schedule to the Limitation Act, 1963" in text


def test_revision_sessions_labels():
    r = crv.build(**_crv(forum=crv.RevisionForum.SESSIONS))
    assert r.context["section_label"] == "Sections 438 and 440 BNSS"
    assert r.context["case_label"] == "CRL.R.P."


def test_revision_interlocutory_bar():
    r = crv.build(**_crv(impugned_order_is_interlocutory=True))
    assert r.refused and r.refusal.code == "criminal_revision_interlocutory_order"
    assert "438(2) BNSS" in r.reason


def test_revision_other_forum_bar():
    r = crv.build(**_crv(revision_before_other_forum=True))
    assert r.refused and r.refusal.code == "criminal_revision_other_forum_bar"


def test_revision_appeal_lies_bar():
    r = crv.build(**_crv(appeal_lies=True))
    assert r.refused and r.refusal.code == "criminal_revision_appeal_lies"


def test_revision_time_barred_needs_condonation():
    late = _crv(impugned_order_date=date(2025, 1, 1), filing_date=date(2025, 6, 1))
    r = crv.build(**late)
    assert r.refused and r.refusal.code == "criminal_revision_time_barred_no_condonation"
    ok = crv.build(**{**late, "condone_delay_petition_filed": True})
    assert ok.refused is False and ok.context["delay_days"] > 0


def test_revision_copy_time_excluded():
    # 90 days from 1.1.2025 = 1.4.2025; 40 days of copy time push it past 1.5.2025.
    r = crv.build(**_crv(impugned_order_date=date(2025, 1, 1),
                         filing_date=date(2025, 5, 1),
                         copy_applied_date=date(2025, 1, 2),
                         copy_ready_date=date(2025, 2, 11)))
    assert r.refused is False and r.context["in_time"] is True


# --------------------------------------------------------------------------
# criminal appeal — s.415 BNSS
# --------------------------------------------------------------------------

def _cap(**over):
    kw = dict(
        forum=cap.AppealForum.HIGH_COURT, trial_court_level=cap.TrialCourt.SESSIONS,
        appellant_names=["Ravi"], respondent_names=["State"],
        trial_case_ref="S.C. No. 12 of 2024", trial_court="Sessions Judge, Chennai",
        judgment_date=date(2025, 5, 1), convicted_sections=["BNS 109"],
        sentence_text="rigorous imprisonment for 10 years", max_sentence_years=10,
        offence_date=date(2024, 8, 1), filing_date=date(2025, 6, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_appeal_high_court_generates(tmp_path):
    r = cap.build(**_cap())
    assert r.context["section_label"] == "Section 415(2) BNSS"
    assert r.context["suspension_section"] == "Section 430 BNSS"
    text = _text(cap, r, tmp_path)
    assert "CRL.A. No. ______ of 2025" in text
    assert "Art. 115(b)(i)" in text


def test_appeal_magistrate_conviction_goes_to_sessions():
    r = cap.build(**_cap(trial_court_level=cap.TrialCourt.MAGISTRATE,
                         max_sentence_years=2))
    assert r.refused and r.refusal.code == "criminal_appeal_wrong_forum_sessions"
    ok = cap.build(**_cap(forum=cap.AppealForum.SESSIONS,
                          trial_court_level=cap.TrialCourt.MAGISTRATE,
                          max_sentence_years=2, filing_date=date(2025, 5, 25)))
    assert ok.refused is False
    assert ok.context["section_label"] == "Section 415(3) BNSS"
    assert ok.context["limitation_article"] == "Art. 115(b)(ii)"   # 30 days


def test_appeal_to_sessions_has_thirty_days():
    r = cap.build(**_cap(forum=cap.AppealForum.SESSIONS,
                         trial_court_level=cap.TrialCourt.MAGISTRATE,
                         max_sentence_years=2))   # 1.5.2025 -> 31.5.2025; filed 1.6
    assert r.refused and r.refusal.code == "criminal_appeal_time_barred_no_condonation"


def test_appeal_sessions_trial_cannot_go_to_sessions():
    r = cap.build(**_cap(forum=cap.AppealForum.SESSIONS))
    assert r.refused and r.refusal.code == "criminal_appeal_wrong_forum_high_court"


def test_appeal_plea_of_guilty():
    r = cap.build(**_cap(pleaded_guilty=True))
    assert r.refused and r.refusal.code == "criminal_appeal_plea_of_guilty"
    assert cap.build(**_cap(pleaded_guilty=True,
                            appeal_limited_to_sentence=True)).refused is False


def test_appeal_time_barred():
    # 60 days to the High Court from 1.1.2025 -> 2.3.2025.
    r = cap.build(**_cap(judgment_date=date(2025, 1, 1), filing_date=date(2025, 3, 10)))
    assert r.refused and r.refusal.code == "criminal_appeal_time_barred_no_condonation"


# --------------------------------------------------------------------------
# civil first appeal — s.96 + O.XLI
# --------------------------------------------------------------------------

def _cfa(**over):
    kw = dict(
        forum=cfa.AppellateForum.DISTRICT_COURT, appellant_names=["Ramesh"],
        respondent_names=["Suresh"], appellant_trial_role="defendant",
        suit_ref="O.S. No. 100 of 2022", trial_court="District Munsif Court, Tambaram",
        decree_date=date(2025, 5, 1), filing_date=date(2025, 5, 20), place="Chennai",
        grounds_list=["The trial court erred in rejecting Ex.B1.",
                      "The suit is barred by limitation."],
    )
    kw.update(over)
    return kw


def test_first_appeal_generates_with_code_lettered_grounds(tmp_path):
    text = _text(cfa, cfa.build(**_cfa()), tmp_path)
    assert "A.S. No. ______ of 2025" in text
    assert "SECTION 96 READ WITH ORDER XLI RULE 1" in text
    assert "   A. The trial court erred in rejecting Ex.B1." in text
    assert "   B. The suit is barred by limitation." in text
    assert "IN THE COURT OF THE PRINCIPAL DISTRICT JUDGE" in text


def test_first_appeal_consent_decree_bar():
    r = cfa.build(**_cfa(is_consent_decree=True))
    assert r.refused and r.refusal.code == "civil_first_appeal_consent_decree"


def test_first_appeal_late_needs_o41_r3a():
    r = cfa.build(**_cfa(decree_date=date(2025, 1, 1)))
    assert r.refused and r.refusal.code == "civil_first_appeal_time_barred_no_o41r3a"
    ok = cfa.build(**_cfa(decree_date=date(2025, 1, 1),
                          condone_delay_application_filed=True))
    assert ok.refused is False and ok.context["delay_days"] > 0


def test_first_appeal_high_court_gets_ninety_days():
    r = cfa.build(**_cfa(forum=cfa.AppellateForum.HIGH_COURT,
                         decree_date=date(2025, 3, 1), filing_date=date(2025, 5, 20)))
    assert r.refused is False and r.context["limitation_article"] == "Art. 116(a)"


# --------------------------------------------------------------------------
# civil revision — s.115 CPC / Art.227
# --------------------------------------------------------------------------

def _cr(**over):
    kw = dict(
        basis=cr.RevisionBasis.S115, petitioner_names=["Ramesh"],
        respondent_names=["Suresh"], impugned_order_ref="order in I.A. No. 5 of 2025",
        impugned_order_date=date(2025, 5, 1), lower_court="District Munsif, Tambaram",
        proceeding_ref="O.S. No. 100 of 2022", filing_date=date(2025, 6, 1),
        place="Chennai", order_would_finally_dispose=True,
    )
    kw.update(over)
    return kw


def test_civil_revision_s115_generates(tmp_path):
    # Madras numbering follows the basis: s.115 CPC -> C.R.P.(NPD), even when the
    # inbound category says otherwise (Art.227 -> C.R.P.(PD)).
    text = _text(cr, cr.build(**_cr(crp_category="PD")), tmp_path)
    assert "C.R.P.(NPD) No. ______ of 2025" in text
    assert "SECTION 115 OF THE CODE OF CIVIL PROCEDURE, 1908" in text


def test_civil_revision_appeal_lies_bar():
    r = cr.build(**_cr(appeal_lies=True))
    assert r.refused and r.refusal.code == "civil_revision_appeal_lies"


def test_civil_revision_s115_proviso_routes_to_227():
    r = cr.build(**_cr(order_would_finally_dispose=False))
    assert r.refused and r.refusal.code == "civil_revision_s115_proviso_bar"
    ok = cr.build(**_cr(basis=cr.RevisionBasis.ART227, order_would_finally_dispose=False))
    assert ok.refused is False


def test_civil_revision_art227_stale_needs_explanation():
    r = cr.build(**_cr(basis=cr.RevisionBasis.ART227,
                       impugned_order_date=date(2024, 6, 1)))
    assert r.refused and r.refusal.code == "civil_revision_art227_delay_unexplained"


# --------------------------------------------------------------------------
# Rent Court eviction — TN Act 42 of 2017, s.21(2)
# --------------------------------------------------------------------------

def _he(**over):
    kw = dict(
        landlord_names=["Lakshmi"], tenant_names=["Kumar"],
        premises_description="Door No. 12, North Street, Mylapore, Chennai",
        monthly_rent=15000, grounds=["arrears_of_rent"], arrears_months=3,
        demand_notice_served_date=date(2025, 4, 1), filing_date=date(2025, 6, 1),
        place="Chennai",
    )
    kw.update(over)
    return kw


def test_eviction_generates(tmp_path):
    text = _text(he, he.build(**_he()), tmp_path)
    assert "R.L.T.O.P. No. ______ of 2025" in text
    assert "Clause (b):" in text
    assert "SECTION 21(2) OF THE TAMIL NADU REGULATION OF RIGHTS" in text


def test_eviction_own_occupation_pleaded_by_its_words(tmp_path):
    # r13 decision: no clause letter / verify note for the ground TN Act 19 of 2022 touched.
    text = _text(he, he.build(**_he(grounds=["own_occupation"])), tmp_path)
    assert "Own occupation: the premises are required by the landlord for his own occupation" in text
    assert "[verify: clause (g)" not in text and "clause (g)" not in text


def test_eviction_needs_a_known_ground():
    assert he.build(**_he(grounds=[])).refusal.code == "hrcp_eviction_no_ground"
    assert he.build(**_he(grounds=["bona_fide"])).refusal.code == "hrcp_eviction_unknown_ground"


def test_eviction_arrears_demand_month_must_elapse():
    r = he.build(**_he(filing_date=date(2025, 4, 20)))
    assert r.refused and r.refusal.code == "hrcp_eviction_demand_period_not_elapsed"
    r = he.build(**_he(demand_notice_served_date=None))
    assert r.refused and r.refusal.code == "hrcp_eviction_no_demand_notice"
    r = he.build(**_he(arrears_months=1))
    assert r.refused and r.refusal.code == "hrcp_eviction_arrears_below_two_months"


def test_eviction_ground_a_unavailable_with_written_agreement():
    r = he.build(**_he(grounds=["no_written_agreement"], written_tenancy_agreement=True))
    assert r.refused and r.refusal.code == "hrcp_eviction_agreement_exists"


# --------------------------------------------------------------------------
# condone-delay petition — s.5 Limitation Act
# --------------------------------------------------------------------------

def _cd(**over):
    kw = dict(
        main_proceeding=cd.MainProceeding.APPEAL, main_proceeding_desc="A.S. No. __ of 2025",
        petitioner_name="Ramesh", respondent_names=["Suresh"],
        court_name="THE PRINCIPAL DISTRICT JUDGE, CHENGALPATTU",
        impugned_order_ref="decree in O.S. No. 100 of 2022",
        impugned_order_date=date(2025, 1, 1), period_days=30,
        filing_date=date(2025, 3, 1), sufficient_cause="the appellant was hospitalised",
        place="Chennai",
    )
    kw.update(over)
    return kw


def test_condone_delay_computes_the_delay(tmp_path):
    r = cd.build(**_cd())
    assert r.context["limitation_expiry"] == "2025-01-31"
    assert r.context["delay_days"] == 29
    text = _text(cd, r, tmp_path)
    assert "CONDONE THE DELAY OF 29 DAYS" in text


def test_condone_delay_not_for_suits_or_order_xxi():
    assert cd.build(**_cd(main_proceeding=cd.MainProceeding.SUIT)).refusal.code == \
        "condone_delay_petition_suit"
    assert cd.build(**_cd(is_order_xxi_application=True)).refusal.code == \
        "condone_delay_petition_order_xxi"


def test_condone_delay_refuses_when_in_time():
    r = cd.build(**_cd(filing_date=date(2025, 1, 20)))
    assert r.refused and r.refusal.code == "condone_delay_petition_no_delay"


def test_condone_delay_needs_cause():
    r = cd.build(**_cd(sufficient_cause=" "))
    assert r.refused and r.refusal.code == "condone_delay_petition_no_cause"


# --------------------------------------------------------------------------
# amendment IA — O.VI R.17
# --------------------------------------------------------------------------

def _am(**over):
    kw = dict(
        applicant_name="Ramesh", applicant_role="plaintiff", respondent_name="Suresh",
        suit_ref="O.S. No. 100 of 2022", pleading=am.Pleading.PLAINT,
        proposed_amendments=["Insert para 7A after para 7: ..."],
        trial_commenced=False, filing_date=date(2025, 6, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_amendment_generates(tmp_path):
    text = _text(am, am.build(**_am()), tmp_path)
    assert "ORDER VI RULE 17 READ WITH SECTION 151" in text
    assert "   (1) Insert para 7A after para 7: ..." in text


def test_amendment_needs_proposed_text():
    r = am.build(**_am(proposed_amendments=[]))
    assert r.refused and r.refusal.code == "amendment_ia_no_proposed_amendment"


def test_amendment_after_trial_needs_due_diligence():
    r = am.build(**_am(trial_commenced=True))
    assert r.refused and r.refusal.code == "amendment_ia_due_diligence_not_pleaded"
    assert am.build(**_am(trial_commenced=True,
                          due_diligence_explanation="document traced only on 1.5.2025")
                    ).refused is False


# --------------------------------------------------------------------------
# counter affidavit — para-wise reply
# --------------------------------------------------------------------------

def _ca(**over):
    kw = dict(
        petition_ref="W.P. No. 100 of 2025", petitioner_names=["Ravi"],
        respondent_names=["State of Tamil Nadu", "District Collector"],
        answering_respondent_serial=2, deponent_name="K. Mohan",
        deponent_description="son of Kannan, aged 50 years",
        petition_para_count=3,
        para_replies=[ca.ParaReply(1, ca.Stance.ADMITTED),
                      ca.ParaReply(2, ca.Stance.DENIED, "The order was served."),
                      ca.ParaReply(3, ca.Stance.NOT_ADMITTED)],
        affirm_date=date(2025, 6, 1), place="Chennai",
    )
    kw.update(over)
    return kw


def test_counter_generates(tmp_path):
    text = _text(ca, ca.build(**_ca()), tmp_path)
    assert "COUNTER AFFIDAVIT FILED ON BEHALF OF THE 2ND RESPONDENT" in text
    assert "PARA-WISE REPLY:" in text
    assert "2. The averments in paragraph 2 are denied. The order was served." in text
    assert "3. The averments in paragraph 3 are not admitted" in text


def test_counter_every_paragraph_must_be_answered():
    r = ca.build(**_ca(petition_para_count=4))
    assert r.refused and r.refusal.code == "counter_affidavit_uncovered_paragraphs"
    assert "4" in r.reason


def test_counter_reply_out_of_range():
    r = ca.build(**_ca(para_replies=[ca.ParaReply(9, ca.Stance.DENIED)]))
    assert r.refused and r.refusal.code == "counter_affidavit_reply_out_of_range"


def test_counter_needs_deponent():
    r = ca.build(**_ca(deponent_description=""))
    assert r.refused and r.refusal.code == "counter_affidavit_deponent_not_identified"


@pytest.mark.parametrize("mod", [qp, crv, cap, cfa, cr, he, cd, am, ca])
def test_every_refusal_is_coded_hard(mod):
    """Spot-check: the module's _refuse helper always attaches a coded HARD
    refusal naming the pipeline."""
    r = mod._refuse("x", code=f"{mod.__name__.rsplit('.', 1)[-1]}_probe", fields=("f",))
    assert r.refused and r.refusal.code.endswith("_probe")
    assert r.refusal.pipeline == mod.__name__.rsplit(".", 1)[-1]
