"""Adapter for the maintenance petition (spec 6.3)."""

from __future__ import annotations

from datetime import date
from typing import Any

from ...pipelines import maintenance as pipeline
from ...pipelines.maintenance import Relationship
from . import Adapter, FieldSpec, register


def _build(**kw: Any):
    # A maintenance petition is a fresh civil-natured action with no "offence":
    # absent any dates, route it as a fresh action filed today (-> s.144 BNSS).
    # The pipeline itself still refuses a bare None (router contract).
    if kw.get("offence_date") is None and kw.get("proceeding_start_date") is None:
        kw["offence_date"] = kw.get("filing_date") or date.today()
        kw["is_fresh_action"] = True
    # A wife's petition joined by her minor child: the first petitioner is the wife.
    if kw.get("relationship") is None:
        kw["relationship"] = Relationship.WIFE
    # The quantum rests on the means and needs pleaded in paras 4 and 5 when the
    # brief states no separate computation.
    if not (kw.get("quantum_basis") or "").strip():
        kw["quantum_basis"] = ("the income and means of the respondent and the needs "
                               "of the petitioner(s), as stated in paragraphs 4 and 5")
    return pipeline.build(**kw)


ADAPTER = Adapter(
    doc_type="maintenance", spec="6.3",
    title="Petition for maintenance", build=_build,
    template="maintenance.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        # Required unless a minor child is joined (then the first petitioner is the
        # wife): the extractor would not pick one value for "a wife and minor child".
        FieldSpec("relationship", "enum",
                  enum_values=tuple(r.value for r in Relationship),
                  to_engine=Relationship, required=False, default=None,
                  requires_when=lambda p: not str(p.get("child_name") or "").strip()),
        FieldSpec("respondent_name", "string"),
        FieldSpec("offence_date", "date", required=False, default=None),
        FieldSpec("proceeding_start_date", "date", required=False, default=None),
        FieldSpec("is_fresh_action", "bool", required=False, default=False),
        FieldSpec("neglect_or_refusal_pleaded", "bool"),
        # The petitioner's Rajnesh v. Neha affidavit is filed with every petition
        # (the template pleads it and the NOTE reminds); only an express False refuses.
        FieldSpec("petitioner_rajnesh_affidavit", "bool", required=False, default=True),
        FieldSpec("respondent_means", "string"),
        FieldSpec("petitioner_inability", "string"),
        FieldSpec("quantum", "int"),
        FieldSpec("quantum_basis", "string", required=False, default=""),
        FieldSpec("divorced_not_remarried", "bool", required=False, default=None),
        FieldSpec("child_age", "int", required=False, default=None),
        FieldSpec("child_unable_due_to_abnormality", "bool", required=False, default=None),
        FieldSpec("jurisdiction_basis", "string"),
        FieldSpec("place", "string"),
        FieldSpec("neglect_narrative", "string", required=False, default=""),
        FieldSpec("quantum_narrative", "string", required=False, default=""),
        FieldSpec("magistrate_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
        FieldSpec("child_name", "string", required=False, default=None),
        FieldSpec("child_quantum", "int", required=False, default=None),
        FieldSpec("petitioner_age", "int", required=False, default=None),
        FieldSpec("petitioner_address", "string", required=False, default=None),
        FieldSpec("respondent_address", "string", required=False, default=None),
        FieldSpec("marriage_date", "date", required=False, default=None),
        FieldSpec("marriage_place", "string", required=False, default=None),
    ),
    slots=("neglect_narrative", "quantum_narrative"),
)

register(ADAPTER)
