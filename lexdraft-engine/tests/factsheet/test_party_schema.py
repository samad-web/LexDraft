"""Conformance tests for the grown Party model against Part 1.1 of the spec.

Part 1.1 cause-title schema requires each party to carry:
    role, serial, name, age, parentage_type, parentage_name, occupation,
    address_lines[], pin, is_minor, guardian, is_company, cin, rep_by,
    rep_designation

These tests pin the field set and the model-level guards that Part 1.1's
Validation section makes deterministic:
  - Minor party must carry a guardian / next-friend block.
  - Company party must carry a CIN and an authorised representative.
"""

import pytest

from src.factsheet import Party, PartyRole, Guardian


# The exact schema field set from Part 1.1. If the model drifts from the spec,
# this list and the model diverge and the conformance test fails.
_SCHEMA_FIELDS = {
    "role", "serial", "name", "age", "parentage_type", "parentage_name",
    "occupation", "address_lines", "pin", "is_minor", "guardian",
    "is_company", "cin", "rep_by", "rep_designation",
}


class TestSchemaConformance:
    def test_party_exposes_every_schema_field(self):
        import dataclasses
        fields = {f.name for f in dataclasses.fields(Party)}
        missing = _SCHEMA_FIELDS - fields
        assert not missing, f"Party missing spec fields: {sorted(missing)}"

    def test_natural_person_party_constructs(self):
        p = Party(
            role=PartyRole.PLAINTIFF, serial=1, name="Ramesh Kumar", age=42,
            parentage_type="son of", parentage_name="Krishnan",
            occupation="business", address_lines=["12 North Street", "Mylapore"],
            pin="600004",
        )
        assert p.address == "12 North Street, Mylapore, 600004"  # lines + pin joined
        assert p.is_minor is False
        assert p.is_company is False


class TestMinorGuardianGuard:
    def test_minor_requires_guardian(self):
        with pytest.raises(ValueError):
            Party(
                role=PartyRole.PLAINTIFF, serial=1, name="Baby X", age=8,
                is_minor=True, guardian=None,
            )

    def test_minor_with_guardian_ok(self):
        p = Party(
            role=PartyRole.PLAINTIFF, serial=1, name="Baby X", age=8,
            is_minor=True,
            guardian=Guardian(name="Suresh", relation="father",
                              capacity="next friend"),
        )
        assert p.guardian.name == "Suresh"


class TestCompanyGuard:
    def test_company_requires_cin(self):
        with pytest.raises(ValueError):
            Party(
                role=PartyRole.DEFENDANT, serial=1, name="Acme Pvt Ltd",
                is_company=True, cin=None,
                rep_by="Managing Director", rep_designation="MD",
            )

    def test_company_requires_authorised_rep(self):
        with pytest.raises(ValueError):
            Party(
                role=PartyRole.DEFENDANT, serial=1, name="Acme Pvt Ltd",
                is_company=True, cin="U74999TN2015PTC012345",
                rep_by=None, rep_designation=None,
            )

    def test_company_with_cin_and_rep_ok(self):
        p = Party(
            role=PartyRole.DEFENDANT, serial=1, name="Acme Pvt Ltd",
            is_company=True, cin="U74999TN2015PTC012345",
            rep_by="Ravi", rep_designation="Managing Director",
        )
        assert p.cin == "U74999TN2015PTC012345"

    def test_party_cannot_be_both_minor_and_company(self):
        with pytest.raises(ValueError):
            Party(
                role=PartyRole.DEFENDANT, serial=1, name="X",
                is_minor=True, guardian=Guardian(name="G", relation="father",
                                                 capacity="next friend"),
                is_company=True, cin="U74999TN2015PTC012345",
                rep_by="Ravi", rep_designation="MD",
            )
