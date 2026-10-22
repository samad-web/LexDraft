"""Per-document adapters: inbound JSON <-> engine kwargs, with two hard rules.

RULE 1 — 422 is a DIFFERENT CHANNEL from a refusal.
    Malformed or missing REQUIRED input is a CLIENT error (HTTP 422). A legally
    blocked document is a 200 with outcome:"refused". The adapter validates and
    coerces the inbound fields BEFORE calling the engine `build()`. A missing
    required field can therefore NEVER reach the pipeline and NEVER surface as a
    refusal — the advocate is told "the form is incomplete", not "the law blocks
    you". This separation is the whole point of the adapter boundary.

RULE 2 — fields_implicated must SURVIVE the mapping (bidirectional).
    A refusal names ENGINE field names (the pipeline's kwargs). The frontend knows
    only the INBOUND contract keys. The adapter carries a bidirectional mapping, so
    when a refusal comes back the adapter translates each engine field to the
    inbound key the frontend can highlight. Nested list fields (e.g. a cheque's
    date inside `cheques`) translate to the inbound path the form actually renders.

Registry lookup by document type is at the bottom (`get_adapter`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from ...verify.refusals import Refusal
# The shared unfilled-slot pattern. Reused (not duplicated) so a required field
# still carrying an AI/authoring placeholder is a 422, exactly like a blank one.
# Safe direction: verify never imports service.adapters (adapters already depends
# on verify.refusals), so no import cycle.
from ...verify.signoff import SLOT_PATTERN


# --------------------------------------------------------------------------
# Validation errors — these become HTTP 422, never a refusal.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class FieldIssue:
    """One problem with one inbound field. `field` is the INBOUND key."""
    field: str
    code: str          # 'required' | 'type' | 'enum' | 'malformed'
    message: str

    def to_dict(self) -> Dict[str, Any]:
        return {"field": self.field, "code": self.code, "message": self.message}


class AdapterValidationError(Exception):
    """Inbound input did not match the contract. Maps to HTTP 422.

    This is a CLIENT error (incomplete/malformed form), categorically distinct
    from a Refusal (a legal finding). The two must never be conflated.
    """

    def __init__(self, issues: List[FieldIssue]):
        self.issues = issues
        super().__init__(
            "invalid input: "
            + "; ".join(f"{i.field}: {i.message}" for i in issues)
        )

    def to_dict(self) -> Dict[str, Any]:
        return {"error": "validation", "issues": [i.to_dict() for i in self.issues]}


# --------------------------------------------------------------------------
# Field types + coercion.
# --------------------------------------------------------------------------

_ISO_DATE = "date"


def _coerce_scalar(kind: str, value: Any, *, key: str,
                   enum_values: Optional[Tuple[str, ...]]) -> Any:
    """Coerce one inbound JSON scalar to the engine's Python type, or raise.

    Raises AdapterValidationError (single issue) on a malformed/typed value —
    this is a 422 cause, never a refusal.
    """
    if kind == "string":
        if not isinstance(value, str):
            raise AdapterValidationError([FieldIssue(key, "type", "expected a string")])
        return value
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise AdapterValidationError([FieldIssue(key, "type", "expected an integer")])
        return value
    if kind == "bool":
        if not isinstance(value, bool):
            raise AdapterValidationError([FieldIssue(key, "type", "expected a boolean")])
        return value
    if kind == _ISO_DATE:
        if not isinstance(value, str):
            raise AdapterValidationError([FieldIssue(key, "type", "expected an ISO date string")])
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise AdapterValidationError([FieldIssue(
                key, "malformed", f"'{value}' is not an ISO date (YYYY-MM-DD)")])
    if kind == "enum":
        if not isinstance(value, str) or (enum_values and value not in enum_values):
            allowed = ", ".join(enum_values or ())
            raise AdapterValidationError([FieldIssue(
                key, "enum", f"must be one of: {allowed}")])
        return value
    if kind == "string_list":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise AdapterValidationError([FieldIssue(
                key, "type", "expected a list of strings")])
        return list(value)
    raise AdapterValidationError([FieldIssue(key, "type", f"unsupported field kind {kind!r}")])


# --------------------------------------------------------------------------
# FieldSpec — one inbound field, and how it maps to an engine kwarg.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class FieldSpec:
    """One inbound contract field.

    key         the INBOUND key the frontend uses and the refusal is translated TO.
    kind        'string' | 'int' | 'bool' | 'date' | 'enum'
    engine      the engine `build()` kwarg this maps to (defaults to `key`).
    required    a missing/blank required field is a 422 (never a refusal).
    enum_values allowed values for kind == 'enum'.
    to_engine   optional post-coercion transform (e.g. inbound enum string ->
                the engine Enum member). Receives the coerced scalar.
    default     value to pass when the field is absent AND not required.
    """
    key: str
    kind: str
    engine: Optional[str] = None
    required: bool = True
    enum_values: Optional[Tuple[str, ...]] = None
    to_engine: Optional[Callable[[Any], Any]] = None
    default: Any = None
    # CONDITIONAL required-ness. When set, this predicate (payload -> bool) decides
    # whether the field is required for THIS request, overriding the static
    # `required` flag. Defaults to None so every existing field is unaffected. The
    # static `required` should be False for a conditional field (its honest
    # always-required baseline), so /doc-types advertises it as not-always-required.
    requires_when: Optional[Callable[[Mapping[str, Any]], bool]] = None
    # The DECLARATIVE form of `requires_when`, emitted verbatim by describe() so the
    # frontend can render the field exactly when the condition holds (a lambda can't
    # be introspected). Keep it consistent with `requires_when` by construction.
    # Shape: {"field": <sibling key>, "equals": <value>}.
    required_when: Optional[Mapping[str, Any]] = None

    @property
    def engine_name(self) -> str:
        return self.engine or self.key

    def is_required(self, payload: Mapping[str, Any]) -> bool:
        """Required-ness for THIS request. A `requires_when` predicate wins;
        otherwise the static `required` flag (unchanged behaviour)."""
        if self.requires_when is not None:
            return bool(self.requires_when(payload))
        return self.required


# --------------------------------------------------------------------------
# ListFieldSpec — a list of sub-records (e.g. cheques). Each item has its own
# sub-field specs; refusal translation can point INTO the list.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class ListFieldSpec:
    key: str
    item_fields: Tuple[FieldSpec, ...]
    build_item: Callable[[Dict[str, Any]], Any]   # dict of engine kwargs -> engine obj
    engine: Optional[str] = None
    required: bool = True
    min_items: int = 0
    # Conditional required-ness (see FieldSpec.requires_when / required_when).
    requires_when: Optional[Callable[[Mapping[str, Any]], bool]] = None
    required_when: Optional[Mapping[str, Any]] = None

    @property
    def engine_name(self) -> str:
        return self.engine or self.key

    def is_required(self, payload: Mapping[str, Any]) -> bool:
        if self.requires_when is not None:
            return bool(self.requires_when(payload))
        return self.required


# --------------------------------------------------------------------------
# The Adapter.
# --------------------------------------------------------------------------

@dataclass
class Adapter:
    doc_type: str
    spec: str
    title: str
    build: Callable[..., Any]
    fields: Tuple[Any, ...]                    # FieldSpec | ListFieldSpec
    slots: Tuple[str, ...] = ()               # narrative slot inbound keys
    # The .docx template filename this doc renders to. Usually the pipeline module's
    # own `TEMPLATE`, but declared here so doc types whose build() lives in a SHARED
    # module (e.g. the conveyancing deeds) still resolve a template without a 1:1
    # module. `template_for()` reads this first, then falls back to the module.
    template: Optional[str] = None
    # engine kwarg name -> inbound key, for refusal translation. Built from the
    # field specs; may be extended for engine fields that have no 1:1 inbound
    # field (e.g. a nested cheque date the refusal reports as ("cheques",)).
    extra_reverse: Mapping[str, str] = field(default_factory=dict)

    # ---- inbound validation + coercion (the 422 boundary) -----------------

    def coerce(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        """Validate + coerce inbound `fields` JSON into engine kwargs.

        Raises AdapterValidationError (-> 422) on any missing-required or malformed
        field. Returns the engine kwargs dict ONLY when the whole input is valid,
        so the pipeline is never handed a partial/typed-wrong request. Collects ALL
        issues so the form can show every problem at once.
        """
        issues: List[FieldIssue] = []
        kwargs: Dict[str, Any] = {}

        for spec in self.fields:
            if isinstance(spec, ListFieldSpec):
                self._coerce_list(spec, payload, kwargs, issues)
            else:
                self._coerce_scalar_field(spec, payload, kwargs, issues)

        if issues:
            raise AdapterValidationError(issues)
        return kwargs

    def _coerce_scalar_field(self, spec: FieldSpec, payload, kwargs, issues) -> None:
        required = spec.is_required(payload)
        present = spec.key in payload and payload[spec.key] is not None
        if not present:
            if required:
                issues.append(FieldIssue(spec.key, "required", "this field is required"))
            else:
                kwargs[spec.engine_name] = spec.default
            return
        try:
            coerced = _coerce_scalar(spec.kind, payload[spec.key], key=spec.key,
                                     enum_values=spec.enum_values)
        except AdapterValidationError as exc:
            issues.extend(exc.issues)
            return
        # A required STRING that is blank/whitespace is a missing field, not a
        # legal defect — keep it in the 422 channel. A required string still
        # carrying an unfilled-slot placeholder ("[deponent name to be provided]")
        # is likewise MISSING, not a valid value: the form is incomplete, so it is
        # a 422, never a filled field that reaches the pipeline.
        if required and spec.kind == "string" and (
            not str(coerced).strip() or SLOT_PATTERN.search(str(coerced))
        ):
            issues.append(FieldIssue(spec.key, "required", "this field is required"))
            return
        # A required STRING_LIST that is genuinely EMPTY (or only whitespace) is a
        # MISSING field — surface it as a 422 "required" so the intake can ask OR,
        # on the draft-now gesture, fill it with a bracketed [placeholder] gap. A
        # bracketed placeholder entry is DELIBERATELY allowed through (unlike a
        # blank string, and unlike a required scalar string): draft-now fills a
        # missing list field with "[… to be provided]" so the document RENDERS with
        # a visible, advocate-editable gap instead of dead-ending. Whitespace-only
        # entries are dropped; a placeholder entry is kept so the gap survives to
        # the rendered text.
        if required and spec.kind == "string_list":
            entries = [str(v) for v in coerced if str(v).strip()]
            if not entries:
                issues.append(FieldIssue(spec.key, "required", "this field is required"))
                return
            coerced = entries
        kwargs[spec.engine_name] = spec.to_engine(coerced) if spec.to_engine else coerced

    def _coerce_list(self, spec: ListFieldSpec, payload, kwargs, issues) -> None:
        required = spec.is_required(payload)
        raw = payload.get(spec.key)
        if raw is None:
            if required:
                issues.append(FieldIssue(spec.key, "required", "this field is required"))
            else:
                kwargs[spec.engine_name] = []
            return
        if not isinstance(raw, list):
            issues.append(FieldIssue(spec.key, "type", "expected a list"))
            return
        if required and len(raw) < max(1, spec.min_items):
            issues.append(FieldIssue(
                spec.key, "required",
                f"at least {max(1, spec.min_items)} item(s) required"))
            return
        items = []
        for idx, item in enumerate(raw):
            if not isinstance(item, Mapping):
                issues.append(FieldIssue(f"{spec.key}[{idx}]", "type", "expected an object"))
                continue
            item_kwargs: Dict[str, Any] = {}
            item_ok = True
            for sub in spec.item_fields:
                sub_present = sub.key in item and item[sub.key] is not None
                sub_path = f"{spec.key}[{idx}].{sub.key}"
                if not sub_present:
                    if sub.required:
                        issues.append(FieldIssue(sub_path, "required", "this field is required"))
                        item_ok = False
                    else:
                        item_kwargs[sub.engine_name] = sub.default
                    continue
                try:
                    coerced = _coerce_scalar(sub.kind, item[sub.key], key=sub_path,
                                             enum_values=sub.enum_values)
                except AdapterValidationError as exc:
                    issues.extend(exc.issues)
                    item_ok = False
                    continue
                if sub.required and sub.kind == "string" and not str(coerced).strip():
                    issues.append(FieldIssue(sub_path, "required", "this field is required"))
                    item_ok = False
                    continue
                item_kwargs[sub.engine_name] = (
                    sub.to_engine(coerced) if sub.to_engine else coerced)
            # Only construct the engine object when the item is fully valid — a
            # half-built item would crash the engine constructor, turning a 422
            # into a 500. When any item is invalid the whole call is a 422 anyway.
            if item_ok:
                items.append(spec.build_item(item_kwargs))
        # If issues were collected, coerce() raises before these items are used.
        kwargs[spec.engine_name] = items

    # ---- refusal-field translation (the bidirectional half) ---------------

    def _reverse_map(self) -> Dict[str, str]:
        """engine kwarg name -> inbound key. Built from the field specs, then
        overlaid with `extra_reverse` for engine fields with no 1:1 inbound field
        (e.g. a nested cheque date the pipeline reports under the list key)."""
        rev: Dict[str, str] = {}
        for spec in self.fields:
            rev[spec.engine_name] = spec.key
        rev.update(self.extra_reverse)
        return rev

    def translate_refusal_fields(self, refusal: Refusal) -> List[str]:
        """Map a refusal's engine field names to the inbound keys the frontend
        highlights. An engine field with no inbound counterpart is passed through
        unchanged rather than dropped (so nothing silently disappears)."""
        rev = self._reverse_map()
        return [rev.get(f, f) for f in refusal.fields]

    def refusal_to_wire(self, refusal: Refusal) -> Dict[str, Any]:
        """The refusal wire shape with `fields_implicated` translated to inbound
        keys (the frontend contract). All other fields pass through verbatim."""
        d = refusal.to_dict()
        d["fields_implicated"] = self.translate_refusal_fields(refusal)
        return d

    # ---- /doc-types contract ---------------------------------------------

    def describe(self) -> Dict[str, Any]:
        """The machine-readable field/slot contract the frontend renders forms
        from (served by GET /v1/doc-types). Field keys here are the SAME inbound
        keys a refusal's fields_implicated is translated to — one contract, both
        directions."""
        fields: List[Dict[str, Any]] = []
        for spec in self.fields:
            if isinstance(spec, ListFieldSpec):
                entry: Dict[str, Any] = {
                    "key": spec.key,
                    "kind": "list",
                    "required": spec.required,
                    "min_items": max(1, spec.min_items) if spec.required else spec.min_items,
                    "item_fields": [_describe_field(s) for s in spec.item_fields],
                }
                # Only present on a conditionally-required field, so the payload for
                # every unconditional field stays byte-identical.
                if spec.required_when is not None:
                    entry["required_when"] = dict(spec.required_when)
                fields.append(entry)
            else:
                fields.append(_describe_field(spec))
        return {
            "doc_type": self.doc_type,
            "spec": self.spec,
            "title": self.title,
            "fields": fields,
            "slots": list(self.slots),
        }


def _describe_field(spec: FieldSpec) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "key": spec.key,
        "kind": spec.kind,
        "required": spec.required,
    }
    if spec.enum_values:
        out["enum_values"] = list(spec.enum_values)
    # Emitted only for a conditionally-required field; absent otherwise, so the
    # /doc-types payload for every unconditional field is unchanged.
    if spec.required_when is not None:
        out["required_when"] = dict(spec.required_when)
    return out


# --------------------------------------------------------------------------
# Registry.
# --------------------------------------------------------------------------

_ADAPTERS: Dict[str, Adapter] = {}


def register(adapter: Adapter) -> None:
    _ADAPTERS[adapter.doc_type] = adapter


def get_adapter(doc_type: str) -> Adapter:
    if doc_type not in _ADAPTERS:
        raise KeyError(doc_type)
    return _ADAPTERS[doc_type]


def all_adapters() -> List[Adapter]:
    return [_ADAPTERS[k] for k in sorted(_ADAPTERS)]


# Import adapter modules so they self-register. (Kept at the bottom to avoid a
# circular import: the modules import from this file.)
from . import s138_notice as _s138_notice  # noqa: E402,F401
# Standalone affidavit doc-type (reuses the components/affidavit.py rules).
from . import affidavit as _affidavit  # noqa: E402,F401
# Batch 1-4 pleadings + notices.
from . import s138_complaint as _s138_complaint  # noqa: E402,F401
from . import regular_bail as _regular_bail  # noqa: E402,F401
from . import anticipatory_bail as _anticipatory_bail  # noqa: E402,F401
from . import default_bail as _default_bail  # noqa: E402,F401
from . import general_notice as _general_notice  # noqa: E402,F401
from . import plaint as _plaint  # noqa: E402,F401
from . import summary_suit as _summary_suit  # noqa: E402,F401
from . import injunction as _injunction  # noqa: E402,F401
from . import writ_petition as _writ_petition  # noqa: E402,F401
from . import maintenance as _maintenance  # noqa: E402,F401
from . import dv_application as _dv_application  # noqa: E402,F401
from . import consumer_complaint as _consumer_complaint  # noqa: E402,F401
from . import mact_claim as _mact_claim  # noqa: E402,F401
from . import divorce_contested as _divorce_contested  # noqa: E402,F401
from . import divorce_mutual as _divorce_mutual  # noqa: E402,F401
# Batch 3 new pleadings.
from . import permanent_injunction as _permanent_injunction  # noqa: E402,F401
from . import specific_performance as _specific_performance  # noqa: E402,F401
from . import ejectment as _ejectment  # noqa: E402,F401
from . import indigent_application as _indigent_application  # noqa: E402,F401
from . import o39_r2a_application as _o39_r2a_application  # noqa: E402,F401
from . import caveat as _caveat  # noqa: E402,F401
from . import transfer_petition as _transfer_petition  # noqa: E402,F401
from . import execution_application as _execution_application  # noqa: E402,F401
from . import restitution_conjugal_rights as _rcr  # noqa: E402,F401
from . import judicial_separation as _judicial_separation  # noqa: E402,F401
from . import succession_grant as _succession_grant  # noqa: E402,F401
from . import succession_certificate as _succession_certificate  # noqa: E402,F401
from . import writ_criminal as _writ_criminal  # noqa: E402,F401
from . import special_leave_petition as _slp  # noqa: E402,F401
from . import contempt_petition as _contempt_petition  # noqa: E402,F401
from . import written_statement as _written_statement  # noqa: E402,F401
# Batch 4 notices + conveyancing deeds.
from . import s106_notice as _s106_notice  # noqa: E402,F401
from . import s80_notice as _s80_notice  # noqa: E402,F401
from . import s138_reply as _s138_reply  # noqa: E402,F401
from . import sale_deed as _sale_deed  # noqa: E402,F401
from . import _conveyancing_adapters as _conveyancing_adapters  # noqa: E402,F401
# TN / Madras court forms set (generalised for any state).
from . import vakalatnama as _vakalatnama  # noqa: E402,F401
from . import memo_of_appearance as _memo_of_appearance  # noqa: E402,F401
from . import coding_sheet as _coding_sheet  # noqa: E402,F401
from . import process_application as _process_application  # noqa: E402,F401
from . import copy_application as _copy_application  # noqa: E402,F401
from . import call_for_memo as _call_for_memo  # noqa: E402,F401
from . import batta_witness as _batta_witness  # noqa: E402,F401
from . import recall_petition as _recall_petition  # noqa: E402,F401
from . import process_memo as _process_memo  # noqa: E402,F401
from . import surety_memo as _surety_memo  # noqa: E402,F401
from . import affidavit_of_surety as _affidavit_of_surety  # noqa: E402,F401
from . import service_of_process_application as _service_of_process_application  # noqa: E402,F401
from . import affidavit_of_service as _affidavit_of_service  # noqa: E402,F401
from . import substituted_service as _substituted_service  # noqa: E402,F401
from . import bail_bond as _bail_bond  # noqa: E402,F401
from . import surety_affidavit as _surety_affidavit  # noqa: E402,F401
from . import memorandum_furnish_sureties as _memorandum_furnish_sureties  # noqa: E402,F401
from . import surrender_petition as _surrender_petition  # noqa: E402,F401
from . import s256_condone_absence as _s256_condone_absence  # noqa: E402,F401
from . import s317_dispense_presence as _s317_dispense_presence  # noqa: E402,F401
from . import recall_warrant as _recall_warrant  # noqa: E402,F401
from . import adjournment_petition as _adjournment_petition  # noqa: E402,F401
from . import urgent_petition as _urgent_petition  # noqa: E402,F401
from . import appeal_record_cost_schedule as _appeal_record_cost_schedule  # noqa: E402,F401
from . import summons as _summons  # noqa: E402,F401
from . import court_notice as _court_notice  # noqa: E402,F401
from . import court_warrant as _court_warrant  # noqa: E402,F401
# Imported formats (templates/imported/manifest.json) — data-driven, registered
# LAST so they can never shadow a built-in doc type.
from . import imported as _imported  # noqa: E402,F401
