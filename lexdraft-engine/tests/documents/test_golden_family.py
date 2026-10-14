"""Golden-file tests for maintenance (6.3) and DV s.12 application (6.4)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import maintenance as mnt
from src.pipelines import dv_application as dv
from src.components.render import render_to_docx, extract_text
from ._golden import render_golden

GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE = os.environ.get("LEXDRAFT_UPDATE_GOLDEN") == "1"


def _assert_golden(name: str, text: str):
    GOLDEN_DIR.mkdir(exist_ok=True)
    path = GOLDEN_DIR / f"{name}.txt"
    if UPDATE or not path.exists():
        path.write_text(text, encoding="utf-8")
        if not UPDATE:
            pytest.skip(f"golden {name} created; rerun to assert")
        return
    assert text == path.read_text(encoding="utf-8"), f"{name} drifted from golden"


def test_golden_maintenance(tmp_path):
    result = mnt.build(
        petitioner_name="Lakshmi", relationship=mnt.Relationship.WIFE,
        respondent_name="Murugan",
        offence_date=date(2024, 8, 1), proceeding_start_date=None,
        is_fresh_action=True,
        neglect_or_refusal_pleaded=True, petitioner_rajnesh_affidavit=True,
        respondent_means="the respondent is employed and earns Rs.60,000 per month",
        petitioner_inability="the petitioner has no independent income",
        quantum=20000,
        quantum_basis="one-third of the respondent's monthly income, per the "
                      "standard of living during cohabitation",
        divorced_not_remarried=None, child_age=None,
        child_unable_due_to_abnormality=None,
        jurisdiction_basis="the respondent resides within this court's jurisdiction",
        place="Chennai", neglect_narrative="", quantum_narrative="",
    )
    assert result.refused is False
    out = tmp_path / "maintenance.docx"
    render_golden(mnt.TEMPLATE, result.context, out)
    _assert_golden("maintenance", extract_text(out))


def test_golden_dv_application(tmp_path):
    result = dv.build(
        aggrieved_name="Priya", respondent_name="Karthik",
        domestic_relationship_pleaded=True,
        domestic_relationship_basis="the parties are married and lived together in "
                                    "a shared household",
        shared_household_pleaded=True,
        shared_household_particulars="the matrimonial home at 4 Lake Road, Chennai",
        reliefs=[
            dv.ReliefSought(head=dv.ReliefHead.PROTECTION_18,
                            averment="to restrain further acts of domestic violence"),
            dv.ReliefSought(head=dv.ReliefHead.MONETARY_20,
                            averment="monthly monetary relief of Rs.15,000"),
        ],
        incidents=[
            dv.AbuseIncident(category=dv.AbuseCategory.PHYSICAL, date="2024-03-01",
                             description="the respondent struck the aggrieved person"),
            dv.AbuseIncident(category=dv.AbuseCategory.ECONOMIC, date="2024-04-01",
                             description="the respondent withheld household expenses"),
        ],
        jurisdiction_basis="the aggrieved person resides within this court's "
                           "jurisdiction (s.27)",
        place="Chennai", incidents_narrative="",
    )
    assert result.refused is False
    out = tmp_path / "dv_application.docx"
    render_golden(dv.TEMPLATE, result.context, out)
    _assert_golden("dv_application", extract_text(out))
