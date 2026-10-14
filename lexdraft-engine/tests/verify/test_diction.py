"""Tests for src.verify.diction — the optional diction/person-consistency lint
(doc-5 Item 5). Cases mirror the real errors the Thoorigai Prints drafts carried,
as catalogued in the Language Audit."""

from src.verify import diction


def _codes(findings):
    return {f.code for f in findings}


class TestDictionChecks:
    def test_complaint_for_complainant_flagged(self):
        # From the real affidavit: "I am the Complaint herein".
        out = diction.lint("I am the Complaint herein.")
        assert "diction_complaint_for_complainant" in _codes(out)
        assert out[0].severity == "high"

    def test_couert_flagged(self):
        out = diction.lint("IN THE COUERT OF METROPOLITAN MAGISTRATE")
        assert "diction_couert_misspelling" in _codes(out)

    def test_company_for_proprietorship_flagged(self):
        out = diction.lint("the complainant company is engaged in printing")
        assert "diction_company_for_proprietorship" in _codes(out)

    def test_stray_the_flagged(self):
        out = diction.lint("a statutory legal notice was issued the to the Accused")
        assert "diction_stray_the" in _codes(out)

    def test_clean_text_no_findings(self):
        out = diction.lint(
            "The Complainant is the payee of the cheque and the Accused is the drawer."
        )
        assert out == []


class TestPersonSlips:
    def test_third_person_slip_in_first_person_affidavit(self):
        # An "I" affidavit lapsing into "the complainant …".
        out = diction.lint(
            "I state that the complainant presented the cheque.",
            voice="first_person",
        )
        assert "diction_person_slip_third_in_first" in _codes(out)

    def test_first_person_slip_in_third_person_complaint(self):
        out = diction.lint(
            "The complainant submits that I state the cheque was dishonoured.",
            voice="third_person",
        )
        assert "diction_person_slip_first_in_third" in _codes(out)

    def test_voice_none_skips_person_checks(self):
        # Without a voice, a "the complainant" mention is NOT a slip.
        out = diction.lint("the complainant presented the cheque", voice=None)
        assert not any(c.startswith("diction_person_slip") for c in _codes(out))


class TestLintBlocks:
    def test_blocks_accumulate_in_order(self):
        out = diction.lint_blocks(
            ["I am the Complaint herein.", "issued the to the Accused"],
        )
        codes = _codes(out)
        assert "diction_complaint_for_complainant" in codes
        assert "diction_stray_the" in codes
