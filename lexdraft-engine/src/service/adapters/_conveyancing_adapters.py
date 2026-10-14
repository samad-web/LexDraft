"""Adapters for the conveyancing deeds whose build() lives in the shared
`src.pipelines.conveyancing` module. Each declares its own doc_type + template and
a build wrapper that calls the right `build_*` function, reassembling nested
structures (boundaries dict, list-of-dataclass) from a flat inbound contract.

sale_deed and s106/s80/s138_reply have their own adapter files; the ten deeds here
are the rest of Part B.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ...pipelines import conveyancing as cv
from . import Adapter, FieldSpec, ListFieldSpec, register


def _boundaries(kw: Dict[str, Any]) -> Dict[str, str]:
    return {
        "east": kw.pop("boundary_east", ""),
        "west": kw.pop("boundary_west", ""),
        "north": kw.pop("boundary_north", ""),
        "south": kw.pop("boundary_south", ""),
    }


_BOUNDARY_FIELDS = (
    FieldSpec("boundary_east", "string"),
    FieldSpec("boundary_west", "string"),
    FieldSpec("boundary_north", "string"),
    FieldSpec("boundary_south", "string"),
)


# --- WILL -----------------------------------------------------------------
_BEQUEST_ITEM = (
    FieldSpec("property_desc", "string"),
    FieldSpec("beneficiary", "string"),
    FieldSpec("relation", "string"),
)


def _bequest(kw): return cv.Bequest(**kw)


register(Adapter(
    doc_type="will", spec="dpc-100-102", title="Will", build=cv.build_will,
    template="will.docx",
    fields=(
        FieldSpec("testator_name", "string"),
        FieldSpec("testator_parentage", "string"),
        FieldSpec("testator_address", "string"),
        FieldSpec("execution_date", "date"),
        ListFieldSpec("bequests", _BEQUEST_ITEM, _bequest, min_items=1),
        FieldSpec("sound_mind_declared", "bool"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
        FieldSpec("revokes_prior_wills", "bool", required=False, default=True),
        FieldSpec("executor_name", "string", required=False, default=None),
    ),
    slots=(),
))


# --- POWER OF ATTORNEY (general + special-sale) ---------------------------
def _build_poa(**kw: Any):
    kw["poa_kind"] = cv.POAKind(kw["poa_kind"])
    return cv.build_power_of_attorney(**kw)


register(Adapter(
    doc_type="power_of_attorney", spec="dpc-103-105",
    title="Power of Attorney (general / special-sale)", build=_build_poa,
    template="power_of_attorney.docx",
    fields=(
        FieldSpec("poa_kind", "enum", enum_values=tuple(k.value for k in cv.POAKind)),
        FieldSpec("executant_name", "string"),
        FieldSpec("executant_description", "string"),
        FieldSpec("attorney_name", "string"),
        FieldSpec("attorney_description", "string"),
        FieldSpec("powers", "string_list", required=False, default=[]),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
        FieldSpec("recitals", "string", required=False, default=""),
        FieldSpec("sale_property", "string", required=False, default=""),
        FieldSpec("sale_price", "int", required=False, default=None),
        FieldSpec("purchaser_name", "string", required=False, default=""),
        FieldSpec("sale_agreement_ref", "string", required=False, default=""),
    ),
    slots=(),
))


# --- AGREEMENT FOR SALE ---------------------------------------------------
register(Adapter(
    doc_type="agreement_for_sale", spec="dpc-106-108", title="Agreement for Sale",
    build=cv.build_agreement_for_sale, template="agreement_for_sale.docx",
    fields=(
        FieldSpec("vendor_name", "string"),
        FieldSpec("vendor_description", "string"),
        FieldSpec("vendee_name", "string"),
        FieldSpec("vendee_description", "string"),
        FieldSpec("property_desc", "string"),
        FieldSpec("total_consideration", "int"),
        FieldSpec("earnest_money", "int"),
        FieldSpec("earnest_mode", "string"),
        FieldSpec("completion_months", "int"),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))


# --- LEASE DEED -----------------------------------------------------------
register(Adapter(
    doc_type="lease_deed", spec="dpc-112-115", title="Lease Deed",
    build=cv.build_lease_deed, template="lease_deed.docx",
    fields=(
        FieldSpec("lessor_name", "string"),
        FieldSpec("lessor_description", "string"),
        FieldSpec("lessee_name", "string"),
        FieldSpec("lessee_description", "string"),
        FieldSpec("property_desc", "string"),
        FieldSpec("term_months", "int"),
        FieldSpec("commencement_date", "date"),
        FieldSpec("monthly_rent", "int"),
        FieldSpec("escalation_note", "string", required=False, default=""),
        FieldSpec("security_deposit", "int"),
        FieldSpec("notice_months", "int"),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))


# --- MORTGAGE DEED --------------------------------------------------------
register(Adapter(
    doc_type="mortgage_deed", spec="dpc-116-117", title="Mortgage Deed",
    build=cv.build_mortgage_deed, template="mortgage_deed.docx",
    fields=(
        FieldSpec("mortgagor_name", "string"),
        FieldSpec("mortgagor_description", "string"),
        FieldSpec("mortgagee_name", "string"),
        FieldSpec("mortgagee_description", "string"),
        FieldSpec("property_desc", "string"),
        FieldSpec("principal", "int"),
        FieldSpec("interest_rate", "int"),
        FieldSpec("repayment_terms", "string"),
        FieldSpec("purpose_recital", "string", required=False, default=""),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))


# --- PARTNERSHIP DEED + DISSOLUTION ---------------------------------------
_PARTNER_ITEM = (
    FieldSpec("name", "string"),
    FieldSpec("description", "string"),
    FieldSpec("share_pct", "int"),
)


def _partner(kw): return cv.Partner(**kw)


register(Adapter(
    doc_type="partnership_deed", spec="dpc-118-119", title="Partnership Deed",
    build=cv.build_partnership_deed, template="partnership_deed.docx",
    fields=(
        FieldSpec("firm_name", "string"),
        ListFieldSpec("partners", _PARTNER_ITEM, _partner, min_items=2),
        FieldSpec("business_nature", "string"),
        FieldSpec("principal_place", "string"),
        FieldSpec("commencement_date", "date"),
        FieldSpec("capital_note", "string", required=False, default=""),
        FieldSpec("at_will", "bool", required=False, default=True),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))


_DPARTNER_ITEM = (
    FieldSpec("name", "string"),
    FieldSpec("description", "string"),
    FieldSpec("share_pct", "int", required=False, default=0),
)


register(Adapter(
    doc_type="dissolution_deed", spec="dpc-120-121",
    title="Deed of Dissolution of Partnership", build=cv.build_dissolution_deed,
    template="dissolution_deed.docx",
    fields=(
        FieldSpec("firm_name", "string"),
        ListFieldSpec("partners", _DPARTNER_ITEM, _partner, min_items=2),
        FieldSpec("original_deed_ref", "string"),
        FieldSpec("dissolution_date", "date"),
        FieldSpec("accounts_settled", "bool", required=False, default=True),
        FieldSpec("records_custodian", "string"),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))


# --- RELINQUISHMENT DEED --------------------------------------------------
_RELEASOR_ITEM = (
    FieldSpec("name", "string"),
    FieldSpec("description", "string"),
)


def _releasor(kw): return cv.Releasor(**kw)


register(Adapter(
    doc_type="relinquishment_deed", spec="dpc-122-123",
    title="Relinquishment Deed", build=cv.build_relinquishment_deed,
    template="relinquishment_deed.docx",
    fields=(
        ListFieldSpec("releasors", _RELEASOR_ITEM, _releasor, min_items=1),
        FieldSpec("releasee_name", "string"),
        FieldSpec("releasee_description", "string"),
        FieldSpec("property_desc", "string"),
        FieldSpec("deceased_owner", "string"),
        FieldSpec("releasors_share", "string"),
        FieldSpec("for_consideration", "bool", required=False, default=False),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))


# --- GIFT DEED ------------------------------------------------------------
def _build_gift(**kw: Any):
    return cv.build_gift_deed(boundaries=_boundaries(kw), **kw)


register(Adapter(
    doc_type="gift_deed", spec="dpc-124-126", title="Gift Deed", build=_build_gift,
    template="gift_deed.docx",
    fields=(
        FieldSpec("donor_name", "string"),
        FieldSpec("donor_description", "string"),
        FieldSpec("donee_name", "string"),
        FieldSpec("donee_description", "string"),
        FieldSpec("relation", "string"),
        FieldSpec("property_desc", "string"),
        *_BOUNDARY_FIELDS,
        FieldSpec("market_value", "int"),
        FieldSpec("possession_delivered", "bool"),
        FieldSpec("to_be_registered", "bool"),
        FieldSpec("prior_title_recital", "string"),
        FieldSpec("execution_date", "date"),
        FieldSpec("witnesses", "string_list"),
        FieldSpec("place", "string"),
    ),
    slots=(),
))
