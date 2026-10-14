"""Tests for src.rules.dual_code_router — the three-input dual-code router.

CLAUDE.md contract:
  route(offence_date, proceeding_start_date, is_fresh_action) -> framework

Two axes, resolved independently:
  SUBSTANTIVE  follows the OFFENCE DATE (Art. 20(1); BNS s.358).
               offence before 01-Jul-2024 -> IPC/IEA; on/after -> BNS/BSA.
  PROCEDURAL   pending proceedings continue under OLD procedure
               (BNSS s.531(2)(a)); FRESH actions take BNSS even on old facts.
               - is_fresh_action True  -> BNSS, regardless of the old offence.
               - is_fresh_action False -> the proceeding is pending; its start
                 date decides: started before the appointed day -> CrPC;
                 on/after -> BNSS.

NO DEFAULT. If the inputs don't resolve cleanly (e.g. a pending proceeding with
an unknown start date), REFUSE — unknown provenance is a real state, especially
for inherited matters.

The fresh-action path is tested hardest: a NEW petition on a PRE-appointed-day
FIR still takes BNSS procedurally. That is the mapping most get wrong.
"""

from datetime import date

import pytest

from src.rules import dual_code_router as router


APPOINTED = date(2024, 7, 1)  # BNS/BNSS/BSA came into force 01-Jul-2024


# --------------------------------------------------------------------------
# Substantive axis — offence date. Art. 20(1): no ex-post-facto.
# --------------------------------------------------------------------------

class TestSubstantiveAxis:
    def test_pre_appointed_offence_is_ipc(self):
        r = router.route(
            offence_date=date(2023, 5, 1),
            proceeding_start_date=date(2023, 6, 1),
            is_fresh_action=False,
        )
        assert r.substantive == router.Substantive.IPC

    def test_on_appointed_day_offence_is_bns(self):
        """Boundary: an offence ON 01-Jul-2024 is under the new substantive law."""
        r = router.route(
            offence_date=APPOINTED,
            proceeding_start_date=APPOINTED,
            is_fresh_action=True,
        )
        assert r.substantive == router.Substantive.BNS

    def test_day_before_appointed_is_ipc(self):
        r = router.route(
            offence_date=date(2024, 6, 30),
            proceeding_start_date=date(2024, 6, 30),
            is_fresh_action=False,
        )
        assert r.substantive == router.Substantive.IPC

    def test_substantive_independent_of_fresh_action(self):
        """A fresh action on an old offence is still IPC substantively — only the
        procedure flips to BNSS. This is the crux of the dual-code split."""
        r = router.route(
            offence_date=date(2023, 1, 1),
            proceeding_start_date=None,
            is_fresh_action=True,
        )
        assert r.substantive == router.Substantive.IPC
        assert r.procedural == router.Procedural.BNSS


# --------------------------------------------------------------------------
# Procedural axis — pending vs fresh (BNSS s.531(2)(a)).
# --------------------------------------------------------------------------

class TestPendingProceeding:
    def test_pending_before_appointed_is_crpc(self):
        """Investigation/trial/appeal pending on the appointed day continues
        under CrPC."""
        r = router.route(
            offence_date=date(2023, 1, 1),
            proceeding_start_date=date(2023, 3, 1),
            is_fresh_action=False,
        )
        assert r.procedural == router.Procedural.CRPC

    def test_pending_started_on_appointed_day_is_bnss(self):
        """Boundary: a proceeding commenced ON the appointed day is under BNSS."""
        r = router.route(
            offence_date=date(2024, 7, 1),
            proceeding_start_date=APPOINTED,
            is_fresh_action=False,
        )
        assert r.procedural == router.Procedural.BNSS

    def test_pending_started_day_before_is_crpc(self):
        r = router.route(
            offence_date=date(2024, 6, 30),
            proceeding_start_date=date(2024, 6, 30),
            is_fresh_action=False,
        )
        assert r.procedural == router.Procedural.CRPC


# --------------------------------------------------------------------------
# Fresh-action path — TESTED HARDEST. Fresh actions take BNSS even on old facts.
# --------------------------------------------------------------------------

class TestFreshAction:
    def test_fresh_petition_on_old_fir_is_bnss(self):
        """The canonical trap: a NEW quashing petition today on a 2023 FIR cites
        BNSS procedurally, NOT CrPC s.482 — even though the offence is IPC."""
        r = router.route(
            offence_date=date(2023, 2, 1),
            proceeding_start_date=None,      # no pending proceeding; this is fresh
            is_fresh_action=True,
        )
        assert r.procedural == router.Procedural.BNSS
        assert r.substantive == router.Substantive.IPC

    def test_fresh_action_ignores_proceeding_start_date(self):
        """is_fresh_action=True forces BNSS procedure regardless of any start date
        that happens to be supplied — freshness dominates the procedural axis."""
        r = router.route(
            offence_date=date(2020, 1, 1),
            proceeding_start_date=date(2020, 1, 1),  # even an old date present
            is_fresh_action=True,
        )
        assert r.procedural == router.Procedural.BNSS

    def test_fresh_action_on_new_offence_all_new(self):
        r = router.route(
            offence_date=date(2024, 9, 1),
            proceeding_start_date=None,
            is_fresh_action=True,
        )
        assert r.substantive == router.Substantive.BNS
        assert r.procedural == router.Procedural.BNSS

    def test_fresh_action_needs_no_proceeding_start_date(self):
        """A fresh action legitimately has no prior proceeding, so a None start
        date must NOT trigger the unknown-provenance refusal."""
        r = router.route(
            offence_date=date(2023, 1, 1),
            proceeding_start_date=None,
            is_fresh_action=True,
        )
        assert r.refused is False


# --------------------------------------------------------------------------
# No default — refuse on unresolvable inputs.
# --------------------------------------------------------------------------

class TestRefusals:
    def test_pending_with_unknown_start_date_refused(self):
        """A pending (non-fresh) proceeding with no start date cannot be routed —
        unknown provenance. REFUSE, do not guess."""
        r = router.route(
            offence_date=date(2023, 1, 1),
            proceeding_start_date=None,
            is_fresh_action=False,
        )
        assert r.refused is True
        assert r.substantive is None and r.procedural is None
        assert "provenance" in r.reason.lower() or "start date" in r.reason.lower()

    def test_missing_offence_date_refused(self):
        """Substantive law cannot be fixed without the offence date."""
        r = router.route(
            offence_date=None,
            proceeding_start_date=date(2024, 8, 1),
            is_fresh_action=True,
        )
        assert r.refused is True

    def test_refusal_carries_no_framework(self):
        r = router.route(offence_date=None, proceeding_start_date=None,
                         is_fresh_action=False)
        assert r.refused is True
        assert r.code_framework is None


# --------------------------------------------------------------------------
# code_framework convenience — what the bail pipelines consume.
# --------------------------------------------------------------------------

class TestCodeFrameworkOutput:
    def test_bnss_code_framework_string(self):
        r = router.route(offence_date=date(2024, 8, 1),
                         proceeding_start_date=None, is_fresh_action=True)
        assert r.code_framework == "bnss"

    def test_crpc_code_framework_string(self):
        r = router.route(offence_date=date(2023, 1, 1),
                         proceeding_start_date=date(2023, 3, 1),
                         is_fresh_action=False)
        assert r.code_framework == "crpc"

    def test_code_framework_tracks_procedural_axis_not_substantive(self):
        """Bail is procedural. A fresh action on an old (IPC) offence yields a
        'bnss' code_framework, because the procedural axis is what bail cites."""
        r = router.route(offence_date=date(2023, 1, 1),
                         proceeding_start_date=None, is_fresh_action=True)
        assert r.substantive == router.Substantive.IPC
        assert r.code_framework == "bnss"
