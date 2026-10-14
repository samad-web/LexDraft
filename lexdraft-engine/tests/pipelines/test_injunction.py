"""Tests for src.pipelines.injunction — temporary injunction O39 R1&2 (spec 4.2).

The classic triad — prima facie case, balance of convenience, irreparable injury
— must EACH appear as a separately headed, non-empty paragraph. Any one missing
or empty -> REFUSE. This is what applications are dismissed on.

Note the interaction with the named-empty-slot convention: paras 3/4/5 are [LLM]
slots BUT are mandatory and must be non-empty, so an empty triad limb REFUSES
(it does not fall back to "[to be drafted]"). The brief-facts slot (para 2) is a
normal named slot.

Other rules:
  - Prayer specificity: "restrain the defendant" without naming the act -> refuse.
  - Ex-parte relief -> mandatory O39 R3-proviso urgency + notice-futility para.
  - Undertaking as to damages required.
"""

import pytest

from src.pipelines import injunction as inj


def _base(**over):
    kw = dict(
        suit_ref="O.S. No. 100 of 2024",
        subject_matter="the suit property at 12 North Street, Mylapore",
        applicant_name="Ramesh", applicant_role="plaintiff",
        brief_facts="",  # LLM slot (para 2) — may be empty
        # triad (paras 3,4,5) — mandatory, non-empty
        prima_facie_case="the applicant holds registered title and the defendant "
                         "threatens dispossession without due process",
        balance_of_convenience="the applicant is in settled possession; the "
                               "defendant will suffer no injury from status quo",
        irreparable_injury="the property is unique; dispossession cannot be "
                           "compensated in damages",
        # para 6, 7
        urgency_conduct="the applicant has approached without delay",
        undertaking_as_to_damages=True,
        # prayer
        act_restrained="alienating, encumbering or interfering with the applicant's "
                       "possession of the suit property",
        # ex-parte
        is_ex_parte=False,
        notice_futility=None,
        place="Chennai",
    )
    kw.update(over)
    return kw


# --------------------------------------------------------------------------
# The triad — each separately headed, non-empty. Any missing -> refuse.
# --------------------------------------------------------------------------

class TestTriad:
    def test_complete_triad_builds(self):
        result = inj.build(**_base())
        assert result.refused is False
        assert result.context is not None

    def test_triad_paragraphs_separately_headed(self):
        result = inj.build(**_base())
        headings = [p["heading"] for p in result.context["triad"]]
        assert headings == ["PRIMA FACIE CASE", "BALANCE OF CONVENIENCE",
                            "IRREPARABLE INJURY"]

    def test_missing_prima_facie_refused(self):
        result = inj.build(**_base(prima_facie_case=""))
        assert result.refused is True
        assert result.context is None
        assert "prima facie" in result.reason.lower()

    def test_missing_balance_of_convenience_refused(self):
        result = inj.build(**_base(balance_of_convenience=""))
        assert result.refused is True
        assert "balance of convenience" in result.reason.lower()

    def test_missing_irreparable_injury_refused(self):
        result = inj.build(**_base(irreparable_injury=""))
        assert result.refused is True
        assert "irreparable" in result.reason.lower()

    def test_whitespace_only_limb_refused(self):
        """'Empty' includes whitespace-only — the limb must carry real content."""
        result = inj.build(**_base(irreparable_injury="   "))
        assert result.refused is True

    def test_triad_limb_does_not_fall_back_to_placeholder(self):
        """A mandatory triad limb must NOT be silently filled with the
        named-empty-slot placeholder."""
        result = inj.build(**_base(prima_facie_case=""))
        assert result.refused is True  # refuses instead of placeholdering


# --------------------------------------------------------------------------
# Prayer specificity.
# --------------------------------------------------------------------------

class TestPrayerSpecificity:
    def test_specific_act_builds(self):
        result = inj.build(**_base(act_restrained="demolishing the compound wall"))
        assert result.refused is False
        assert "compound wall" in result.context["prayer"]

    def test_empty_act_refused(self):
        result = inj.build(**_base(act_restrained=""))
        assert result.refused is True
        assert "specific" in result.reason.lower() or "act" in result.reason.lower()

    def test_vague_restrain_defendant_refused(self):
        """'restrain the defendant' with no act named is the classic vague prayer."""
        result = inj.build(**_base(act_restrained="restrain the defendant"))
        assert result.refused is True
        assert "specific" in result.reason.lower()


# --------------------------------------------------------------------------
# Ex-parte -> O39 R3-proviso urgency + notice-futility paragraph mandatory.
# --------------------------------------------------------------------------

class TestExParte:
    def test_ex_parte_without_notice_futility_refused(self):
        result = inj.build(**_base(is_ex_parte=True, notice_futility=None))
        assert result.refused is True
        assert "notice" in result.reason.lower() or "O39" in result.reason

    def test_ex_parte_with_notice_futility_builds(self):
        result = inj.build(**_base(
            is_ex_parte=True,
            notice_futility="notice to the defendant would defeat the purpose as "
                            "dispossession is imminent tonight",
        ))
        assert result.refused is False
        assert result.context["is_ex_parte"] is True
        assert result.context["notice_futility_paragraph"] is True

    def test_non_ex_parte_needs_no_notice_futility(self):
        result = inj.build(**_base(is_ex_parte=False, notice_futility=None))
        assert result.refused is False
        assert result.context["notice_futility_paragraph"] is False


# --------------------------------------------------------------------------
# Undertaking as to damages.
# --------------------------------------------------------------------------

class TestUndertaking:
    def test_missing_undertaking_refused(self):
        result = inj.build(**_base(undertaking_as_to_damages=False))
        assert result.refused is True
        assert "undertaking" in result.reason.lower()

    def test_undertaking_present_builds(self):
        result = inj.build(**_base(undertaking_as_to_damages=True))
        assert result.refused is False
        assert result.context["undertaking_as_to_damages"] is True


# --------------------------------------------------------------------------
# LLM slot — brief facts (para 2) named when empty.
# --------------------------------------------------------------------------

class TestBriefFactsSlot:
    def test_brief_facts_named_when_empty(self):
        result = inj.build(**_base(brief_facts=""))
        assert result.context["brief_facts_slot"] == "[to be drafted]"

    def test_brief_facts_prewritten_accepted(self):
        result = inj.build(**_base(brief_facts="The suit concerns title to X."))
        assert result.context["brief_facts_slot"] == "The suit concerns title to X."
