"""Adapter contract tests for the affidavit matter dimension (STEP 3).

matter_type + affidavit_kind are required unconditionally. When matter_type ==
"s138" the affidavit must additionally carry the same cheque + dishonour contract
the s.138 notice declares (conditionally required via FieldSpec.requires_when).
"""

import pytest

from src.service import adapters
from src.service.adapters import AdapterValidationError


A = adapters.get_adapter("affidavit")


def _base(**over):
    """A valid NON-s138 affidavit payload (cheques not required)."""
    payload = {
        "matter_type": "other",
        "affidavit_kind": "supporting",
        "deponent_name": "Ramesh Kumar",
        "age": 42,
        "parentage_type": "S/o",
        "parentage_name": "Suresh Kumar",
        "occupation": "Business",
        "address": "12 Anna Salai, Chennai",
        "role": "Deponent",
        "proceeding": "the above suit",
        "place": "Chennai",
        "attestor": "Notary Public, Chennai",
        "body_paras": ["That the facts stated are true."],
        "prayer": "take the affidavit on record",
    }
    payload.update(over)
    return payload


def _s138_particulars():
    """The cheque + dishonour fields an s.138 affidavit additionally requires."""
    return {
        "cheques": [{
            "number": "452118", "date": "2024-11-04", "amount": 450000,
            "bank": "IOB", "branch": "Town Hall", "drawer": "Murugan",
            "payee": "Lakshmi",
        }],
        "presentation_date": "2024-11-08",
        "presentation_bank": "CUB",
        "memo_date": "2024-11-11",
        "memo_received_date": "2024-11-13",
        "dishonour_reason": "Funds insufficient",
        "notice_date": "2024-11-25",
    }


def _issue_codes(exc, field):
    return [i.code for i in exc.issues if i.field == field]


# ---- unconditional matter dimension --------------------------------------

def test_missing_matter_type_is_422():
    payload = _base()
    del payload["matter_type"]
    with pytest.raises(AdapterValidationError) as ei:
        A.coerce(payload)
    assert "required" in _issue_codes(ei.value, "matter_type")


def test_invalid_matter_type_enum_is_422_enum():
    with pytest.raises(AdapterValidationError) as ei:
        A.coerce(_base(matter_type="s139"))
    assert "enum" in _issue_codes(ei.value, "matter_type")


# ---- conditional s.138 cheque/dishonour contract -------------------------

def test_s138_without_cheques_is_422_required_on_cheques():
    # matter_type s138 but no cheque particulars -> cheques required -> 422.
    with pytest.raises(AdapterValidationError) as ei:
        A.coerce(_base(matter_type="s138"))
    assert "required" in _issue_codes(ei.value, "cheques")


def test_civil_suit_without_cheques_coerces_fine():
    # A non-s138 matter never requires cheques.
    kwargs = A.coerce(_base(matter_type="civil_suit"))
    assert kwargs["cheques"] == []  # default for the not-required list


def test_s138_with_full_particulars_coerces_fine():
    kwargs = A.coerce(_base(matter_type="s138", **_s138_particulars()))
    assert len(kwargs["cheques"]) == 1
    assert kwargs["dishonour_reason"] == "Funds insufficient"
    assert kwargs["notice_date"].isoformat() == "2024-11-25"


# ---- describe() emits the machine-readable condition ---------------------

def test_describe_reports_required_when_on_conditional_fields_only():
    desc = A.describe()
    by_key = {f["key"]: f for f in desc["fields"]}
    # Conditional fields carry the machine-readable condition.
    assert by_key["cheques"]["required_when"] == {"field": "matter_type", "equals": "s138"}
    assert by_key["dishonour_reason"]["required_when"] == {"field": "matter_type", "equals": "s138"}
    # An unconditional field carries no required_when key at all.
    assert "required_when" not in by_key["deponent_name"]
