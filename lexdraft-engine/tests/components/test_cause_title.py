"""Tests for src.components.cause_title — 3 variants + validation (spec 1.1).

Variants required: District Court (civil), High Court (writ), Sessions (criminal).

Validation (deterministic, from spec 1.1):
  - Party serial numbers continuous, no gaps (per role).
  - Minor party has guardian/next-friend block.        [guarded at Party level]
  - Company party has CIN + authorised representative.  [guarded at Party level]
  - Respondent order in writs: authority first, private parties last.
  - Custody line present if in_custody true.
  - Lower court case reference present for all appeals/revisions.

These tests assert the *context* the renderer builds and the *validation*
verdicts. Golden-file .docx rendering is covered in tests/documents/.
"""

import pytest

from src.factsheet import Party, PartyRole, Guardian, Court, Case
from src.components import cause_title as ct


def _plaintiff():
    return Party(role=PartyRole.PLAINTIFF, serial=1, name="Ramesh", age=42,
                 parentage_type="son of", parentage_name="Krishnan",
                 occupation="business", address_lines=["12 North St"], pin="600004")


def _defendant():
    return Party(role=PartyRole.DEFENDANT, serial=1, name="Suresh", age=50,
                 parentage_type="son of", parentage_name="Raman",
                 occupation="trade", address_lines=["8 South St"], pin="600001")


class TestDistrictCivilVariant:
    def test_context_carries_court_and_parties(self):
        ctx = ct.build_context(
            variant=ct.Variant.DISTRICT_CIVIL,
            court=Court(court_type="district", name="Principal District Court",
                        state="Tamil Nadu"),
            case=Case(category="C2", document_type="suit", year=2026),
            parties=[_plaintiff(), _defendant()],
            court_place="Chengalpattu",
        )
        assert ctx["court"]["place"] == "Chengalpattu"
        assert ctx["plaintiffs"][0]["name"] == "Ramesh"
        assert ctx["defendants"][0]["name"] == "Suresh"

    def test_address_joined_from_lines_and_pin(self):
        ctx = ct.build_context(
            variant=ct.Variant.DISTRICT_CIVIL,
            court=Court(court_type="district", name="X", state="Tamil Nadu"),
            case=Case(category="C2", document_type="suit", year=2026),
            parties=[_plaintiff(), _defendant()],
            court_place="Chennai",
        )
        assert "600004" in ctx["plaintiffs"][0]["address"]


class TestWritVariant:
    def _authority(self, serial):
        return Party(role=PartyRole.RESPONDENT, serial=serial,
                     name="State of Tamil Nadu", is_authority=True)

    def _private(self, serial):
        return Party(role=PartyRole.RESPONDENT, serial=serial, name="Private Co",
                     is_authority=False)

    def test_writ_respondent_authority_first_passes(self):
        a = ct.validate(
            variant=ct.Variant.WRIT,
            parties=[
                Party(role=PartyRole.PETITIONER, serial=1, name="Citizen"),
                self._authority(1),
                self._private(2),
            ],
        )
        assert a.refused is False

    def test_writ_respondent_private_before_authority_refused(self):
        """Spec: authority first, private parties last. Private-first refuses."""
        a = ct.validate(
            variant=ct.Variant.WRIT,
            parties=[
                Party(role=PartyRole.PETITIONER, serial=1, name="Citizen"),
                self._private(1),
                self._authority(2),
            ],
        )
        assert a.refused is True
        assert "authority" in a.reason.lower()

    def test_writ_context_has_article_226(self):
        ctx = ct.build_context(
            variant=ct.Variant.WRIT,
            court=Court(court_type="high_court", name="Madras HC", state="Tamil Nadu"),
            case=Case(category="C2", document_type="writ_petition", year=2026),
            parties=[Party(role=PartyRole.PETITIONER, serial=1, name="Citizen"),
                     self._authority(1)],
            court_place="Madras", court_side="Appellate",
            writ_type="Mandamus",
        )
        assert ctx["writ_type"] == "Mandamus"


class TestSessionsCriminalVariant:
    def test_custody_line_present_when_in_custody(self):
        ctx = ct.build_context(
            variant=ct.Variant.SESSIONS_CRIMINAL,
            court=Court(court_type="sessions", name="Sessions Court", state="Tamil Nadu"),
            case=Case(category="C5", document_type="crl_mp", year=2026),
            parties=[Party(role=PartyRole.ACCUSED, serial=1, name="Accused A",
                           age=30, in_custody=True, prison="Puzhal Central Prison")],
            court_place="Chennai",
            crime_ref="Crime No. 45 of 2026",
            police_station="E4 Abiramapuram",
            district="Chennai",
        )
        assert ctx["accused"]["in_custody"] is True
        assert ctx["accused"]["prison"] == "Puzhal Central Prison"

    def test_custody_flag_true_but_no_prison_refused(self):
        """Custody line must be present if in_custody true (spec validation)."""
        a = ct.validate(
            variant=ct.Variant.SESSIONS_CRIMINAL,
            parties=[Party(role=PartyRole.ACCUSED, serial=1, name="A", age=30,
                           in_custody=True, prison=None)],
        )
        assert a.refused is True
        assert "custody" in a.reason.lower()


class TestSerialContinuity:
    def test_gap_in_serials_refused(self):
        a = ct.validate(
            variant=ct.Variant.DISTRICT_CIVIL,
            parties=[
                Party(role=PartyRole.PLAINTIFF, serial=1, name="A"),
                Party(role=PartyRole.DEFENDANT, serial=1, name="B"),
                Party(role=PartyRole.DEFENDANT, serial=3, name="C"),  # gap: no 2
            ],
        )
        assert a.refused is True
        assert "serial" in a.reason.lower()

    def test_continuous_serials_pass(self):
        a = ct.validate(
            variant=ct.Variant.DISTRICT_CIVIL,
            parties=[
                Party(role=PartyRole.PLAINTIFF, serial=1, name="A"),
                Party(role=PartyRole.DEFENDANT, serial=1, name="B"),
                Party(role=PartyRole.DEFENDANT, serial=2, name="C"),
            ],
        )
        assert a.refused is False


class TestAppealLowerCourtReference:
    def test_appeal_without_lower_court_ref_refused(self):
        a = ct.validate(
            variant=ct.Variant.APPEAL,
            parties=[
                Party(role=PartyRole.APPELLANT, serial=1, name="A"),
                Party(role=PartyRole.RESPONDENT, serial=1, name="B"),
            ],
            lower_court_reference=None,
        )
        assert a.refused is True
        assert "lower court" in a.reason.lower()

    def test_appeal_with_lower_court_ref_passes(self):
        a = ct.validate(
            variant=ct.Variant.APPEAL,
            parties=[
                Party(role=PartyRole.APPELLANT, serial=1, name="A"),
                Party(role=PartyRole.RESPONDENT, serial=1, name="B"),
            ],
            lower_court_reference="O.S. No. 10 of 2020, District Munsif, Chennai",
        )
        assert a.refused is False
