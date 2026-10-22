"""Import drafting formats into the engine — from the LAWE site or an advocate's own file.

An imported format becomes a data-driven doc type (templates/imported/: a .docx
template + a manifest entry). It is drafted from case content exactly like a
built-in doc type — the intake reads its fields from GET /v1/doc-types — and every
draft carries an "imported format, not yet approved" marker until `approve`.

Usage (from lexdraft-engine/, with `pip install -e ".[import]"`):

    python tools/import_format.py lawe-status
        What the LAWE site lists vs what the engine covers.
    python tools/import_format.py lawe-import [--only "<Folder>/<File>.pdf"] [--dry-run]
        Transcribe + import every LAWE form the engine does not already cover.
    python tools/import_format.py file PATH [--title T] [--slug S] [--force-new]
        Import an advocate's own format (PDF, scan/photo PNG/JPG, DOCX, TXT).
    python tools/import_format.py list
    python tools/import_format.py show SLUG
    python tools/import_format.py approve SLUG --reviewer "Adv. Name"
    python tools/import_format.py rebuild SLUG [--force]
        Rebuild the template from templates/imported/specs/SLUG.json (after a hand fix).
    python tools/import_format.py remove SLUG
    python tools/import_format.py sync
        Refresh the imported entries in the Node contract snapshot + alignment baseline.

After an import/approve/remove, restart the stack (`pnpm dev`) so the engine and API
pick the change up.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.imports import builder, lawe  # noqa: E402
from src.imports import manifest as mf  # noqa: E402
from src.imports.context import builtin_adapters as _builtin_adapters  # noqa: E402
from src.imports.context import common_keys as _common_keys  # noqa: E402
from src.imports.context import existing_doc_types as _existing_doc_types  # noqa: E402
from src.service import adapters  # noqa: E402
from src.service.adapters import imported  # noqa: E402

CACHE_DIR = ROOT / ".import-cache"   # downloaded sources; never committed


def _taken() -> tuple:
    slugs = {slug for slug, _ in _existing_doc_types()}
    titles = {title.strip().lower() for _, title in _existing_doc_types()}
    return slugs, titles


def _unique_slug(raw: str) -> str:
    slug = re.sub(r"[^a-z0-9_]+", "_", raw.strip().lower()).strip("_")
    if not slug or not slug[0].isalpha():
        slug = "imported_" + slug
    slug = slug[:55]
    slugs, _ = _taken()
    base, n = slug, 2
    while slug in slugs or len(slug) < 3:
        slug = f"{base}_{n}"
        n += 1
    return slug


def _unique_title(raw: str) -> str:
    _, titles = _taken()
    title, n = raw.strip(), 2
    while title.lower() in titles:
        title = f"{raw.strip()} ({n})"
        n += 1
    return title


# --------------------------------------------------------------------------
# Import one source
# --------------------------------------------------------------------------

def import_source(path: Path, *, source_kind: str, source_ref: str, hint_title: str = "",
                  slug: Optional[str] = None, title: Optional[str] = None,
                  force_new: bool = False, dry_run: bool = False,
                  model: str = "") -> Dict[str, Any]:
    """Transcribe `path` and, unless it duplicates an existing doc type, add it.

    Returns {"outcome": imported|equivalent|not_a_format|invalid|dry_run, ...}.
    """
    from src.imports.transcribe import DEFAULT_MODEL, transcribe

    existing = _existing_doc_types()
    spec = transcribe(path, existing=existing, common_keys=_common_keys(),
                      hint_title=hint_title, model=model or DEFAULT_MODEL)

    if not spec.get("is_legal_format", True):
        return {"outcome": "not_a_format", "summary": spec.get("summary", "")}
    equivalent = (spec.get("equivalent_existing_doc_type") or "").strip()
    if equivalent and equivalent in {s for s, _ in existing} and not force_new:
        return {"outcome": "equivalent", "doc_type": equivalent,
                "summary": spec.get("summary", "")}

    spec["slug"] = _unique_slug(slug or spec.get("slug") or path.stem)
    spec["title"] = _unique_title(title or spec.get("title") or path.stem.replace("_", " "))
    problems = builder.check_spec(spec)
    mf.SPECS_DIR.mkdir(parents=True, exist_ok=True)
    spec_file = mf.SPECS_DIR / f"{spec['slug']}.json"
    if problems:
        spec_file = spec_file.with_suffix(".rejected.json")
        spec_file.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return {"outcome": "invalid", "slug": spec["slug"], "problems": problems,
                "spec_file": str(spec_file)}
    if dry_run:
        return {"outcome": "dry_run", "slug": spec["slug"], "title": spec["title"],
                "fields": [f["key"] for f in spec["fields"]], "summary": spec.get("summary", "")}

    source = {"kind": source_kind, "ref": source_ref,
              "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "imported_on": date.today().isoformat()}
    result = _install(spec, source=source, force=False)
    if result["outcome"] == "imported":
        spec_file.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def _entry_from_spec(spec: Dict[str, Any], *, source: Dict[str, Any], version: int) -> Dict[str, Any]:
    fields = []
    for f in spec["fields"]:
        out = {k: f[k] for k in ("key", "kind", "required", "label", "help") if k in f}
        if f["kind"] == "enum":
            out["enum_values"] = list(f.get("enum_values") or [])
        out["sample"] = f.get("sample", "")
        fields.append(out)
    return {
        "title": spec["title"],
        "status": "pending_review",
        "version": version,
        "template": f"{spec['slug']}.docx",
        "court_issued": bool(spec.get("court_issued")),
        "fields": fields,
        "source": source,
        "summary": spec.get("summary", ""),
        "review_notes": {"law_updates": spec.get("law_updates", []),
                         "corrections": spec.get("corrections", []),
                         "uncertain": spec.get("uncertain", [])},
        "approved_by": None,
        "approved_on": None,
    }


def _install(spec: Dict[str, Any], *, source: Dict[str, Any], force: bool,
             version: int = 1) -> Dict[str, Any]:
    """Build the template, smoke-render it, then record the manifest entry."""
    slug = spec["slug"]
    template_file = mf.IMPORTED_DIR / f"{slug}.docx"
    if template_file.exists() and not force:
        return {"outcome": "invalid", "slug": slug,
                "problems": [f"{template_file.name} already exists (use rebuild --force)"]}
    entry = _entry_from_spec(spec, source=source, version=version)
    problems = mf.validate_entry(slug, entry)
    if not problems:
        builder.build_docx(spec, template_file)
        problems = builder.smoke_render(slug, entry, template_file)
        if problems:
            template_file.unlink(missing_ok=True)
    if problems:
        return {"outcome": "invalid", "slug": slug, "problems": problems}
    data = mf.load_manifest()
    data["doc_types"][slug] = entry
    mf.save_manifest(data)
    return {"outcome": "imported", "slug": slug, "title": entry["title"],
            "fields": [f["key"] for f in entry["fields"]], "review_notes": entry["review_notes"]}


# --------------------------------------------------------------------------
# Node-side sync (contract snapshot + alignment baseline)
# --------------------------------------------------------------------------

def _monorepo() -> Optional[Path]:
    env = os.environ.get("LEXDRAFT_MONOREPO")
    candidates = [Path(env)] if env else []
    candidates += [ROOT.parent / "LexDraft", ROOT.parent]
    for c in candidates:
        if (c / "packages" / "types" / "src" / "data" / "engine-doc-contract.json").exists():
            return c
    return None


def _read_json(path: Path) -> tuple:
    raw = path.read_bytes()
    return json.loads(raw.decode("utf-8")), b"\r\n" in raw


def _write_json(path: Path, data: Any, crlf: bool) -> None:
    # Same serialisation the committed files use (insertion order, ASCII-escaped).
    text = json.dumps(data, indent=2, ensure_ascii=True) + "\n"
    if crlf:
        text = text.replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


def sync() -> List[str]:
    """Upsert imported formats into the Node snapshot + baseline. Only entries
    tagged `imported` are touched; every built-in entry stays byte-identical.

    Pending formats are included too: the API lists a format only when the LIVE
    engine serves it, so production (which hides pending formats) never shows them."""
    from tools.dump_engine_contract import contract_entry

    repo = _monorepo()
    if repo is None:
        return ["monorepo not found (set LEXDRAFT_MONOREPO) — Node snapshot not updated"]
    served = {slug: entry for slug, entry in sorted(mf.load_manifest()["doc_types"].items())
              if not mf.validate_entry(slug, entry)
              and (mf.IMPORTED_DIR / entry["template"]).exists()}
    builtin = {a.doc_type for a in _builtin_adapters()}
    served = {s: e for s, e in served.items() if s not in builtin}

    contract_path = repo / "packages" / "types" / "src" / "data" / "engine-doc-contract.json"
    contract, crlf = _read_json(contract_path)
    old_titles = {v.get("title") for v in contract.values() if isinstance(v, dict) and v.get("imported")}
    kept = {k: v for k, v in contract.items() if not (isinstance(v, dict) and v.get("imported"))}
    for slug, entry in served.items():
        kept[slug] = contract_entry(imported.adapter_for(slug, entry))
    contract = {k: kept[k] for k in sorted(kept)}
    _write_json(contract_path, contract, crlf)

    baseline_path = repo / "apps" / "api" / "src" / "lib" / "__tests__" / "engine-alignment-baseline.json"
    notes = [f"updated {contract_path.relative_to(repo)} ({len(served)} imported)"]
    if baseline_path.exists():
        baseline, crlf = _read_json(baseline_path)
        new_titles = {e["title"].strip() for e in served.values()}
        labels = [l for l in baseline.get("unreachableLabels", []) if l not in old_titles - new_titles]
        labels = sorted(set(labels) | new_titles)
        baseline["unreachableLabels"] = labels
        _write_json(baseline_path, baseline, crlf)
        notes.append(f"updated {baseline_path.relative_to(repo)}")
    return notes


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def _print_result(name: str, r: Dict[str, Any]) -> None:
    o = r["outcome"]
    if o == "imported":
        print(f"  IMPORTED  {name} -> {r['slug']} ({r['title']}); fields: {', '.join(r['fields'])}")
        notes = r.get("review_notes") or {}
        for u in notes.get("law_updates", []):
            print(f"      law update: {u['original']} -> {u['updated']} ({u['note']})")
        for c in notes.get("corrections", []):
            print(f"      corrected: {c['original']!r} -> {c['corrected']!r}")
        for u in notes.get("uncertain", []):
            print(f"      CHECK: {u}")
    elif o == "equivalent":
        print(f"  covered   {name} -> already drafted by {r['doc_type']}")
    elif o == "not_a_format":
        print(f"  skipped   {name} -> not a drafting format")
    elif o == "dry_run":
        print(f"  would import {name} -> {r['slug']} ({r['title']}); fields: {', '.join(r['fields'])}")
    else:
        print(f"  FAILED    {name} ({r.get('slug', '?')}):")
        for p in r.get("problems", []):
            print(f"      - {p}")
        if r.get("spec_file"):
            print(f"      spec saved for a hand fix: {r['spec_file']}")


def cmd_lawe_status(_args) -> int:
    listing = lawe.fetch_listing()
    catalog = lawe.load_catalog()["forms"]
    manifest = mf.load_manifest()["doc_types"]
    known = {a.doc_type for a in adapters.all_adapters()} | set(manifest)
    counts: Counter = Counter()
    for folder, filename in listing:
        fid = lawe.form_id(folder, filename)
        c = catalog.get(fid)
        if c is None:
            state = "NEW (not yet imported)"
        elif c["status"] in ("covered", "imported") and c.get("doc_type") not in known:
            state = f"{c['status']} as {c.get('doc_type')} — MISSING from engine"
        else:
            state = f"{c['status']}" + (f" as {c['doc_type']}" if c.get("doc_type") else "")
        counts[state.split(" ")[0]] += 1
        print(f"  {fid:<75} {state}")
    print(f"\n{len(listing)} forms listed: " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
    return 0


def cmd_lawe_import(args) -> int:
    listing = lawe.fetch_listing()
    catalog = lawe.load_catalog()
    forms = catalog["forms"]
    todo = [(f, n) for f, n in listing
            if (args.only and lawe.form_id(f, n) == args.only)
            or (not args.only and lawe.form_id(f, n) not in forms)]
    if args.only and not todo:
        print(f"{args.only} is not on the LAWE listing")
        return 1
    if not todo:
        print("Nothing new on the LAWE site — every listed form is covered or imported.")
        return 0
    print(f"{len(todo)} LAWE form(s) to process:")
    failed = 0
    for folder, filename in todo:
        fid = lawe.form_id(folder, filename)
        path = lawe.download(folder, filename, CACHE_DIR / "lawe")
        try:
            r = import_source(path, source_kind="lawe", source_ref=lawe.form_url(folder, filename),
                              hint_title=lawe.title_of(filename), dry_run=args.dry_run,
                              force_new=args.force_new, model=args.model)
        except Exception as exc:
            r = {"outcome": "invalid", "problems": [f"{type(exc).__name__}: {exc}"]}
        _print_result(fid, r)
        if args.dry_run:
            continue
        if r["outcome"] == "imported":
            forms[fid] = {"status": "imported", "doc_type": r["slug"]}
        elif r["outcome"] == "equivalent":
            forms[fid] = {"status": "covered", "doc_type": r["doc_type"], "note": "classified on import"}
        elif r["outcome"] == "not_a_format":
            forms[fid] = {"status": "not_a_format"}
        else:
            failed += 1
        lawe.save_catalog(catalog)
    if not args.dry_run:
        for note in sync():
            print(note)
        print("Restart `pnpm dev` so the engine and API load the new format(s).")
    return 1 if failed else 0


def cmd_file(args) -> int:
    path = Path(args.path).resolve()
    if not path.exists():
        print(f"no such file: {path}")
        return 1
    r = import_source(path, source_kind="advocate", source_ref=path.name,
                      hint_title=args.title or "", slug=args.slug, title=args.title,
                      force_new=args.force_new, dry_run=args.dry_run, model=args.model)
    _print_result(path.name, r)
    if r["outcome"] == "imported":
        for note in sync():
            print(note)
        print("Restart `pnpm dev` so the engine and API load the new format.")
    return 0 if r["outcome"] in ("imported", "equivalent", "dry_run") else 1


def cmd_list(_args) -> int:
    entries = mf.load_manifest()["doc_types"]
    if not entries:
        print("No imported formats yet.")
    for slug, e in sorted(entries.items()):
        src = e.get("source", {})
        served = "live" if e.get("status") == "approved" else "dev only (needs approval)"
        print(f"  {slug:<40} {e['status']:<15} {served:<24} {src.get('kind', '?')}: {e['title']}")
    return 0


def cmd_show(args) -> int:
    entry = mf.load_manifest()["doc_types"].get(args.slug)
    if entry is None:
        print(f"no imported format {args.slug!r}")
        return 1
    print(json.dumps(entry, indent=2, ensure_ascii=False))
    return 0


def cmd_approve(args) -> int:
    data = mf.load_manifest()
    entry = data["doc_types"].get(args.slug)
    if entry is None:
        print(f"no imported format {args.slug!r}")
        return 1
    if not args.reviewer.strip():
        print("--reviewer is required")
        return 1
    entry["status"] = "approved"
    entry["approved_by"] = args.reviewer.strip()
    entry["approved_on"] = date.today().isoformat()
    mf.save_manifest(data)
    print(f"approved {args.slug} (reviewer: {entry['approved_by']})")
    for note in sync():
        print(note)
    print("Restart `pnpm dev` to drop the 'not yet approved' marker from new drafts.")
    return 0


def cmd_rebuild(args) -> int:
    spec_file = mf.SPECS_DIR / f"{args.slug}.json"
    if not spec_file.exists():
        rejected = spec_file.with_suffix(".rejected.json")
        spec_file = rejected if rejected.exists() else spec_file
    if not spec_file.exists():
        print(f"no spec for {args.slug!r} under {mf.SPECS_DIR}")
        return 1
    spec = json.loads(spec_file.read_text(encoding="utf-8"))
    spec["slug"] = args.slug
    problems = builder.check_spec(spec)
    if problems:
        _print_result(args.slug, {"outcome": "invalid", "slug": args.slug, "problems": problems})
        return 1
    old = mf.load_manifest()["doc_types"].get(args.slug)
    source = (old or {}).get("source") or {"kind": "advocate", "ref": spec_file.name,
                                           "imported_on": date.today().isoformat()}
    version = int((old or {}).get("version", 0)) + 1
    r = _install(spec, source=source, force=args.force or old is None, version=version)
    _print_result(args.slug, r)
    if r["outcome"] == "imported":
        if spec_file.name.endswith(".rejected.json"):
            spec_file.rename(mf.SPECS_DIR / f"{args.slug}.json")
        for note in sync():
            print(note)
    return 0 if r["outcome"] == "imported" else 1


def cmd_remove(args) -> int:
    data = mf.load_manifest()
    entry = data["doc_types"].pop(args.slug, None)
    if entry is None:
        print(f"no imported format {args.slug!r}")
        return 1
    mf.save_manifest(data)
    (mf.IMPORTED_DIR / entry["template"]).unlink(missing_ok=True)
    catalog = lawe.load_catalog()
    for fid, c in list(catalog["forms"].items()):
        if c.get("status") == "imported" and c.get("doc_type") == args.slug:
            del catalog["forms"][fid]   # becomes NEW again on the next lawe-import
    lawe.save_catalog(catalog)
    print(f"removed {args.slug}")
    for note in sync():
        print(note)
    return 0


def cmd_sync(_args) -> int:
    for note in sync():
        print(note)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Import drafting formats into the engine.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("lawe-status").set_defaults(fn=cmd_lawe_status)

    p = sub.add_parser("lawe-import")
    p.add_argument("--only", default="", help='one form, e.g. "Others/Appeal.pdf"')
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force-new", action="store_true",
                   help="import even if it duplicates an existing doc type")
    p.add_argument("--model", default="")
    p.set_defaults(fn=cmd_lawe_import)

    p = sub.add_parser("file")
    p.add_argument("path")
    p.add_argument("--title", default=None)
    p.add_argument("--slug", default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force-new", action="store_true")
    p.add_argument("--model", default="")
    p.set_defaults(fn=cmd_file)

    sub.add_parser("list").set_defaults(fn=cmd_list)
    p = sub.add_parser("show")
    p.add_argument("slug")
    p.set_defaults(fn=cmd_show)
    p = sub.add_parser("approve")
    p.add_argument("slug")
    p.add_argument("--reviewer", required=True)
    p.set_defaults(fn=cmd_approve)
    p = sub.add_parser("rebuild")
    p.add_argument("slug")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_rebuild)
    p = sub.add_parser("remove")
    p.add_argument("slug")
    p.set_defaults(fn=cmd_remove)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
