"""Adapter for the standalone affidavit doc-type (spec 1.3)."""

from __future__ import annotations

from ...pipelines import affidavit as pipeline
from . import Adapter, FieldSpec, ListFieldSpec, register
# Reuse the s.138 cheque contract verbatim — the same cheque item spec + builder
# the notice adapter declares — so an affidavit in a s.138 matter carries exactly
# the same cheque/dishonour particulars. IMPORTED, never copied. Safe direction:
# s138_notice is registered before this module and does not import affidavit.
from .s138_notice import _CHEQUE_ITEM, _build_cheque


# The affidavit is required in a s.138 matter to carry the same cheque + dishonour
# particulars as the notice. Predicate + its declarative twin for describe().
def _is_s138(payload) -> bool:
    return payload.get("matter_type") == "s138"


_REQUIRED_WHEN_S138 = {"field": "matter_type", "equals": "s138"}

ADAPTER = Adapter(
    doc_type="affidavit", spec="p0#1.3",
    title="Affidavit",
    build=pipeline.build, template="affidavit.docx",
    fields=(
        # --- matter dimension (required unconditionally) ---
        FieldSpec("matter_type", "enum",
                  enum_values=("s138", "civil_suit", "bail", "writ", "other")),
        FieldSpec("affidavit_kind", "enum",
                  enum_values=("s145_proof", "supporting", "interlocutory")),
        # --- deponent ---
        FieldSpec("deponent_name", "string"),
        FieldSpec("age", "int"),
        FieldSpec("parentage_type", "string"),
        FieldSpec("parentage_name", "string"),
        FieldSpec("occupation", "string"),
        FieldSpec("address", "string"),
        FieldSpec("role", "string"),
        FieldSpec("proceeding", "string"),
        FieldSpec("place", "string"),
        FieldSpec("attestor", "string"),
        FieldSpec("body_paras", "string_list"),
        FieldSpec("prayer", "string"),
        # --- court cause-title + parties (the full COURT affidavit format) ---
        # Optional so a bare affidavit still drafts; when present, the template renders
        # the cause-title, the IN THE MATTER OF party block, and the "AFFIDAVIT OF ..."
        # heading exactly like a filed court affidavit.
        FieldSpec("court_name", "string", required=False, default=None),
        FieldSpec("court_district", "string", required=False, default=None),
        FieldSpec("suit_no", "string", required=False, default=None),
        FieldSpec("suit_year", "string", required=False, default=None),
        FieldSpec("suit_under", "string", required=False, default=None),
        FieldSpec("plaintiff_name", "string", required=False, default=None),
        FieldSpec("plaintiff_description", "string", required=False, default=None),
        FieldSpec("defendant_name", "string", required=False, default=None),
        FieldSpec("defendant_description", "string", required=False, default=None),
        FieldSpec("deponent_capacity", "string", required=False, default=None),
        FieldSpec("verification_place", "string", required=False, default=None),
        # --- other optional ---
        FieldSpec("affirm_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("religion", "string", required=False, default=None),
        FieldSpec("is_corporate", "bool", required=False, default=False),
        FieldSpec("authority_ref", "string", required=False, default=None),
        FieldSpec("is_third_party", "bool", required=False, default=False),
        FieldSpec("source_of_knowledge", "string", required=False, default=None),
        # Counsel backing-sheet block (carried from a derived s.138 proof affidavit).
        FieldSpec("advocate_lines", "string_list", required=False, default=None),
        FieldSpec("advocate_contact", "string", required=False, default=None),
        # --- s.138 cheque + dishonour particulars (required ONLY when
        # matter_type == "s138"; otherwise absent -> default). Types match
        # s138_notice.py:62-74 exactly; the cheque list reuses that adapter's spec.
        ListFieldSpec("cheques", _CHEQUE_ITEM, _build_cheque, min_items=1,
                      required=False, requires_when=_is_s138,
                      required_when=_REQUIRED_WHEN_S138),
        FieldSpec("presentation_date", "date", required=False, default=None,
                  requires_when=_is_s138, required_when=_REQUIRED_WHEN_S138),
        FieldSpec("presentation_bank", "string", required=False, default=None,
                  requires_when=_is_s138, required_when=_REQUIRED_WHEN_S138),
        FieldSpec("memo_date", "date", required=False, default=None,
                  requires_when=_is_s138, required_when=_REQUIRED_WHEN_S138),
        FieldSpec("memo_received_date", "date", required=False, default=None,
                  requires_when=_is_s138, required_when=_REQUIRED_WHEN_S138),
        FieldSpec("dishonour_reason", "string", required=False, default=None,
                  requires_when=_is_s138, required_when=_REQUIRED_WHEN_S138),
        FieldSpec("notice_date", "date", required=False, default=None,
                  requires_when=_is_s138, required_when=_REQUIRED_WHEN_S138),
    ),
    slots=(),
)

register(ADAPTER)
