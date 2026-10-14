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

The engine is synchronous CPU work; every engine call runs in a threadpool so the
event loop stays free. The Node API is the only public surface — this service
trusts a shared token and never faces the browser.
"""

from __future__ import annotations

import base64
import io
from typing import Any, Dict, List, Optional

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
) -> Dict[str, Any]:
    """Shape a NON-refused build result into the `generated` wire payload, rendering
    the .docx when `want_render`. Factored out of `draft` so the bundle endpoint can
    render each document in the bundle through the exact same path (banner, marker,
    template-version, blocks, base64) — one renderer, many docs."""
    context = result.context
    signals = {
        "review_banner": signoff.banner_for(
            context, document=doc_type, factsheet=matter),
        "unverified_marker": context.get("unverified_marker", ""),
    }
    unfilled = signoff.unfilled_slots(context)

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
        tmp = Path(tempfile.gettempdir()) / f"lexdraft_{doc_type}_{matter.matter_id}.docx"
        await run_in_threadpool(render_to_docx, template_file, ctx, tmp)
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
    kwargs = adapter.coerce(fields)
    # Narrative slots (model-drafted prose) are merged in as-is; a slot the caller
    # omits stays the pipeline's own [to be drafted] placeholder.
    for slot_key, slot_val in slots.items():
        if slot_key in adapter.slots and isinstance(slot_val, str):
            kwargs[slot_key] = slot_val

    # 2. BUILD (engine work -> threadpool).
    result = await run_in_threadpool(adapter.build, **kwargs)

    # 3. REFUSAL -> 200 with outcome:"refused" (a legal finding, not an error).
    if getattr(result, "refused", False):
        return JSONResponse(status_code=200,
                            content=_refusal_payload(doc_type, result, adapter))

    # 4. GENERATED -> render (banner + marker resolved via sign-off state).
    out = await _render_generated(
        doc_type=doc_type, result=result, matter=matter, want_render=want_render,
        language=language)
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
    complaint_out = await _render_generated(
        doc_type="s138_complaint", result=complaint_result,
        matter=matter, want_render=want_render)

    if getattr(affidavit_result, "refused", False):
        affidavit_out = _refusal_payload("affidavit", affidavit_result, affidavit_adapter)
    else:
        affidavit_out = await _render_generated(
            doc_type="affidavit", result=affidavit_result,
            matter=matter, want_render=want_render)

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
