"""The LAWE forms library (https://www.lawe.co.in/lawe-downloads.html).

The downloads page builds its list client-side from js/loaddownloads.js, which
declares every form as  download[++ndx] = "pdf~<Folder>~<File>.pdf". Files are
served from downloads/forms/<Folder>/<File>. All forms are scanned PDFs.

templates/imported/lawe_catalog.json records what each listed form maps to:
  "covered"       — an existing doc type already drafts it (`doc_type`)
  "imported"      — imported by tools/import_format.py as `doc_type`
  "not_a_format"  — listed but not a drafting format
A listed form with no catalog entry is NEW: `lawe-import` transcribes it and either
imports it or records the existing doc type it duplicates.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .manifest import IMPORTED_DIR

BASE_URL = "https://www.lawe.co.in/"
LISTING_URL = BASE_URL + "js/loaddownloads.js"
CATALOG_PATH = IMPORTED_DIR / "lawe_catalog.json"

_ENTRY = re.compile(r'download\[\+\+ndx\]\s*=\s*"(\w+)~([^~"]+)~([^"]+)"')
_UA = {"User-Agent": "LexDraft-format-import/1.0"}


def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def form_id(folder: str, filename: str) -> str:
    return f"{folder}/{filename}"


def fetch_listing() -> List[Tuple[str, str]]:
    """Every (folder, filename) the downloads page lists, in site order."""
    return parse_listing(_get(LISTING_URL).decode("utf-8", errors="replace"))


def parse_listing(js: str) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for _kind, folder, filename in _ENTRY.findall(js):
        if folder == "foldername":  # the template row at index 0
            continue
        out.append((folder, filename))
    if not out:
        raise RuntimeError("LAWE listing parsed to zero forms — the site layout changed")
    return out


def form_url(folder: str, filename: str) -> str:
    return (BASE_URL + "downloads/forms/" + urllib.parse.quote(folder) + "/"
            + urllib.parse.quote(filename))


def download(folder: str, filename: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{folder}__{filename}"
    if not dest.exists():
        dest.write_bytes(_get(form_url(folder, filename), timeout=60))
    return dest


def title_of(filename: str) -> str:
    """The title the site shows for a file (it strips .pdf and underscores)."""
    return re.sub(r"\.pdf$", "", filename, flags=re.I).replace("_", " ").strip(" -")


def load_catalog(path: Optional[Path] = None) -> Dict[str, Any]:
    p = path or CATALOG_PATH
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    data.setdefault("forms", {})
    return data


def save_catalog(data: Dict[str, Any], path: Optional[Path] = None) -> None:
    p = path or CATALOG_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                 encoding="utf-8")
