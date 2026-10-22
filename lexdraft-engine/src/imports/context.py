"""What the transcriber is told about the engine: existing doc types + common field keys.

Shared by tools/import_format.py (developer imports) and GET /v1/format-spec/contract
(the API's in-app "Upload a format"), so both transcribe against the same vocabulary.
"""

from __future__ import annotations

from collections import Counter
from typing import List, Tuple

from . import manifest as mf

# A key used by this many built-in adapters is "common": the transcriber reuses it.
COMMON_KEY_MIN = 3


def builtin_adapters() -> List:
    from ..service import adapters
    from ..service.adapters import imported
    return [a for a in adapters.all_adapters() if a.doc_type not in imported.IMPORTED_DOC_TYPES]


def existing_doc_types() -> List[Tuple[str, str]]:
    """(slug, title) of every registered doc type plus every manifest entry."""
    from ..service import adapters
    out = [(a.doc_type, a.title) for a in adapters.all_adapters()]
    known = {slug for slug, _ in out}
    for slug, entry in mf.load_manifest()["doc_types"].items():
        if slug not in known:
            out.append((slug, entry.get("title", slug)))
    return out


def common_keys() -> List[str]:
    counts: Counter = Counter()
    for a in builtin_adapters():
        counts.update({spec.key for spec in a.fields})
    return sorted(k for k, n in counts.items() if n >= COMMON_KEY_MIN)
