"""Adapter for the maintenance petition (spec 6.3)."""

from __future__ import annotations

from ...pipelines import maintenance as pipeline
from ...pipelines.maintenance import Relationship
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="maintenance", spec="6.3",
    title="Petition for maintenance", build=pipeline.build,
    template="maintenance.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        FieldSpec("relationship", "enum",
                  enum_values=tuple(r.value for r in Relationship),
                  to_engine=Relationship),
        FieldSpec("respondent_name", "string"),
        FieldSpec("offence_date", "date", required=False, default=None),
        FieldSpec("proceeding_start_date", "date", required=False, default=None),
        FieldSpec("is_fresh_action", "bool", required=False, default=False),
        FieldSpec("neglect_or_refusal_pleaded", "bool"),
        FieldSpec("petitioner_rajnesh_affidavit", "bool"),
        FieldSpec("respondent_means", "string"),
        FieldSpec("petitioner_inability", "string"),
        FieldSpec("quantum", "int"),
        FieldSpec("quantum_basis", "string"),
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
    ),
    slots=("neglect_narrative", "quantum_narrative"),
)

register(ADAPTER)
