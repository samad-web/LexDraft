"""The State as a party in a police case (Madras practice).

A matter arising from a police case arrays the State, represented by the
investigating officer: "State rep. by the Inspector of Police, <police station>,
(Crime No. …)". Shared by the quash / criminal appeal / surrender / writ_criminal
pipelines so every cause title reads the same. Deterministic. No LLM.
"""

from __future__ import annotations

import re
from typing import List, Optional, Sequence

_PS_GAP = "[police station to be provided]"


def _is_state(name: str) -> bool:
    n = name.lower()
    return ("state" in n or "inspector of police" in n
            or "public prosecutor" in n or "deputy superintendent of police" in n)


def bare_crime_no(crime_no: Optional[str]) -> str:
    """'Cr. No. 55 of 2026' / 'Crime No.55 of 2026' -> '55 of 2026', so the
    template's own 'Crime No.' prefix is never doubled."""
    return re.sub(r"^\s*(crime|cr)\.?\s*(no\.?)?\s*", "", crime_no or "",
                  flags=re.I).strip()


def state_respondent(police_station: Optional[str],
                     crime_no: Optional[str] = None) -> str:
    """'State rep. by the Inspector of Police, X Police Station, (Crime No. 45 of
    2026)'. A blank station is a visible gap, never dropped."""
    ps = (police_station or "").strip() or _PS_GAP
    if ps != _PS_GAP and not re.search(r"police station|\bp\.?\s?s\.?$", ps, re.I):
        ps += " Police Station"
    s = f"State rep. by the Inspector of Police, {ps}"
    crime = bare_crime_no(crime_no)
    if crime:
        s += f", (Crime No. {crime})"
    return s


def with_state(respondents: Sequence[str], police_station: Optional[str],
               crime_no: Optional[str] = None) -> List[str]:
    """The respondents with the State first, unless one already is the State.
    Blank / placeholder entries ('[respondent names to be provided]') drop out."""
    names = [r for r in respondents if r.strip() and not r.strip().startswith("[")]
    if any(_is_state(r) for r in names):
        return names
    return [state_respondent(police_station, crime_no)] + names
