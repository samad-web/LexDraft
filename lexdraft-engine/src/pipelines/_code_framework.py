"""Section-label resolution for criminal pipelines.

The procedural framework ('bnss' | 'crpc') is resolved by
src.rules.dual_code_router from (offence_date, proceeding_start_date,
is_fresh_action). This module turns that resolved framework into the section
labels a document cites. Pipelines call the router first, then resolve_sections.

VERIFY (advocate review — reviewed as a unit with the other VERIFY markers): the
BNSS↔CrPC section equivalences below are indicative and must be checked against
the bare Acts.
"""

from __future__ import annotations

from typing import Dict

from ..verify import tables as _reg

# Section equivalences (bnss -> crpc), loaded from verify/tables/section_mappings.json.
_SECTIONS: Dict[str, Dict[str, str]] = _reg.values("section_mappings")


def resolve_sections(code_framework: str) -> Dict[str, str]:
    """Section labels for a router-resolved framework ('bnss' | 'crpc')."""
    if code_framework not in _SECTIONS:
        raise ValueError(f"unknown code_framework {code_framework!r}")
    return dict(_SECTIONS[code_framework])
