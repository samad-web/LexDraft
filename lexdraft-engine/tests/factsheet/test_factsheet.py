"""Tests for src.factsheet — the Matter Fact Sheet model.

Scope of THIS test module (Task 1 mechanics that do not depend on the doc spec):
  - A fact sheet is the single fact entry per matter.
  - It carries court + case + parties + per-area extensions.
  - It is versioned: every edit produces a new immutable version; the matter
    keeps its full history; earlier versions never mutate.

DELIBERATELY NOT TESTED HERE: the exact field set of the cause-title schema
(Part 1.1 of specs/format-specs-p0.md). That spec is authoritative and is being
supplied separately. Per CLAUDE.md rule "if a spec field is empty, stop and ask
— do not infer", the party/court field lists below use only the coarse fields
named in Task 1 and treat the fine schema as pending. When the spec lands, a
schema-conformance test is added; these mechanics tests stay valid.
"""

import pytest

from src.factsheet import (
    MatterFactSheet,
    Party,
    PartyRole,
    Court,
    Case,
)


def _minimal_sheet():
    return MatterFactSheet.create(
        court=Court(
            court_type="district",
            name="Principal District Court, Chennai",
            state="Tamil Nadu",
        ),
        case=Case(category="C2", document_type="suit_for_recovery"),
        parties=[
            Party(role=PartyRole.PLAINTIFF, name="A", serial=1),
            Party(role=PartyRole.DEFENDANT, name="B", serial=1),
        ],
        created_by="adv-001",
    )


# --------------------------------------------------------------------------
# Single fact entry: structure.
# --------------------------------------------------------------------------

class TestStructure:
    def test_holds_court_case_parties(self):
        s = _minimal_sheet()
        assert s.court.name == "Principal District Court, Chennai"
        assert s.case.document_type == "suit_for_recovery"
        assert len(s.parties) == 2

    def test_parties_by_role(self):
        s = _minimal_sheet()
        assert [p.name for p in s.parties_in_role(PartyRole.PLAINTIFF)] == ["A"]
        assert [p.name for p in s.parties_in_role(PartyRole.DEFENDANT)] == ["B"]

    def test_per_area_extension_stored_and_read(self):
        """Per-area extension bag: area-specific facts (e.g. cheque details for
        s.138) hang off the sheet without polluting the core schema."""
        s = _minimal_sheet().with_extension(
            "ni_138", {"cheque_amount": 100000, "cheque_date": "2024-01-01"}
        )
        assert s.extension("ni_138")["cheque_amount"] == 100000

    def test_missing_extension_returns_none(self):
        s = _minimal_sheet()
        assert s.extension("ni_138") is None


# --------------------------------------------------------------------------
# Versioning: the matter keeps its history; old versions are immutable.
# --------------------------------------------------------------------------

class TestVersioning:
    def test_create_is_version_1(self):
        s = _minimal_sheet()
        assert s.version == 1

    def test_edit_produces_new_version(self):
        v1 = _minimal_sheet()
        v2 = v1.revise(created_by="adv-001",
                       parties=[*v1.parties, Party(role=PartyRole.DEFENDANT,
                                                    name="C", serial=2)])
        assert v2.version == 2
        assert len(v2.parties) == 3

    def test_prior_version_not_mutated(self):
        v1 = _minimal_sheet()
        original_party_count = len(v1.parties)
        _ = v1.revise(created_by="adv-001",
                      parties=[*v1.parties, Party(role=PartyRole.DEFENDANT,
                                                   name="C", serial=2)])
        # v1 must be untouched by producing v2.
        assert len(v1.parties) == original_party_count

    def test_same_matter_id_across_versions(self):
        v1 = _minimal_sheet()
        v2 = v1.revise(created_by="adv-001", parties=v1.parties)
        assert v1.matter_id == v2.matter_id

    def test_history_accessible(self):
        v1 = _minimal_sheet()
        v2 = v1.revise(created_by="adv-001", parties=v1.parties)
        v3 = v2.revise(created_by="adv-002", parties=v2.parties)
        versions = [v.version for v in v3.history()]
        assert versions == [1, 2, 3]

    def test_each_version_records_author(self):
        v1 = _minimal_sheet()
        v2 = v1.revise(created_by="adv-002", parties=v1.parties)
        assert v1.created_by == "adv-001"
        assert v2.created_by == "adv-001"   # who created the matter
        assert v2.revised_by == "adv-002"   # who made this revision


# --------------------------------------------------------------------------
# Validation guards that belong to the model itself (not the doc spec).
# --------------------------------------------------------------------------

class TestModelGuards:
    def test_requires_at_least_one_party(self):
        with pytest.raises(ValueError):
            MatterFactSheet.create(
                court=Court(court_type="district", name="X", state="Tamil Nadu"),
                case=Case(category="C2", document_type="suit"),
                parties=[],
                created_by="adv-001",
            )

    def test_unknown_court_type_rejected(self):
        with pytest.raises(ValueError):
            Court(court_type="galactic", name="X", state="Tamil Nadu")

    def test_extension_key_must_be_nonempty(self):
        with pytest.raises(ValueError):
            _minimal_sheet().with_extension("", {"k": 1})
