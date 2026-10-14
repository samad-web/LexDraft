"""Tests for src.pipelines.s138_notice — the s.138 statutory notice (spec 2.2).

Highest-risk template. A defect is fatal to the complaint and limitation cannot
be revived, so every check REFUSES (no warning, no partial output) and shows the
computation.

The window/amount hard stops are delegated to src.rules.s138_windows (already
tested there for boundary dates). These tests assert:
  - the pipeline calls those rules and refuses when they refuse,
  - the 2.2-specific requirements: exactly-15-day compliance, verbatim dishonour
    reason, memo RECEIPT date present, dispatch-proof placeholder mandatory,
    multi-cheque itemisation with a single consolidated demand,
  - the mandatory averments are present in the built context.
"""

from datetime import date

import pytest

from src.pipelines import s138_notice as notice
from src.pipelines.s138_notice import Cheque


def _cheque(amount=100000, number="000123", d=date(2024, 1, 1)):
    return Cheque(number=number, date=d, amount=amount, bank="SBI",
                  branch="Mylapore", drawer="Suresh", payee="Ramesh")


def _base(**over):
    kw = dict(
        client="Ramesh", advocate="Adv. Kannan", advocate_enrolment="MS/1234/2010",
        recipient_name="Suresh", recipient_address="8 South St, Chennai 600001",
        cheques=[_cheque()],
        debt_nature="a hand loan advanced on 01-12-2023",
        debt_documents=["loan acknowledgement dated 01-12-2023"],
        presentation_date=date(2024, 1, 10), presentation_bank="Indian Bank",
        memo_date=date(2024, 1, 12),
        memo_received_date=date(2024, 1, 15),
        dishonour_reason="Funds insufficient",
        notice_date=date(2024, 1, 20),
        dispatch_mode="Registered Post Acknowledgement Due",
        dispatch_tracking_placeholder="{{ rpad_tracking }}",
        place="Chennai",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# Delegated hard stops — pipeline must refuse when the rules refuse.
# --------------------------------------------------------------------------

class TestDelegatedHardStops:
    def test_valid_notice_builds(self):
        result = notice.build(**_base())
        assert result.refused is False
        assert result.context is not None

    def test_notice_window_lapsed_refuses_and_shows_computation(self):
        """memo received 2024-01-15; 30-day window closes 2024-02-14. A notice on
        2024-02-20 is out of time -> refuse, with the computation shown, no output."""
        result = notice.build(**_base(notice_date=date(2024, 2, 20)))
        assert result.refused is True
        assert result.may_generate is False
        assert result.context is None
        assert result.computation is not None
        assert "30" in result.reason

    def test_presentation_beyond_validity_refuses(self):
        """Cheque 2024-01-01 valid to 2024-04-01; presented 2024-04-05 -> refuse."""
        result = notice.build(**_base(presentation_date=date(2024, 4, 5)))
        assert result.refused is True
        assert "presentation" in result.reason.lower() or "validity" in result.reason.lower()

    def test_demand_not_equal_cheque_refuses(self):
        """The demand is derived from the cheque total, so a tampered demand can't
        occur — but a per-cheque/total mismatch guard must still refuse."""
        result = notice.build(**_base(override_demand_amount=90000))
        assert result.refused is True
        assert "amount" in result.reason.lower()


# --------------------------------------------------------------------------
# 2.2-specific requirements.
# --------------------------------------------------------------------------

class TestCompliancePeriod:
    def test_compliance_period_is_exactly_15_days(self):
        result = notice.build(**_base())
        assert result.context["compliance_days"] == 15

    def test_caller_cannot_shorten_compliance_period(self):
        result = notice.build(**_base(compliance_days=10))
        assert result.refused is True
        assert "15" in result.reason


class TestDishonourReasonVerbatim:
    def test_reason_carried_verbatim(self):
        result = notice.build(**_base(dishonour_reason="Account Closed"))
        assert result.context["dishonour_reason"] == "Account Closed"

    def test_missing_dishonour_reason_refuses(self):
        result = notice.build(**_base(dishonour_reason=""))
        assert result.refused is True
        assert "reason" in result.reason.lower()


class TestMemoReceiptDate:
    def test_memo_receipt_date_required(self):
        """The limitation anchor is the RECEIPT date, not the memo date."""
        result = notice.build(**_base(memo_received_date=None))
        assert result.refused is True
        assert "receipt" in result.reason.lower() or "received" in result.reason.lower()

    def test_receipt_date_appears_in_context(self):
        result = notice.build(**_base())
        assert result.context["memo_received_date"] == date(2024, 1, 15)


class TestDispatchPlaceholder:
    def test_missing_dispatch_placeholder_refuses(self):
        result = notice.build(**_base(dispatch_tracking_placeholder=""))
        assert result.refused is True
        assert "dispatch" in result.reason.lower()


class TestMultipleCheques:
    def test_each_cheque_itemised(self):
        result = notice.build(**_base(cheques=[
            _cheque(amount=50000, number="A1", d=date(2024, 1, 1)),
            _cheque(amount=75000, number="A2", d=date(2024, 1, 2)),
        ]))
        assert result.refused is False
        assert len(result.context["cheques"]) == 2
        assert result.context["cheques"][0]["number"] == "A1"

    def test_consolidated_demand_is_sum(self):
        result = notice.build(**_base(cheques=[
            _cheque(amount=50000, number="A1"),
            _cheque(amount=75000, number="A2"),
        ]))
        assert result.context["demand_amount"] == 125000

    def test_all_cheques_within_validity_or_refuse(self):
        """One stale cheque in the set refuses the whole notice."""
        result = notice.build(**_base(
            cheques=[_cheque(number="A1", d=date(2024, 1, 1)),
                     _cheque(number="A2", d=date(2023, 1, 1))],  # stale vs presentation
            presentation_date=date(2024, 1, 10),
        ))
        assert result.refused is True


class TestMandatoryAverments:
    def test_debt_discharge_averment_present(self):
        result = notice.build(**_base())
        assert result.context["debt_nature"]
        assert result.context["cheque_in_discharge"] is True

    def test_client_authority_averment_present(self):
        result = notice.build(**_base())
        assert result.context["client"] == "Ramesh"
        assert result.context["under_instructions"] is True

    def test_amount_in_figures_and_words(self):
        result = notice.build(**_base(cheques=[_cheque(amount=125000)]))
        assert result.context["demand_amount"] == 125000
        assert "one lakh twenty-five thousand" in result.context["demand_words"].lower()
