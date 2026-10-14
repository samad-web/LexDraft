"""Tests for src.pipelines.s138_complaint — s.138 complaint (spec 3.1).

Inherits 2.2's cheque/debt facts and adds:
  - s.141 HARD REFUSAL: a company accused without the "in charge of and
    responsible for the conduct of the business at the relevant time" averment
    gets NO document. Directors are routinely discharged on exactly this defect.
  - Deemed service: refused/unclaimed notice requires an explicit deemed-service
    averment, and the cause-of-action date STILL runs from deemed delivery — a
    refused/unclaimed flag must not silently skip the date computation.
  - Filing window = one calendar month from cause of action (reuses
    s138_windows). Exceeded -> auto-attach the s.142(b)-proviso condonation
    application (does not refuse; attaches).
  - Paragraph 3 shares the legally-enforceable-debt slot with 2.2 paragraph 2.

Complainant-is-payee and jurisdiction are asserted as mandatory averments.
"""

from datetime import date

import pytest

from src.pipelines import s138_complaint as complaint
from src.pipelines.s138_complaint import PresentationRound
from src.pipelines.s138_notice import Cheque


def _base(**over):
    kw = dict(
        complainant_name="Ramesh", complainant_is_company=False,
        complainant_authorised_rep=None, complainant_resolution_ref=None,
        is_payee=True,
        accused_name="Suresh", accused_is_company=False,
        s141_averment=None,
        cheques=[Cheque(number="000123", date=date(2024, 1, 1), amount=100000,
                        bank="SBI", branch="Mylapore", drawer="Suresh",
                        payee="Ramesh")],
        debt_slot="",  # shared legally-enforceable-debt LLM slot (para 3)
        presentation_date=date(2024, 1, 10),
        memo_date=date(2024, 1, 12), memo_received_date=date(2024, 1, 15),
        dishonour_reason="Funds insufficient",
        notice_date=date(2024, 1, 18),
        notice_dispatch_date=date(2024, 1, 18),
        notice_delivery_date=date(2024, 1, 20),
        notice_refused=False, notice_unclaimed=False,
        filing_date=date(2024, 2, 20),
        payee_bank_branch_in_jurisdiction=True,
        jurisdiction_basis="the payee's bank branch is situated within this court's "
                           "territorial jurisdiction (s.142(2) NI Act)",
        place="Chennai",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# s.141 — HARD REFUSAL for company accused without the averment.
# --------------------------------------------------------------------------

class TestSection141HardRefusal:
    def test_company_accused_without_s141_refused(self):
        result = complaint.build(**_base(
            accused_is_company=True, s141_averment=None,
        ))
        assert result.refused is True
        assert result.may_generate is False
        assert result.context is None
        assert "141" in result.reason

    def test_company_accused_with_s141_builds(self):
        result = complaint.build(**_base(
            accused_is_company=True,
            s141_averment="A2 to A4 were in charge of and responsible for the "
                          "conduct of the business of A1 at the relevant time",
        ))
        assert result.refused is False
        assert result.context["s141_averment"]

    def test_individual_accused_needs_no_s141(self):
        result = complaint.build(**_base(accused_is_company=False, s141_averment=None))
        assert result.refused is False

    def test_blank_s141_for_company_refused(self):
        result = complaint.build(**_base(accused_is_company=True, s141_averment="   "))
        assert result.refused is True


# --------------------------------------------------------------------------
# Deemed service — averment required; cause of action still computed.
# --------------------------------------------------------------------------

class TestDeemedService:
    def test_refused_notice_requires_deemed_service_averment(self):
        """Refused notice with no deemed-service averment -> refuse the complaint.
        (But the date must still be computable — see the next test.)"""
        result = complaint.build(**_base(
            notice_refused=True, notice_delivery_date=None,
            deemed_service_averment=None,
        ))
        assert result.refused is True
        assert "deemed" in result.reason.lower()

    def test_refused_notice_with_averment_computes_coa_from_deemed_delivery(self):
        """Refused/unclaimed does NOT skip the date computation: cause of action
        runs from the deemed delivery date."""
        result = complaint.build(**_base(
            notice_refused=True,
            notice_delivery_date=None,
            deemed_delivery_date=date(2024, 1, 25),  # deemed served this day
            deemed_service_averment="the notice returned 'refused' and is deemed "
                                    "served on the date of refusal",
            filing_date=date(2024, 2, 25),
        ))
        assert result.refused is False
        # CoA = deemed delivery 2024-01-25 + 15 + 1 = 2024-02-10.
        assert result.context["cause_of_action_date"] == date(2024, 2, 10)

    def test_unclaimed_notice_same_treatment(self):
        result = complaint.build(**_base(
            notice_unclaimed=True, notice_delivery_date=None,
            deemed_delivery_date=date(2024, 1, 25),
            deemed_service_averment="the notice returned 'unclaimed' and is deemed served",
            filing_date=date(2024, 2, 25),
        ))
        assert result.refused is False
        assert result.context["deemed_service"] is True


# --------------------------------------------------------------------------
# Cause of action + filing window (reuses s138_windows).
# --------------------------------------------------------------------------

class TestCauseOfActionAndFiling:
    def test_cause_of_action_from_actual_delivery(self):
        """Delivered 2024-01-20 -> CoA 2024-01-20 + 15 + 1 = 2024-02-05."""
        result = complaint.build(**_base(notice_delivery_date=date(2024, 1, 20),
                                         filing_date=date(2024, 2, 5)))
        assert result.context["cause_of_action_date"] == date(2024, 2, 5)

    def test_filing_within_one_month_no_condonation(self):
        result = complaint.build(**_base(notice_delivery_date=date(2024, 1, 20),
                                         filing_date=date(2024, 3, 5)))
        assert result.refused is False
        assert result.context["condonation_required"] is False

    def test_filing_beyond_one_month_auto_attaches_condonation(self):
        """Exceeded -> auto-attach the s.142(b)-proviso condonation application.
        This does NOT refuse — it flags the attachment."""
        result = complaint.build(**_base(notice_delivery_date=date(2024, 1, 20),
                                         filing_date=date(2024, 3, 10)))
        assert result.refused is False
        assert result.context["condonation_required"] is True
        assert result.context["condonation_section"] == "proviso to s.142(b) NI Act"

    def test_month_arithmetic_reused_from_windows(self):
        """CoA 2024-01-31 -> one calendar month -> 2024-02-29 (leap). A +30-day
        path would give the wrong deadline; this must match s138_windows."""
        # delivery 2024-01-15 -> CoA 2024-01-15 + 16 = 2024-01-31.
        # Chain kept internally consistent (memo<=notice<=dispatch<=delivery) so
        # the input-sanity guards do not fire.
        result = complaint.build(**_base(
            memo_date=date(2024, 1, 5), memo_received_date=date(2024, 1, 6),
            notice_date=date(2024, 1, 8), notice_dispatch_date=date(2024, 1, 8),
            notice_delivery_date=date(2024, 1, 15),
            filing_date=date(2024, 2, 29)))
        assert result.context["cause_of_action_date"] == date(2024, 1, 31)
        assert result.context["filing_deadline"] == date(2024, 2, 29)
        assert result.context["condonation_required"] is False


# --------------------------------------------------------------------------
# Mandatory averments.
# --------------------------------------------------------------------------

class TestMandatoryAverments:
    def test_complainant_not_payee_refused(self):
        result = complaint.build(**_base(is_payee=False))
        assert result.refused is True
        assert "payee" in result.reason.lower() or "holder" in result.reason.lower()

    def test_company_complainant_needs_authorisation(self):
        result = complaint.build(**_base(
            complainant_is_company=True, complainant_authorised_rep=None,
        ))
        assert result.refused is True
        assert "authoris" in result.reason.lower()

    def test_jurisdiction_out_of_territory_refused(self):
        result = complaint.build(**_base(payee_bank_branch_in_jurisdiction=False))
        assert result.refused is True
        assert "jurisdiction" in result.reason.lower()

    def test_cause_of_action_stated_explicitly(self):
        result = complaint.build(**_base())
        assert result.context["cause_of_action_date"] is not None


class TestSharedDebtSlot:
    def test_debt_slot_named_when_empty(self):
        result = complaint.build(**_base(debt_slot=""))
        assert result.context["debt_slot"] == "[to be drafted]"

    def test_debt_slot_prewritten_accepted(self):
        result = complaint.build(**_base(debt_slot="The accused borrowed Rs.1,00,000."))
        assert result.context["debt_slot"] == "The accused borrowed Rs.1,00,000."


class TestCheques:
    def test_cheques_tabulated(self):
        result = complaint.build(**_base())
        assert len(result.context["cheques"]) == 1
        assert result.context["cheques"][0]["number"] == "000123"


# --------------------------------------------------------------------------
# Input-sanity guards — garbage-input / impossible-chronology refusals. These
# reproduce the class of defect seen in a real botched draft (an inflated /
# corrupted cheque amount, a duplicated cheque number, a service date that
# preceded the notice). All HARD refuse; valid input is unaffected.
# --------------------------------------------------------------------------

class TestInputSanityGuards:
    def test_valid_base_still_passes(self):
        # Positive control: the guards must not refuse a well-formed complaint.
        assert complaint.build(**_base()).refused is False

    def test_non_positive_cheque_amount_refused(self):
        result = complaint.build(**_base(
            cheques=[Cheque(number="000123", date=date(2024, 1, 1), amount=0,
                            bank="SBI", branch="Mylapore", drawer="Suresh",
                            payee="Ramesh")],
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_cheque_amount_not_positive"

    def test_presentation_before_cheque_date_refused(self):
        # cheque dated 2024-01-10, presented 2024-01-05 — impossible.
        result = complaint.build(**_base(
            cheques=[Cheque(number="000123", date=date(2024, 1, 10), amount=100000,
                            bank="SBI", branch="Mylapore", drawer="Suresh",
                            payee="Ramesh")],
            presentation_date=date(2024, 1, 5),
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_presentation_before_cheque_date"

    def test_duplicate_cheque_number_refused(self):
        result = complaint.build(**_base(
            cheques=[
                Cheque(number="000123", date=date(2024, 1, 1), amount=100000,
                       bank="SBI", branch="Mylapore", drawer="Suresh", payee="Ramesh"),
                Cheque(number="000123", date=date(2024, 1, 2), amount=200000,
                       bank="SBI", branch="Mylapore", drawer="Suresh", payee="Ramesh"),
            ],
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_duplicate_cheque_number"

    def test_notice_before_memo_received_refused(self):
        # This is the PDF's "served 16.04.2026 for a 17.07.2026 notice" family:
        # a notice that predates the memo it responds to.
        result = complaint.build(**_base(
            memo_received_date=date(2024, 1, 15),
            notice_date=date(2024, 1, 10),
            notice_dispatch_date=date(2024, 1, 10),
            notice_delivery_date=date(2024, 1, 12),
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_notice_before_memo_received"

    def test_dispatch_before_notice_refused(self):
        result = complaint.build(**_base(
            notice_date=date(2024, 1, 18),
            notice_dispatch_date=date(2024, 1, 17),
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_dispatch_before_notice"

    def test_service_before_dispatch_refused(self):
        # The exact PDF defect: notice served BEFORE it was dispatched/issued.
        result = complaint.build(**_base(
            notice_date=date(2024, 1, 18),
            notice_dispatch_date=date(2024, 1, 18),
            notice_delivery_date=date(2024, 1, 16),
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_service_before_dispatch"

    def test_deemed_service_skips_actual_service_guard(self):
        # Refused/unclaimed: notice_delivery_date is irrelevant (deemed path),
        # so the service-before-dispatch guard must not fire.
        result = complaint.build(**_base(
            notice_refused=True,
            notice_delivery_date=None,
            deemed_delivery_date=date(2024, 1, 25),
            deemed_service_averment="deemed served under s.27 GCA / s.114 Evidence Act",
        ))
        assert result.refused is False


class TestPresentationRounds:
    """doc-5 E1: multi-round presentation history; the LAST round is operative."""

    def test_last_round_drives_the_window(self):
        # Two rounds: an early dishonour, then a re-presentation after deferment.
        # The LAST round (2024-03-10 presented, memo received 2024-03-12) must
        # drive the cause-of-action, NOT the base single-round dates.
        result = complaint.build(**_base(
            memo_date=date(2024, 1, 12), memo_received_date=date(2024, 1, 15),
            notice_date=date(2024, 3, 20), notice_dispatch_date=date(2024, 3, 20),
            notice_delivery_date=date(2024, 3, 22),
            filing_date=date(2024, 4, 20),
            presentation_rounds=[
                PresentationRound(date(2024, 1, 10), date(2024, 1, 12)),
                PresentationRound(date(2024, 3, 10), date(2024, 3, 12)),
            ],
        ))
        assert result.refused is False, result.reason
        # Operative presentation is the last round.
        assert result.context["presentation_date"] == date(2024, 3, 10)
        # CoA = last-round memo drives notice; delivery 2024-03-22 + 16 = 2024-04-07.
        assert result.context["cause_of_action_date"] == date(2024, 4, 7)
        # Both rounds pleaded; the second flagged as the operative (last) one.
        rounds = result.context["presentation_rounds"]
        assert len(rounds) == 2
        assert rounds[-1]["is_last"] is True
        assert rounds[0]["is_last"] is False

    def test_rounds_out_of_order_refused(self):
        result = complaint.build(**_base(
            presentation_rounds=[
                PresentationRound(date(2024, 3, 10), date(2024, 3, 12)),
                PresentationRound(date(2024, 1, 10), date(2024, 1, 12)),
            ],
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_presentation_rounds_out_of_order"

    def test_round_memo_before_presentation_refused(self):
        result = complaint.build(**_base(
            presentation_rounds=[
                PresentationRound(date(2024, 1, 10), date(2024, 1, 8)),
            ],
        ))
        assert result.refused is True
        assert result.refusal.code == "s138_complaint_round_memo_before_presentation"

    def test_no_rounds_uses_single_path_unchanged(self):
        # Positive control: the single-round path is unaffected when no rounds given.
        result = complaint.build(**_base())
        assert result.refused is False
        assert result.context["has_presentation_rounds"] is False
        assert result.context["presentation_rounds"] == []


class TestStandingWording:
    def test_payee_default(self):
        result = complaint.build(**_base())
        assert result.context["is_holder_in_due_course"] is False

    def test_holder_in_due_course_flag_threaded(self):
        result = complaint.build(**_base(is_holder_in_due_course=True))
        assert result.context["is_holder_in_due_course"] is True


class TestAdvocateBlock:
    def test_default_empty(self):
        result = complaint.build(**_base())
        assert result.context["advocate_lines"] == []
        assert result.context["advocate_contact"] is None

    def test_names_paired_with_enrolments(self):
        result = complaint.build(**_base(
            advocates=["M. Gowtham", "V. Srihari"],
            advocate_enrolments=["4687/2025", "4839/2025"],
            advocate_contact="Mobile: 8056618648",
        ))
        assert result.context["advocate_lines"] == [
            "M. Gowtham (Enrl. 4687/2025)", "V. Srihari (Enrl. 4839/2025)"]
        assert result.context["advocate_contact"] == "Mobile: 8056618648"

    def test_name_without_enrolment_renders_bare(self):
        result = complaint.build(**_base(advocates=["Solo Counsel"]))
        assert result.context["advocate_lines"] == ["Solo Counsel"]

    def test_blank_entries_dropped(self):
        result = complaint.build(**_base(
            advocates=["A. Advocate", "  ", ""],
            advocate_enrolments=["1/2020"],
        ))
        assert result.context["advocate_lines"] == ["A. Advocate (Enrl. 1/2020)"]


class TestCourtDesignation:
    def test_default_absent(self):
        result = complaint.build(**_base())
        assert result.context["court_designation"] is None

    def test_court_designation_threaded(self):
        result = complaint.build(**_base(
            court_designation="Metropolitan Magistrate, Fast Track Court-III",
        ))
        assert result.context["court_designation"] == (
            "Metropolitan Magistrate, Fast Track Court-III"
        )
