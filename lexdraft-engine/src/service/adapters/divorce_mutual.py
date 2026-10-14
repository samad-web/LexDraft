"""Adapters for the mutual-consent divorce motions (spec 6.2).

The pipeline exposes TWO build functions (build_first_motion / build_second_motion),
so this file registers TWO adapters with distinct doc_types
(divorce_mutual_first / divorce_mutual_second) and templates. The first motion's
settlement (maintenance/custody/property) arrives as three flat inbound fields and
is reassembled into the engine's Settlement object by a thin build wrapper.
"""

from __future__ import annotations

from typing import Any

from ...pipelines import divorce_mutual as pipeline
from ...pipelines.divorce_mutual import Settlement
from . import Adapter, FieldSpec, register


def _build_first(**kw: Any):
    kw["settlement"] = Settlement(
        maintenance=kw.pop("settlement_maintenance"),
        custody=kw.pop("settlement_custody"),
        property=kw.pop("settlement_property"),
    )
    return pipeline.build_first_motion(**kw)


register(Adapter(
    doc_type="divorce_mutual_first", spec="6.2",
    title="Divorce by mutual consent — first motion (s.13B(1))", build=_build_first,
    template="divorce_mutual_first.docx",
    fields=(
        FieldSpec("party_a", "string"),
        FieldSpec("party_b", "string"),
        FieldSpec("marriage_date", "date"),
        FieldSpec("marriage_place", "string"),
        FieldSpec("living_separately_since", "date"),
        FieldSpec("first_motion_date", "date"),
        FieldSpec("settlement_maintenance", "string"),
        FieldSpec("settlement_custody", "string"),
        FieldSpec("settlement_property", "string"),
        FieldSpec("joint_affidavit", "bool"),
        FieldSpec("place", "string"),
        FieldSpec("family_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=(),
))


register(Adapter(
    doc_type="divorce_mutual_second", spec="6.2",
    title="Divorce by mutual consent — second motion (s.13B(2))",
    build=pipeline.build_second_motion, template="divorce_mutual_second.docx",
    fields=(
        FieldSpec("party_a", "string"),
        FieldSpec("party_b", "string"),
        FieldSpec("first_motion_order_date", "date"),
        FieldSpec("second_motion_date", "date"),
        FieldSpec("settlement_implemented", "bool"),
        FieldSpec("waiver_sought", "bool", required=False, default=False),
        FieldSpec("place", "string"),
        FieldSpec("family_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=(),
))
