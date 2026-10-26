"""FastAPI app — the engine's API surface. Co-located, localhost, service-to-service.

Endpoints (see docs/api-layer-plan.md):

  POST /v1/draft/{doc_type}   validate -> build -> refuse(200) | generate(200).
                              Malformed/missing input -> 422 (a DIFFERENT channel
                              from a refusal). Returns structured blocks AND a
                              base64 .docx, both carrying the review banner + any
                              table marker.
  POST /v1/route-code         dual_code_router only (cheap; used by the clarify loop).
  POST /v1/sign-off           mark a document final (records who/when/version).
  GET  /v1/doc-types          the field/slot contract the frontend renders forms from.
  GET  /healthz

  A firm's OWN uploaded format (stored by the Node API, sent with each call):
  GET  /v1/format-spec/contract   what the API's transcriber must produce.
  POST /v1/format-spec/check      validate a transcribed spec + preview render.
  POST /v1/draft-spec             draft from a spec — same wire shape as /v1/draft.

The engine is synchronous CPU work; every engine call runs in a threadpool so the
event loop stays free. The Node API is the only public surface — this service
trusts a shared token and never faces the browser.
"""

from __future__ import annotations

import base64
import io
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..verify import signoff
from ..verify.refusals import Refusal
from . import adapters
from .adapters import AdapterValidationError

app = FastAPI(title="LexDraft Engine API", version="1.0.0")


# --------------------------------------------------------------------------
# Shared-token auth (service-to-service). Configured out-of-band; when unset
# (dev/test) the guard is a no-op so the app is trivially testable.
# --------------------------------------------------------------------------

import os

_TOKEN = os.environ.get("LEXDRAFT_SERVICE_TOKEN", "")


def _check_token(authorization: Optional[str]) -> None:
    if not _TOKEN:
        return  # unset -> open (dev/test). Set it in any shared environment.
    expected = f"Bearer {_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid service token")


# --------------------------------------------------------------------------
# Validation errors -> 422 (never a refusal).
# --------------------------------------------------------------------------

@app.exception_handler(AdapterValidationError)
async def _validation_handler(_: Request, exc: AdapterValidationError) -> JSONResponse:
    # A client/form error, categorically distinct from a legal refusal (200).
    return JSONResponse(status_code=422, content=exc.to_dict())


# --------------------------------------------------------------------------
# Helpers.
# --------------------------------------------------------------------------

def _extract_blocks(docx_path) -> List[Dict[str, str]]:
    """Structured, editable blocks from the rendered document — one per non-empty
    paragraph. Keeps inline editing possible (decision #3) while the .docx is the
    filing artifact. Both carry the banners; the banners are paragraphs too, so
    they appear in the blocks exactly as in the docx (not a rendering detail)."""
    from ..components.render import extract_text
    text = extract_text(docx_path)
    blocks: List[Dict[str, str]] = []
    for i, line in enumerate(text.splitlines()):
        if line.strip():
            blocks.append({"key": f"p{i}", "text": line})
    return blocks


async def _render_generated(
    *,
    doc_type: str,
    result: Any,
    matter: Any,
    want_render: bool,
    language: str = "EN",
    template: Optional[Tuple[Any, str, int]] = None,
    banner_in_document: bool = True,
) -> Dict[str, Any]:
    """Shape a NON-refused build result into the `generated` wire payload, rendering
    the .docx when `want_render`. Factored out of `draft` so the bundle endpoint can
    render each document in the bundle through the exact same path (banner, marker,
    template-version, blocks, base64) — one renderer, many docs.

    `template` = (template file, template_id, version) for a doc type that is not in
    the registry (a request-supplied format, /v1/draft-spec); otherwise resolved
    from the doc type as before."""
    context = result.context
    signals = {
        "review_banner": signoff.banner_for(
            context, document=doc_type, factsheet=matter),
        "unverified_marker": context.get("unverified_marker", ""),
    }
    unfilled = signoff.unfilled_slots(context)

    if template is not None:
        template_file, template_id, template_version = template
    else:
        from .template_version import resolve as _resolve_template_version
        template_file = _template_for(doc_type)
        template_id, template_version = _resolve_template_version(template_file)

    out: Dict[str, Any] = {
        "outcome": "generated",
        "doc_type": doc_type,
        "signals": signals,
        "unfilled_slots": unfilled,
        "template_id": template_id,
        "template_version": template_version,
    }
    if want_render:
        import tempfile
        from pathlib import Path
        from ..components.render import render_to_docx
        ctx = signoff.resolve_context(context, document=doc_type, factsheet=matter)
        # The caller (the Node app) can keep the review banner OUT of the document
        # text and show draft status in its own UI. signals.review_banner above is
        # still reported, and sign-off rules (unfilled slots) are unchanged.
        if not banner_in_document:
            ctx["review_banner"] = ""
        # The "[figures unverified — pending advocate review]" line is a status
        # note, not pleading text: keep it out of the filed document. It is still
        # reported in signals.unverified_marker for the app to show if it wants.
        # Only that line — an imported format's "not yet approved" marker uses the
        # same slot and must stay.
        from ..verify.tables import UNVERIFIED_MARKER
        if ctx.get("unverified_marker") == UNVERIFIED_MARKER:
            ctx["unverified_marker"] = ""
        tmp = Path(tempfile.gettempdir()) / f"lexdraft_{doc_type}_{matter.matter_id}.docx"
        await run_in_threadpool(render_to_docx, template_file, ctx, tmp)
        # Served copy only: collapse blank-paragraph gaps, Indian dd.mm.yyyy dates.
        from .tidy import tidy_docx
        await run_in_threadpool(tidy_docx, tmp)
        # TAMIL / HINDI OUTPUT (proof, vakalatnama): translate the produced .docx IN
        # PLACE so the exact layout/tables are preserved and only the words change.
        # Only when the caller asked for TA/HI; EN is the untouched default.
        # Glossary-based + offline (see components/tamil.py, components/hindi.py).
        # Extending to more forms = more glossary entries in the matching module.
        lang_upper = str(language).upper()
        if lang_upper in ("TA", "TAMIL"):
            from ..components.tamil import translate_docx_to_tamil
            await run_in_threadpool(translate_docx_to_tamil, tmp)
        elif lang_upper in ("HI", "HINDI"):
            from ..components.hindi import translate_docx_to_hindi
            await run_in_threadpool(translate_docx_to_hindi, tmp)
        out["blocks"] = _extract_blocks(tmp)
        out["docx_base64"] = base64.b64encode(tmp.read_bytes()).decode("ascii")
    return out


def _refusal_payload(doc_type: str, result: Any, adapter: Any) -> Dict[str, Any]:
    """The `refused` wire payload for a build result (shared by draft + bundle)."""
    refusal: Optional[Refusal] = getattr(result, "refusal", None)
    payload: Dict[str, Any] = {"outcome": "refused", "doc_type": doc_type}
    if refusal is not None:
        payload["refusal"] = adapter.refusal_to_wire(refusal)
    else:  # should not happen post-Phase-1, but never leak a bare 500
        payload["refusal"] = {"code": "uncoded_refusal", "severity": "hard",
                              "reason": getattr(result, "reason", ""),
                              "fields_implicated": []}
    return payload


def _matter_from_request(matter: Dict[str, Any]):
    """Build a MatterFactSheet stand-in from the request's matter identity.

    The Node side owns the real fact sheet; here we only need its (matter_id,
    version) for sign-off keying/staleness, so we accept them directly and wrap
    them in a minimal object exposing those two attributes.
    """
    class _MatterRef:
        def __init__(self, matter_id: str, version: int):
            self.matter_id = matter_id
            self.version = version
    mid = matter.get("matter_id")
    ver = matter.get("version")
    if not isinstance(mid, str) or not mid.strip():
        raise HTTPException(status_code=422, detail={
            "error": "validation",
            "issues": [{"field": "matter.matter_id", "code": "required",
                        "message": "matter_id is required"}]})
    if not isinstance(ver, int):
        raise HTTPException(status_code=422, detail={
            "error": "validation",
            "issues": [{"field": "matter.version", "code": "required",
                        "message": "version is required (integer)"}]})
    return _MatterRef(mid, ver)


# --------------------------------------------------------------------------
# Routes.
# --------------------------------------------------------------------------

@app.get("/healthz")
async def healthz() -> Dict[str, Any]:
    return {"ok": True, "doc_types": [a.doc_type for a in adapters.all_adapters()]}


@app.get("/v1/doc-types")
async def doc_types(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    _check_token(authorization)
    return {"doc_types": [a.describe() for a in adapters.all_adapters()]}


@app.post("/v1/draft/{doc_type}")
async def draft(doc_type: str, body: Dict[str, Any],
                authorization: Optional[str] = Header(default=None)) -> JSONResponse:
    _check_token(authorization)
    try:
        adapter = adapters.get_adapter(doc_type)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown doc_type {doc_type!r}")

    matter = _matter_from_request(body.get("matter") or {})
    fields = body.get("fields") or {}
    slots = body.get("slots") or {}
    want_render = body.get("render", True)
    language = body.get("language", "EN")

    # 1. VALIDATE + COERCE (the 422 boundary). Raises AdapterValidationError -> 422
    #    via the handler above, BEFORE the pipeline is ever called.
    kwargs = adapter.coerce(fields, allow_placeholders=bool(body.get("allow_placeholders")))
    # Narrative slots (model-drafted prose) are merged in as-is; a slot the caller
    # omits stays the pipeline's own [to be drafted] placeholder.
    for slot_key, slot_val in slots.items():
        if slot_key in adapter.slots and isinstance(slot_val, str):
            kwargs[slot_key] = slot_val

    # 2. BUILD (engine work -> threadpool). Contradictory custody dates (the "as on"
    #    date before custody began) are a client input problem: 422 on as_on, not a 500.
    from ..rules.custody_computation import CustodyInputError
    try:
        result = await run_in_threadpool(adapter.build, **kwargs)
    except CustodyInputError as err:
        raise adapters.AdapterValidationError([adapters.FieldIssue(
            field="as_on", code="malformed",
            message=f"The 'as on' date must be on or after the custody start date ({err}).")])

    # 3. REFUSAL -> 200 with outcome:"refused" (a legal finding, not an error).
    if getattr(result, "refused", False):
        return JSONResponse(status_code=200,
                            content=_refusal_payload(doc_type, result, adapter))

    # 4. GENERATED -> render (banner + marker resolved via sign-off state).
    out = await _render_generated(
        doc_type=doc_type, result=result, matter=matter, want_render=want_render,
        language=language,
        banner_in_document=body.get("review_banner_in_document", True) is not False)
    return JSONResponse(status_code=200, content=out)


@app.post("/v1/draft-bundle/s138_complaint")
async def draft_bundle_s138(body: Dict[str, Any],
                            authorization: Optional[str] = Header(default=None)) -> JSONResponse:
    """Build the s.138 complaint AND its supporting proof affidavit in one call.

    The complaint is the source of truth: it is built and (if legal) its context is
    handed to `s138_affidavit_from_complaint.build_affidavit_kwargs`, which derives
    the first-person affidavit — no fact is re-keyed. The affidavit pipeline then
    re-runs the same s.138 window hard stops on the same facts, so the two documents
    can never disagree.

    Response `outcome`:
      * "refused"   — the COMPLAINT was legally blocked; no affidavit is attempted.
      * "generated" — { complaint, affidavit } each in the single-doc `generated`
                       shape. If the affidavit refuses (it should not, given the
                       complaint built), `affidavit` carries outcome:"refused".

    `fields` is the SAME payload the single complaint endpoint takes, plus the
    deponent particulars the complaint does not carry, under `affidavit`:
      affidavit.deponent_age (int, required), affidavit.deponent_occupation (str,
      required), affidavit.attestor (str, required), and optional
      affidavit.authority_ref / affidavit.affirm_date.
    """
    _check_token(authorization)
    from ..pipelines import s138_affidavit_from_complaint as derive
    from datetime import date as _date

    matter = _matter_from_request(body.get("matter") or {})
    fields = body.get("fields") or {}
    slots = body.get("slots") or {}
    want_render = body.get("render", True)
    aff_in = body.get("affidavit") or {}

    complaint_adapter = adapters.get_adapter("s138_complaint")
    affidavit_adapter = adapters.get_adapter("affidavit")

    # --- 1. Build the complaint (same 422 boundary + slots merge as /v1/draft) ---
    kwargs = complaint_adapter.coerce(fields)
    for slot_key, slot_val in slots.items():
        if slot_key in complaint_adapter.slots and isinstance(slot_val, str):
            kwargs[slot_key] = slot_val
    complaint_result = await run_in_threadpool(complaint_adapter.build, **kwargs)

    # Complaint refused -> the whole bundle is that refusal; no affidavit attempted.
    if getattr(complaint_result, "refused", False):
        return JSONResponse(status_code=200, content={
            "outcome": "refused",
            "for": "s138_complaint",
            **_refusal_payload("s138_complaint", complaint_result, complaint_adapter),
        })

    # --- 2. Deponent particulars for the affidavit (422 if missing/mistyped) ----
    issues: List[Dict[str, str]] = []
    dep_age = aff_in.get("deponent_age")
    dep_occ = aff_in.get("deponent_occupation")
    attestor = aff_in.get("attestor")
    if not isinstance(dep_age, int) or isinstance(dep_age, bool):
        issues.append({"field": "affidavit.deponent_age", "code": "required",
                       "message": "deponent_age is required (integer)"})
    if not isinstance(dep_occ, str) or not dep_occ.strip():
        issues.append({"field": "affidavit.deponent_occupation", "code": "required",
                       "message": "deponent_occupation is required"})
    if not isinstance(attestor, str) or not attestor.strip():
        issues.append({"field": "affidavit.attestor", "code": "required",
                       "message": "attestor is required"})
    affirm_raw = aff_in.get("affirm_date")
    affirm_date = None
    if affirm_raw is not None:
        try:
            affirm_date = _date.fromisoformat(str(affirm_raw))
        except ValueError:
            issues.append({"field": "affidavit.affirm_date", "code": "malformed",
                           "message": f"'{affirm_raw}' is not an ISO date (YYYY-MM-DD)"})
    if issues:
        return JSONResponse(status_code=422,
                            content={"error": "validation", "issues": issues})

    # --- 3. Derive affidavit kwargs FROM the built complaint, then build it -----
    aff_kwargs = derive.build_affidavit_kwargs(
        complaint_result.context,
        deponent_age=dep_age,
        deponent_occupation=dep_occ,
        attestor=attestor,
        authority_ref=aff_in.get("authority_ref"),
        affirm_date=affirm_date,
    )
    affidavit_result = await run_in_threadpool(affidavit_adapter.build, **aff_kwargs)

    # --- 4. Shape both documents through the shared renderer --------------------
    banner_in_doc = body.get("review_banner_in_document", True) is not False
    complaint_out = await _render_generated(
        doc_type="s138_complaint", result=complaint_result,
        matter=matter, want_render=want_render, banner_in_document=banner_in_doc)

    if getattr(affidavit_result, "refused", False):
        affidavit_out = _refusal_payload("affidavit", affidavit_result, affidavit_adapter)
    else:
        affidavit_out = await _render_generated(
            doc_type="affidavit", result=affidavit_result,
            matter=matter, want_render=want_render, banner_in_document=banner_in_doc)

    return JSONResponse(status_code=200, content={
        "outcome": "generated",
        "bundle": "s138_complaint",
        "complaint": complaint_out,
        "affidavit": affidavit_out,
    })


def _template_for(doc_type: str) -> str:
    """The .docx template filename for a doc type.

    Prefer the adapter's declared `template` (doc types whose build() lives in a
    shared module have no 1:1 pipeline module); fall back to the pipeline module's
    own `TEMPLATE` for the doc types where doc_type == module name.
    """
    from .adapters import get_adapter
    try:
        adapter = get_adapter(doc_type)
        if adapter.template:
            return adapter.template
    except KeyError:
        pass
    import importlib
    mod = importlib.import_module(f"src.pipelines.{doc_type}")
    return mod.TEMPLATE


@app.post("/v1/route-code")
async def route_code(body: Dict[str, Any],
                     authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """dual_code_router only — resolve the procedural framework + cited sections,
    or refuse (unknown provenance). Cheap; the clarify loop calls this."""
    _check_token(authorization)
    from datetime import date
    from ..rules import dual_code_router as router

    def _d(v):
        return date.fromisoformat(v) if isinstance(v, str) and v else None

    routed = await run_in_threadpool(
        router.route,
        offence_date=_d(body.get("offence_date")),
        proceeding_start_date=_d(body.get("proceeding_start_date")),
        is_fresh_action=bool(body.get("is_fresh_action", False)),
    )
    if routed.refused:
        return {"outcome": "refused", "refusal": routed.refusal.to_dict()}
    return {
        "outcome": "resolved",
        "code_framework": routed.code_framework,
        "substantive": routed.substantive.value,
        "computation": routed.computation,
    }


@app.post("/v1/sign-off")
async def sign_off(body: Dict[str, Any],
                   authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Mark a rendered document final. Records who/when/version in the audit trail.
    Refuses (409) a document with an unfilled slot, or (422) a missing reviewer."""
    _check_token(authorization)
    matter = _matter_from_request(body.get("matter") or {})
    document = body.get("document")
    reviewer = body.get("reviewer", "")
    signed_on = body.get("signed_on", "")
    context = body.get("context") or {}
    if not isinstance(document, str) or not document:
        raise HTTPException(status_code=422, detail={
            "error": "validation",
            "issues": [{"field": "document", "code": "required",
                        "message": "document is required"}]})
    try:
        rec = await run_in_threadpool(
            signoff.sign_off, document=document, factsheet=matter,
            reviewer=reviewer, signed_on=signed_on, context=context,
        )
    except signoff.SignOffError as exc:
        # A sign-off the RULES forbid (unfilled slot / missing reviewer) — a
        # conflict with the document's state, not a legal refusal of a draft.
        raise HTTPException(status_code=409, detail={"error": "signoff_refused",
                                                     "message": str(exc)})
    return {"outcome": "signed_off", "document": rec.document,
            "matter_id": rec.matter_id, "version": rec.version,
            "reviewer": rec.reviewer, "signed_on": rec.signed_on}


# --------------------------------------------------------------------------
# A firm's OWN uploaded format. The Node API stores the spec per firm and sends
# it with each call; the engine stays stateless (src/imports/runtime_spec.py).
# --------------------------------------------------------------------------

def _spec_from_body(body: Dict[str, Any], *, default_status: str):
    from ..imports import manifest as mf
    from ..imports import runtime_spec
    doc_type = body.get("doc_type")
    if not isinstance(doc_type, str) or not mf.SLUG_RE.match(doc_type):
        raise HTTPException(status_code=422, detail={
            "error": "validation",
            "issues": [{"field": "doc_type", "code": "malformed",
                        "message": "doc_type must be snake_case (3-61 chars)"}]})
    if doc_type in {a.doc_type for a in adapters.all_adapters()}:
        raise HTTPException(status_code=422, detail={
            "error": "validation",
            "issues": [{"field": "doc_type", "code": "malformed",
                        "message": "doc_type collides with a built-in doc type"}]})
    spec, entry, problems = runtime_spec.entry_for(
        doc_type, body.get("spec"), status=body.get("status", default_status),
        source_kind=body.get("source_kind", "advocate"), version=body.get("version", 1))
    return doc_type, spec, entry, problems


@app.get("/v1/format-spec/contract")
async def format_spec_contract(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Everything the API's transcriber needs to turn a source format into a spec
    this engine accepts — kept here so the engine owns the contract."""
    _check_token(authorization)
    from ..imports import context as import_ctx
    from ..imports.builder import BLOCK_STYLES
    from ..imports.manifest import FIELD_KINDS
    from ..imports.transcribe import SPEC_SCHEMA, SYSTEM_PROMPT
    return {
        "system_prompt": SYSTEM_PROMPT,
        "schema": SPEC_SCHEMA,
        "existing": [[slug, title] for slug, title in import_ctx.existing_doc_types()],
        "common_keys": import_ctx.common_keys(),
        "block_styles": list(BLOCK_STYLES),
        "field_kinds": list(FIELD_KINDS),
    }


@app.post("/v1/format-spec/check")
async def format_spec_check(body: Dict[str, Any],
                            authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Validate a spec and render it with sample data. 200 either way: `ok` says
    whether it can be saved; `problems` lists what to fix; `preview` is the
    rendered text (one line per paragraph) the advocate reviews before saving."""
    _check_token(authorization)
    from ..components.render import extract_text, render_to_docx
    from ..imports import runtime_spec
    from .adapters.imported import adapter_for, sample_payload

    doc_type, spec, entry, problems = _spec_from_body(body, default_status="pending_review")
    if problems:
        return {"ok": False, "doc_type": doc_type, "problems": problems, "spec": spec}

    def _preview() -> List[str]:
        import tempfile
        from pathlib import Path
        adapter = adapter_for(doc_type, entry)
        ctx = dict(adapter.build(**adapter.coerce(sample_payload(entry))).context)
        ctx["review_banner"] = ""
        ctx["unverified_marker"] = ""
        with tempfile.TemporaryDirectory() as tmp:
            out = render_to_docx(runtime_spec.template_for(spec), ctx, Path(tmp) / "preview.docx")
            return [line for line in extract_text(out).splitlines()]

    try:
        preview = await run_in_threadpool(_preview)
    except Exception as exc:  # a spec that passes validation but won't render
        return {"ok": False, "doc_type": doc_type, "spec": spec,
                "problems": [f"preview render failed: {type(exc).__name__}: {exc}"]}
    leftovers = [l for l in preview if "{{" in l or "{%" in l]
    if leftovers:
        return {"ok": False, "doc_type": doc_type, "spec": spec,
                "problems": [f"unrendered template text: {l}" for l in leftovers]}
    return {"ok": True, "doc_type": doc_type, "problems": [], "spec": spec,
            "describe": adapter_for(doc_type, entry).describe(),
            "sample": sample_payload(entry), "preview": preview}


@app.post("/v1/draft-spec")
async def draft_spec(body: Dict[str, Any],
                     authorization: Optional[str] = Header(default=None)) -> JSONResponse:
    """Draft from a request-supplied spec. Same contract as /v1/draft/{doc_type}:
    422 for an invalid spec or missing required facts, 200 generated otherwise."""
    _check_token(authorization)
    from ..imports import runtime_spec
    from .adapters.imported import adapter_for

    doc_type, spec, entry, problems = _spec_from_body(body, default_status="approved")
    if problems:
        return JSONResponse(status_code=422, content={"error": "invalid_spec", "problems": problems})
    matter = _matter_from_request(body.get("matter") or {})
    adapter = adapter_for(doc_type, entry)
    kwargs = adapter.coerce(body.get("fields") or {},   # 422 via the handler
                            allow_placeholders=bool(body.get("allow_placeholders")))
    result = await run_in_threadpool(adapter.build, **kwargs)
    template_file = await run_in_threadpool(runtime_spec.template_for, spec)
    out = await _render_generated(
        doc_type=doc_type, result=result, matter=matter,
        want_render=body.get("render", True), language=body.get("language", "EN"),
        banner_in_document=body.get("review_banner_in_document", True) is not False,
        template=(template_file, f"spec:{runtime_spec.spec_hash(spec)[:16]}", entry["version"]))
    return JSONResponse(status_code=200, content=out)


# --------------------------------------------------------------------------
# Blank forms (Draft page "Download blank (Word)") — src/service/blank.py.
# --------------------------------------------------------------------------

@app.post("/v1/blank")
async def blank_form(body: Dict[str, Any],
                     authorization: Optional[str] = Header(default=None)) -> JSONResponse:
    """Render a doc type (or a request-supplied firm spec) as a blank, editable
    form. 200 {docx_base64, blocks}; 409 when the format can't be produced
    without real facts (the UI then offers "Draft this"); 404 unknown doc type."""
    _check_token(authorization)
    import tempfile
    from pathlib import Path
    from ..components.render import render_to_docx
    from ..imports import runtime_spec
    from . import blank
    from .adapters.imported import adapter_for

    preset = body.get("preset") or {}
    if not isinstance(preset, dict):
        preset = {}
    if body.get("spec") is not None:
        doc_type, spec, entry, problems = _spec_from_body(body, default_status="approved")
        if problems:
            return JSONResponse(status_code=422, content={"error": "invalid_spec", "problems": problems})
        adapter = adapter_for(doc_type, entry)
        template_file = await run_in_threadpool(runtime_spec.template_for, spec)
    else:
        doc_type = body.get("doc_type")
        try:
            adapter = adapters.get_adapter(str(doc_type))
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown doc_type {doc_type!r}")
        template_file = _template_for(adapter.doc_type)

    # The pipeline's legal checks need real facts; on stand-ins they can refuse
    # (no offence date, shares not totalling 100%…). A blank form has no facts to
    # check, so fall back to rendering the template alone with fill-in lines.
    refused_reason: Optional[str] = None
    try:
        ctx = await run_in_threadpool(blank.blank_context, adapter, preset)
    except blank.BlankRefused as exc:
        refused_reason = str(exc)
        ctx = blank.fallback_context(adapter, preset)

    from .tidy import tidy_docx

    def _render() -> Dict[str, Any]:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "blank.docx"
            render_to_docx(template_file, ctx, out,
                           jinja_env=blank.lenient_env() if refused_reason else None)
            blank.scrub_sentinels(out)
            tidy_docx(out)
            return {"docx_base64": base64.b64encode(out.read_bytes()).decode("ascii"),
                    "blocks": _extract_blocks(out)}

    try:
        payload = await run_in_threadpool(_render)
    except Exception:
        if refused_reason is None:
            raise
        return JSONResponse(status_code=409, content={"error": "needs_facts", "reason": refused_reason})
    return JSONResponse(status_code=200, content={"doc_type": adapter.doc_type, **payload})


@app.get("/v1/lawe-catalog")
async def lawe_catalog(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """The LAWE forms library (templates/imported/lawe_catalog.json): each form's
    site title, original-PDF link, the doc type that drafts it here, and the
    variant preset (e.g. a warrant's kind). Forms whose doc type this engine
    doesn't serve (an unapproved import in production) are left out."""
    _check_token(authorization)
    from ..imports import lawe
    served = {a.doc_type for a in adapters.all_adapters()}
    forms: List[Dict[str, Any]] = []
    for fid, c in sorted(lawe.load_catalog()["forms"].items()):
        doc_type = c.get("doc_type")
        if c.get("status") == "not_a_format" or doc_type not in served:
            continue
        folder, _, filename = fid.partition("/")
        forms.append({
            "id": fid,
            "title": lawe.title_of(filename),
            "group": folder.replace("_", " "),
            "url": lawe.form_url(folder, filename),
            "doc_type": doc_type,
            "preset": c.get("preset") or {},
        })
    return {"source": "LAWE (lawe.co.in)", "forms": forms}


@app.post("/v1/apply-edits")
async def apply_text_edits(body: Dict[str, Any],
                           authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Put the advocate's edited paragraphs back into the engine .docx so the
    download keeps the court layout. matched=false (no docx) when paragraphs were
    added/removed — the caller then uses its generic export."""
    _check_token(authorization)
    from .apply_edits import apply_edits
    raw = body.get("docx_base64")
    paras = body.get("paragraphs")
    if not isinstance(raw, str) or not isinstance(paras, list) or not all(isinstance(p, str) for p in paras):
        raise HTTPException(status_code=422, detail={"error": "validation", "issues": [
            {"field": "paragraphs", "code": "type", "message": "docx_base64 + paragraphs[] required"}]})
    try:
        src = base64.b64decode(raw, validate=True)
    except ValueError:
        raise HTTPException(status_code=422, detail="docx_base64 is not valid base64")
    out = await run_in_threadpool(apply_edits, src, paras)
    if out is None:
        return {"matched": False}
    return {"matched": True, "docx_base64": base64.b64encode(out).decode("ascii")}


@app.post("/v1/splice-lines")
async def splice_text_lines(body: Dict[str, Any],
                            authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Replace display lines [start, end] of an engine .docx with new paragraphs
    (a composed body), keeping the rest of the court layout. matched=false when
    the range can't be mapped — the caller keeps the plain engine draft."""
    _check_token(authorization)
    from .apply_edits import splice_lines
    raw = body.get("docx_base64")
    paras = body.get("paragraphs")
    start, end = body.get("start"), body.get("end")
    if (not isinstance(raw, str) or not isinstance(paras, list)
            or not all(isinstance(p, str) for p in paras)
            or not isinstance(start, int) or not isinstance(end, int)):
        raise HTTPException(status_code=422, detail={"error": "validation", "issues": [
            {"field": "paragraphs", "code": "type",
             "message": "docx_base64 + start + end + paragraphs[] required"}]})
    try:
        src = base64.b64decode(raw, validate=True)
    except ValueError:
        raise HTTPException(status_code=422, detail="docx_base64 is not valid base64")
    out = await run_in_threadpool(splice_lines, src, start, end, paras)
    if out is None:
        return {"matched": False}
    return {"matched": True, "docx_base64": base64.b64encode(out).decode("ascii")}
