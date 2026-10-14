"""Adapter contract tests for the s.138 notice (Phase 1 lead).

The two hard rules:

  RULE 1 — 422 is a DIFFERENT CHANNEL from a refusal. A missing/blank required
           field, or a malformed value, is an AdapterValidationError (-> 422). It
           must NEVER reach the pipeline and NEVER surface as a refusal — the form
           is incomplete, the law is not blocking anything.

  RULE 2 — fields_implicated survives the mapping (bidirectional). A refusal names
           engine fields; the adapter translates them to the inbound keys the
           frontend highlights, including the nested cheque-date path.
"""

import pytest

from src.service import adapters
from src.service.adapters import AdapterValidationError
from src.pipelines.s138_notice import Cheque


A = adapters.get_adapter("s138_notice")


def _valid(**over):
    payload = {
        "client": "Lakshmi", "advocate": "Sundaravadivel",
        "advocate_enrolment": "MS/1/11", "recipient_name": "Murugan",
        "recipient_address": "12 Bharathi St, Coimbatore",
        "cheques": [{
            "number": "452118", "date": "2024-11-04", "amount": 450000,
            "bank": "IOB", "branch": "Town Hall", "drawer": "Murugan",
            "payee": "Lakshmi",
        }],
        "debt_nature": "hand loan", "debt_documents": ["pronote 10-06-2024"],
        "presentation_date": "2024-11-08", "presentation_bank": "CUB",
        "memo_date": "2024-11-11", "memo_received_date": "2024-11-13",
        "dishonour_reason": "Funds insufficient", "notice_date": "2024-11-25",
        "dispatch_mode": "RPAD", "dispatch_tracking_placeholder": "{{t}}",
        "place": "Coimbatore",
    }
    payload.update(over)
    return payload


# --------------------------------------------------------------------------
# Valid input reaches build() and generates.
# --------------------------------------------------------------------------

class TestHappyPath:
    def test_valid_input_coerces_to_typed_kwargs(self):
        kw = A.coerce(_valid())
        assert isinstance(kw["cheques"][0], Cheque)
        from datetime import date
        assert kw["memo_received_date"] == date(2024, 11, 13)
        assert kw["cheques"][0].amount == 450000  # int, not str
        assert kw["compliance_days"] == 15         # default applied

    def test_valid_input_builds_without_refusal(self):
        result = A.build(**A.coerce(_valid()))
        assert result.refused is False


# --------------------------------------------------------------------------
# RULE 1 — 422 channel, never a refusal.
# --------------------------------------------------------------------------

class TestValidationChannel:
    @pytest.mark.parametrize("payload,field,code", [
        (_valid(memo_received_date=None), "memo_received_date", "required"),
        ({k: v for k, v in _valid().items() if k != "client"}, "client", "required"),
        (_valid(client="   "), "client", "required"),
        (_valid(notice_date="25-11-2024"), "notice_date", "malformed"),
        (_valid(compliance_days="fifteen"), "compliance_days", "type"),
        (_valid(cheques=[]), "cheques", "required"),
    ])
    def test_bad_input_is_a_422_issue(self, payload, field, code):
        with pytest.raises(AdapterValidationError) as exc:
            A.coerce(payload)
        issues = {(i.field, i.code) for i in exc.value.issues}
        assert (field, code) in issues

    def test_missing_required_field_never_becomes_a_refusal(self):
        """The pipeline WOULD refuse a None memo_received_date with
        's138_notice_memo_receipt_date_missing'. The adapter must intercept it as a
        422 so the advocate is told the form is incomplete, not that the law blocks
        them. The pipeline is never called."""
        payload = _valid(memo_received_date=None)
        with pytest.raises(AdapterValidationError):
            A.coerce(payload)   # raises BEFORE build() — no refusal is produced

    def test_nested_cheque_field_errors_report_the_nested_path(self):
        payload = _valid(cheques=[{
            "number": "1", "date": "2024-11-04", "amount": "450000",  # str, wrong
            "bank": "IOB", "branch": "TH", "drawer": "M",  # payee missing
        }])
        with pytest.raises(AdapterValidationError) as exc:
            A.coerce(payload)
        fields = {i.field for i in exc.value.issues}
        assert "cheques[0].amount" in fields
        assert "cheques[0].payee" in fields

    def test_all_issues_reported_at_once(self):
        payload = {k: v for k, v in _valid().items() if k != "client"}
        payload["notice_date"] = "bad"
        with pytest.raises(AdapterValidationError) as exc:
            A.coerce(payload)
        fields = {i.field for i in exc.value.issues}
        assert {"client", "notice_date"} <= fields


# --------------------------------------------------------------------------
# RULE 2 — refusal fields round-trip to inbound keys (bidirectional).
# --------------------------------------------------------------------------

class TestRefusalFieldTranslation:
    def test_cheque_validity_refusal_points_at_the_cheque_date(self):
        # Valid input (form complete) but a cheque presented after its validity —
        # a genuine legal block. The refusal names the engine field `cheque_dates`;
        # the adapter must translate it to the nested inbound path.
        payload = _valid(cheques=[{
            "number": "452118", "date": "2024-05-04", "amount": 450000,
            "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L",
        }])
        result = A.build(**A.coerce(payload))
        assert result.refused
        assert result.refusal.code == "s138_notice_cheque_presented_after_validity"
        inbound = A.translate_refusal_fields(result.refusal)
        assert "cheques[].date" in inbound          # nested path, not "cheque_dates"
        assert "presentation_date" in inbound

    def test_every_translated_field_is_an_inbound_key_or_path(self):
        # Drive a scalar-field refusal and confirm translation yields inbound keys.
        # (The demand-override mismatch names override_demand_amount + cheques.)
        payload = _valid(override_demand_amount=999)
        result = A.build(**A.coerce(payload))
        assert result.refused
        inbound = A.translate_refusal_fields(result.refusal)
        # override_demand_amount and cheques are both 1:1 inbound keys.
        assert "override_demand_amount" in inbound
        assert "cheques" in inbound

    def test_wire_shape_carries_translated_fields(self):
        payload = _valid(cheques=[{
            "number": "1", "date": "2024-05-04", "amount": 450000,
            "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L",
        }])
        result = A.build(**A.coerce(payload))
        wire = A.refusal_to_wire(result.refusal)
        assert wire["code"] == "s138_notice_cheque_presented_after_validity"
        assert wire["fields_implicated"] == A.translate_refusal_fields(result.refusal)
        # The wire refusal never leaks a raw engine field name that has an inbound
        # mapping.
        assert "cheque_dates" not in wire["fields_implicated"]
