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

import re
from typing import Dict, Optional

from ..verify import tables as _reg

# Section equivalences (bnss -> crpc), loaded from verify/tables/section_mappings.json.
_SECTIONS: Dict[str, Dict[str, str]] = _reg.values("section_mappings")


def resolve_sections(code_framework: str) -> Dict[str, str]:
    """Section labels for a router-resolved framework ('bnss' | 'crpc')."""
    if code_framework not in _SECTIONS:
        raise ValueError(f"unknown code_framework {code_framework!r}")
    return dict(_SECTIONS[code_framework])


# Process provisions cited by the court forms (bail bond, warrant, s.256/s.317
# petitions): (BNSS, CrPC). VERIFY against the bare Acts with the table above.
_PROVISIONS: Dict[str, tuple] = {
    "bail_bond": ("Sections 478 to 485", "Sections 436 to 441"),
    "warrant": ("Section 72", "Section 70"),
    "warrant_recall": ("Section 72(2)", "Section 70(2)"),
    "complainant_absence": ("Section 279", "Section 256"),
    "dispense_presence": ("Section 355", "Section 317"),
}
_ACTS = {"bnss": "the Bharatiya Nagarik Suraksha Sanhita, 2023",
         "crpc": "the Code of Criminal Procedure, 1973"}


def case_framework(*refs: Optional[str]) -> Optional[str]:
    """'bnss' | 'crpc' | None from the earliest year in the case references: a
    case instituted before 1.7.2024 continues under the CrPC (BNSS s.531(2)(a));
    a 2024 case (either side of the day) or no year at all is unknowable."""
    years = [int(y) for r in refs for y in re.findall(r"\b(?:19|20)\d\d\b", r or "")]
    if not years:
        return None
    y = min(years)
    return "crpc" if y <= 2023 else "bnss" if y >= 2025 else None


def provision(key: str, *refs: Optional[str]) -> str:
    """'Section 279 of the Bharatiya Nagarik Suraksha Sanhita, 2023' (or the CrPC
    one); a bracketed choice to confirm when the case's code is unknowable."""
    bnss, crpc = _PROVISIONS[key]
    fw = case_framework(*refs)
    if fw is None:
        return f"[{bnss} of {_ACTS['bnss']} / {crpc} of {_ACTS['crpc']} — to be confirmed]"
    return f"{bnss if fw == 'bnss' else crpc} of {_ACTS[fw]}"
