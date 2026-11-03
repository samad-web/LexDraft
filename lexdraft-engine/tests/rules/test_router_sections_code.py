"""The sections charged must belong to the Code in force on the offence date."""

from datetime import date

from src.rules import dual_code_router as router


def _route(offence, sections):
    return router.route(offence_date=offence, proceeding_start_date=None,
                        is_fresh_action=True, sections=sections)


def test_pre_appointed_day_offence_refuses_bns_sections():
    r = _route(date(2024, 1, 1), ["BNS 318(4)"])
    assert r.refused and r.refusal.code == "code_framework_sections_wrong_code"


def test_post_appointed_day_offence_refuses_ipc_sections():
    r = _route(date(2024, 8, 1), ["IPC 420"])
    assert r.refused and r.refusal.code == "code_framework_sections_wrong_code"


def test_matching_code_and_bnss_procedure_pass():
    assert not _route(date(2024, 1, 1), ["IPC 420"]).refused
    assert not _route(date(2024, 8, 1), ["BNS 318(4)", "BNSS 35"]).refused


def test_fresh_action_filed_before_appointed_day_is_crpc():
    r = router.route(offence_date=date(2024, 1, 1), proceeding_start_date=None,
                     is_fresh_action=True, filing_date=date(2024, 3, 10))
    assert not r.refused and r.procedural is router.Procedural.CRPC
