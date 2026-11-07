"""Madras High Court seat: a matter arising in the southern districts lies before
the Madurai Bench, whose case numbers carry "(MD)" (Crl.A.(MD), H.C.P.(MD) ...).
Used when the advocate names only "the Madras High Court" (suite r10: a
Tiruchirappalli appeal lost its Madurai Bench heading)."""

from __future__ import annotations

import re
from typing import Optional

# shortcut: district names plus the main court towns that do not carry the
# district's name; extend when a southern court town is missed.
_MADURAI_BENCH = re.compile(
    r"\b(madurai|theni|dindigul|palani|ramanathapuram|ramnad|paramakudi|virudhunagar|"
    r"srivilliputhur|sivakasi|aruppukottai|sivaganga[i]?|karaikudi|pudukkottai|"
    r"thanjavur|tanjore|kumbakonam|pattukottai|thiruvarur|tiruvarur|nagapattinam|"
    r"mayiladuthurai|tirunelveli|tenkasi|thoothukudi|tuticorin|kovilpatti|"
    r"kanyakumari|kanniyakumari|nagercoil|tiruchirappalli|tiruchirapalli|trichy|karur)\b",
    re.IGNORECASE)


def madurai_bench(court_name: Optional[str], *places: Optional[str]) -> bool:
    """True when the matter lies before the Madurai Bench: the court is named as
    such, or a Madras High Court matter comes from a Madurai Bench district."""
    court = (court_name or "").lower()
    if "madurai" in court:
        return True
    if court and "high court" in court and not any(
            k in court for k in ("madras", "chennai", "tamil nadu")):
        return False  # another High Court
    return any(p and _MADURAI_BENCH.search(p) for p in places)


MADURAI_COURT = "THE HIGH COURT OF JUDICATURE AT MADRAS (MADURAI BENCH)"
