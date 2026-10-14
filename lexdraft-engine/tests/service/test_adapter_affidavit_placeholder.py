"""Adapter contract test: an unfilled-slot placeholder in a REQUIRED string is a
422 (incomplete form), never a filled value that reaches the pipeline.

This guards STEP 1b: _coerce_scalar_field treats a required string matching
signoff.SLOT_PATTERN as MISSING, exactly like a blank one. The pattern is reused
from src.verify.signoff (not duplicated).
"""

import pytest

from src.service import adapters
from src.service.adapters import AdapterValidationError


A = adapters.get_adapter("affidavit")


def _valid(**over):
    # matter_type "other" so the s.138 cheque/dishonour fields are NOT required —
    # this fixture isolates the placeholder behaviour, not the matter dimension.
    payload = {
        "matter_type": "other",
        "affidavit_kind": "supporting",
        "deponent_name": "Ramesh Kumar",
        "age": 42,
        "parentage_type": "S/o",
        "parentage_name": "Suresh Kumar",
        "occupation": "Business",
        "address": "12 Anna Salai, Chennai",
        "role": "Power Agent of the Complainant",
        "proceeding": "complaint under s.138 NI Act",
        "place": "Chennai",
        "attestor": "Notary Public, Chennai",
        "body_paras": ["That the accused issued a cheque which was dishonoured."],
        "prayer": "take the affidavit on record",
    }
    payload.update(over)
    return payload


def test_valid_payload_coerces_without_error():
    # Baseline: the fixture is genuinely valid, so the placeholder test below is
    # isolating the placeholder, not some other missing field.
    kwargs = A.coerce(_valid())
    assert kwargs["deponent_name"] == "Ramesh Kumar"


def test_required_field_with_placeholder_is_a_422_required_issue():
    with pytest.raises(AdapterValidationError) as ei:
        A.coerce(_valid(deponent_name="[deponent name to be provided]"))
    issues = ei.value.issues
    assert any(i.field == "deponent_name" and i.code == "required" for i in issues), issues


def test_wet_ink_underscores_in_required_field_do_not_raise():
    # "____" is a wet-ink field, not an AI gap — it must NOT be rejected (1c).
    kwargs = A.coerce(_valid(place="____"))
    assert kwargs["place"] == "____"
