"""Tests for src.components.affidavit — block context + validation (spec 1.3).

Validation (deterministic, from spec 1.3):
  - Deponent competence stated in para 1 (structural — always present).
  - Corporate deponent has an authority reference (board resolution / POA).
  - Third-party deponent has an explicit source-of-knowledge averment.
  - Attestation block present; unfilled fields flagged.

The prayer paragraph number `{{ n }}` is CODE-GENERATED, never authored.
"""

import pytest

from src.components import affidavit as aff


def _base(**over):
    kw = dict(
        deponent_name="Ramesh", age=42, parentage_type="son of",
        parentage_name="Krishnan", occupation="business",
        address="12 North St, Chennai", role="Plaintiff",
        proceeding="suit", place="Chennai", date="1 August 2026",
        attestor="Advocate",
        body_paras=["The defendant borrowed Rs.1,00,000.",
                    "The amount remains unpaid."],
        prayer="grant a decree for recovery",
    )
    kw.update(over)
    return kw


class TestParagraphNumbering:
    def test_prayer_number_is_computed(self):
        """2 body paras after the para-1 competence clause -> prayer is para 4."""
        ctx = aff.build_context(**_base())
        # para 1 competence + 2 body (2,3) + prayer (4)
        assert ctx["prayer_number"] == 4

    def test_prayer_number_shifts_with_body_length(self):
        ctx = aff.build_context(**_base(body_paras=["only one body para"]))
        assert ctx["prayer_number"] == 3

    def test_body_paras_numbered_from_two(self):
        ctx = aff.build_context(**_base())
        numbers = [p["number"] for p in ctx["numbered_body"]]
        assert numbers == [2, 3]


class TestCorporateDeponent:
    def test_corporate_without_authority_ref_refused(self):
        a = aff.validate(**_base(is_corporate=True, authority_ref=None))
        assert a.refused is True
        assert "authority" in a.reason.lower()

    def test_corporate_with_authority_ref_ok(self):
        a = aff.validate(**_base(is_corporate=True,
                                 authority_ref="Board Resolution dated 01-07-2026"))
        assert a.refused is False

    def test_corporate_context_sets_authorised_flag(self):
        ctx = aff.build_context(**_base(is_corporate=True,
                                        authority_ref="POA dated 01-07-2026"))
        assert ctx["authorised"] is True
        assert ctx["authority_ref"] == "POA dated 01-07-2026"

    def test_individual_power_agent_with_authority_ref_is_authorised(self):
        # The common s.138 case: an INDIVIDUAL power agent (is_corporate=False)
        # swearing for the complainant with a POA reference. The authorisation
        # sentence must render, so `authorised` is True on the strength of the
        # ref alone (STEP 3d).
        ctx = aff.build_context(**_base(is_corporate=False,
                                        authority_ref="POA dated 05-08-2026"))
        assert ctx["authorised"] is True

    def test_no_authority_ref_is_not_authorised(self):
        ctx = aff.build_context(**_base(is_corporate=False, authority_ref=None))
        assert ctx["authorised"] is False


class TestThirdPartyDeponent:
    def test_third_party_without_source_refused(self):
        a = aff.validate(**_base(is_third_party=True, source_of_knowledge=None))
        assert a.refused is True
        assert "source" in a.reason.lower()

    def test_third_party_with_source_ok(self):
        a = aff.validate(**_base(is_third_party=True,
                                 source_of_knowledge="records maintained by me"))
        assert a.refused is False


class TestAttestation:
    def test_missing_attestor_flagged(self):
        a = aff.validate(**_base(attestor=None))
        assert a.refused is True
        assert "attest" in a.reason.lower()

    def test_deponent_of_own_affidavit_passes(self):
        a = aff.validate(**_base())
        assert a.refused is False
