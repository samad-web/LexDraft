"""Tests for src.verify.signoff — the mandatory review banner + sign-off audit.

Requirements exercised:
  - every generated draft carries the review banner regardless of tables;
  - the table marker and the review banner are DISTINCT and can coexist;
  - the banner is suppressed ONLY by an explicit, recorded sign-off (not a toggle);
  - the matter id AND the fact-sheet version come from the fact sheet, not the caller;
  - the sign-off audit records who, when, and against which version;
  - a sign-off against a SUPERSEDED fact-sheet version is stale -> banner restored;
  - a document with an unfilled narrative slot must carry the banner and cannot be
    marked final at all.
"""

from datetime import datetime, timezone

import json

import pytest

from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole
from src.verify import signoff as S


def _sheet():
    return MatterFactSheet.create(
        court=Court(court_type="district", name="Test Court", state="Tamil Nadu"),
        case=Case(category="C4", document_type="suit_for_recovery"),
        parties=[Party(role=PartyRole.PLAINTIFF, serial=1, name="Plaintiff")],
        created_by="intake",
        created_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
    )


@pytest.fixture
def audit(tmp_path):
    return tmp_path / "signoff_audit.jsonl"


# --------------------------------------------------------------------------
# Unfilled-slot detection.
# --------------------------------------------------------------------------

class TestSlotDetection:
    def test_detects_slot_in_named_slot_key(self):
        ctx = {"accident_slot": "[to be drafted]", "place": "Chennai"}
        assert S.unfilled_slots(ctx) == ["accident_slot"]
        assert S.has_unfilled_slots(ctx)

    def test_detects_slot_inside_a_list(self):
        ctx = {"grounds": ["real ground", "[to be drafted]"]}
        assert S.has_unfilled_slots(ctx)

    def test_no_slots_when_all_drafted(self):
        ctx = {"accident_slot": "On 01-01-2024 the vehicle...", "place": "Chennai"}
        assert S.unfilled_slots(ctx) == []
        assert not S.has_unfilled_slots(ctx)

    def test_exact_canonical_marker_still_detected(self):
        # The original exact-equality behaviour must survive the pattern change.
        ctx = {"transaction_slot": "[to be drafted]"}
        assert S.unfilled_slots(ctx) == ["transaction_slot"]
        assert S.has_unfilled_slots(ctx)

    def test_detects_placeholder_embedded_mid_sentence(self):
        # A descriptive placeholder buried in a longer averment is still a slot —
        # substring match, not equality.
        ctx = {"para": "the cheque was returned on [date to be provided] per the memo"}
        assert S.unfilled_slots(ctx) == ["para"]
        assert S.has_unfilled_slots(ctx)

    def test_descriptive_variant_wordings_are_detected(self):
        for placeholder in (
            "[deponent name to be provided]",
            "[amount to be filled]",
            "[grounds to be completed]",
            "[address to be supplied]",
        ):
            assert S.SLOT_PATTERN.search(placeholder), placeholder
            assert S.has_unfilled_slots({"f": f"prefix {placeholder} suffix"}), placeholder

    def test_wet_ink_underscores_are_not_slots(self):
        # "____" is a wet-ink field (swearing date, case-number blank) the advocate
        # completes at execution — NOT an AI gap. It must never count as a slot.
        ctx = {"date": "____", "place": "Solemnly affirmed at ____ on this ____"}
        assert S.unfilled_slots(ctx) == []
        assert not S.has_unfilled_slots(ctx)


# --------------------------------------------------------------------------
# Banner presence / suppression.
# --------------------------------------------------------------------------

class TestBanner:
    def test_every_draft_carries_the_banner(self, audit):
        ctx = {"place": "Chennai"}  # no tables consumed, no slots
        assert S.banner_for(ctx, document="plaint", factsheet=_sheet(),
                            audit_path=audit) == S.REVIEW_BANNER

    def test_banner_and_table_marker_coexist(self, audit):
        ctx = {"unverified_marker": "[figures unverified — pending advocate review]"}
        resolved = S.resolve_context(ctx, document="mact_claim", factsheet=_sheet(),
                                     audit_path=audit)
        assert resolved["review_banner"] == S.REVIEW_BANNER
        assert resolved["unverified_marker"] == \
            "[figures unverified — pending advocate review]"
        assert resolved["review_banner"] != resolved["unverified_marker"]

    def test_banner_suppressed_only_after_recorded_signoff(self, audit):
        ctx = {"place": "Chennai"}
        sheet = _sheet()
        assert S.banner_for(ctx, document="plaint", factsheet=sheet,
                            audit_path=audit) == S.REVIEW_BANNER
        S.sign_off(document="plaint", factsheet=sheet, reviewer="Adv. R. Rao",
                   signed_on="2026-09-01", context=ctx, audit_path=audit)
        assert S.banner_for(ctx, document="plaint", factsheet=sheet,
                            audit_path=audit) == ""

    def test_signoff_is_matter_specific(self, audit):
        ctx = {"place": "Chennai"}
        sheet_a, sheet_b = _sheet(), _sheet()   # distinct matter_ids (uuid)
        S.sign_off(document="plaint", factsheet=sheet_a, reviewer="Adv. R. Rao",
                   signed_on="2026-09-01", context=ctx, audit_path=audit)
        assert S.banner_for(ctx, document="plaint", factsheet=sheet_b,
                            audit_path=audit) == S.REVIEW_BANNER


# --------------------------------------------------------------------------
# Fact-sheet version staleness.
# --------------------------------------------------------------------------

class TestVersionStaleness:
    def test_signoff_against_superseded_version_restores_banner(self, audit):
        ctx = {"place": "Chennai"}
        v1 = _sheet()
        S.sign_off(document="plaint", factsheet=v1, reviewer="Adv. R. Rao",
                   signed_on="2026-09-01", context=ctx, audit_path=audit)
        assert S.banner_for(ctx, document="plaint", factsheet=v1,
                            audit_path=audit) == ""

        # The facts are revised -> a new version of the SAME matter.
        v2 = v1.revise(created_by="intake",
                       revised_at=datetime(2026, 9, 2, tzinfo=timezone.utc))
        assert v2.matter_id == v1.matter_id and v2.version == v1.version + 1
        # The old sign-off no longer corresponds to the current facts.
        assert S.banner_for(ctx, document="plaint", factsheet=v2,
                            audit_path=audit) == S.REVIEW_BANNER

    def test_re_signing_the_new_version_clears_the_banner_again(self, audit):
        ctx = {"place": "Chennai"}
        v1 = _sheet()
        S.sign_off(document="plaint", factsheet=v1, reviewer="Adv. Rao",
                   signed_on="2026-09-01", context=ctx, audit_path=audit)
        v2 = v1.revise(created_by="intake",
                       revised_at=datetime(2026, 9, 2, tzinfo=timezone.utc))
        assert S.banner_for(ctx, document="plaint", factsheet=v2,
                            audit_path=audit) == S.REVIEW_BANNER
        # Advocate reviews the revised facts and signs off again.
        S.sign_off(document="plaint", factsheet=v2, reviewer="Adv. Rao",
                   signed_on="2026-09-02", context=ctx, audit_path=audit)
        assert S.banner_for(ctx, document="plaint", factsheet=v2,
                            audit_path=audit) == ""
        # And the superseded v1 view now reads as stale (later record is v2).
        assert S.banner_for(ctx, document="plaint", factsheet=v1,
                            audit_path=audit) == S.REVIEW_BANNER


# --------------------------------------------------------------------------
# Audit trail.
# --------------------------------------------------------------------------

class TestAuditTrail:
    def test_signoff_records_who_when_and_version(self, audit):
        ctx = {"place": "Chennai"}
        sheet = _sheet()
        rec = S.sign_off(document="writ_petition", factsheet=sheet,
                         reviewer="Adv. K. Meena", signed_on="2026-09-01T10:30:00",
                         context=ctx, audit_path=audit)
        assert rec.reviewer == "Adv. K. Meena"
        assert rec.signed_on == "2026-09-01T10:30:00"
        assert rec.matter_id == sheet.matter_id
        assert rec.version == sheet.version
        line = json.loads(audit.read_text(encoding="utf-8").splitlines()[-1])
        assert line["document"] == "writ_petition"
        assert line["matter_id"] == sheet.matter_id
        assert line["version"] == sheet.version
        assert line["reviewer"] == "Adv. K. Meena"
        assert line["signed_on"] == "2026-09-01T10:30:00"

    def test_audit_trail_is_append_only(self, audit):
        ctx = {"place": "Chennai"}
        S.sign_off(document="plaint", factsheet=_sheet(), reviewer="A",
                   signed_on="2026-09-01", context=ctx, audit_path=audit)
        S.sign_off(document="plaint", factsheet=_sheet(), reviewer="B",
                   signed_on="2026-09-02", context=ctx, audit_path=audit)
        assert len(audit.read_text(encoding="utf-8").splitlines()) == 2

    def test_signoff_requires_reviewer_and_date(self, audit):
        ctx = {"place": "Chennai"}
        with pytest.raises(S.SignOffError):
            S.sign_off(document="plaint", factsheet=_sheet(), reviewer="",
                       signed_on="2026-09-01", context=ctx, audit_path=audit)
        with pytest.raises(S.SignOffError):
            S.sign_off(document="plaint", factsheet=_sheet(), reviewer="Adv. Rao",
                       signed_on="", context=ctx, audit_path=audit)


# --------------------------------------------------------------------------
# The hard rule: unfilled slot -> cannot finalize, always banner.
# --------------------------------------------------------------------------

class TestSlotBlocksFinalization:
    def test_signoff_refuses_a_document_with_an_unfilled_slot(self, audit):
        ctx = {"accident_slot": "[to be drafted]", "place": "Chennai"}
        with pytest.raises(S.SignOffError) as exc:
            S.sign_off(document="mact_claim", factsheet=_sheet(),
                       reviewer="Adv. Rao", signed_on="2026-09-01",
                       context=ctx, audit_path=audit)
        assert "unfilled narrative slot" in str(exc.value)
        assert "accident_slot" in str(exc.value)

    def test_slotted_draft_keeps_banner_even_if_a_stale_signoff_exists(self, audit):
        sheet = _sheet()
        audit.write_text(json.dumps({
            "document": "mact_claim", "matter_id": sheet.matter_id,
            "version": sheet.version, "reviewer": "X", "signed_on": "2026-09-01",
        }) + "\n", encoding="utf-8")
        slotted = {"accident_slot": "[to be drafted]"}
        assert S.banner_for(slotted, document="mact_claim", factsheet=sheet,
                            audit_path=audit) == S.REVIEW_BANNER
