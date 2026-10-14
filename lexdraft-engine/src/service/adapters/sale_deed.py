"""Adapter for the Sale Deed (DPC book pp.109-111).

The build() lives in the SHARED conveyancing module (src.pipelines.conveyancing),
so this adapter declares `template="sale_deed.docx"` explicitly (there is no
`sale_deed` pipeline module). The four boundary directions arrive as flat inbound
fields and are reassembled into the engine's `boundaries` dict by a thin build
wrapper — keeping the inbound contract flat (one field per direction) while the
engine keeps its structured dict.
"""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import conveyancing as pipeline
from . import Adapter, FieldSpec, register


def _build(**kw: Any):
    boundaries = {
        "east": kw.pop("boundary_east", ""),
        "west": kw.pop("boundary_west", ""),
        "north": kw.pop("boundary_north", ""),
        "south": kw.pop("boundary_south", ""),
    }
    return pipeline.build_sale_deed(boundaries=boundaries, **kw)


ADAPTER = Adapter(
    doc_type="sale_deed",
    spec="dpc-109-111",
    title="Sale Deed",
    build=_build,
    template="sale_deed.docx",
    fields=(
        FieldSpec("vendor_name", "string"),
        FieldSpec("vendor_description", "string"),
        FieldSpec("vendee_name", "string"),
        FieldSpec("vendee_description", "string"),
        FieldSpec("property_desc", "string"),
        FieldSpec("boundary_east", "string"),
        FieldSpec("boundary_west", "string"),
        FieldSpec("boundary_north", "string"),
        FieldSpec("boundary_south", "string"),
        FieldSpec("total_consideration", "int"),
        FieldSpec("amount_already_paid", "int"),
        FieldSpec("balance_paid_mode", "string"),
        FieldSpec("prior_title_recital", "string"),
        FieldSpec("to_be_registered", "bool"),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
)

register(ADAPTER)
