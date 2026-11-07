"""Small text normalisers shared by the criminal court-form pipelines.

The extractor returns values with prefixes the template already prints ("S/o X",
"Rs. 10,000", "Mr. X", "Hasthampatti Police Station"); these strip them so the
draft never reads "S/o S/o" / "Rs. Rs." / "Police Station Police Station"
(see bare_crime_no in _state_party). Deterministic. No LLM.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

_RELATION = r"(?:[sdwc]\s*/\s*o\.?|son\s+of|daughter\s+of|wife\s+of)"
_HONORIFIC = r"(?:mr|mrs|ms|thiru|tmt|selvi)\.?"
_RUPEES = r"(?:rs\.?|₹|inr)"
_COURTISH = re.compile(r"magistrate|judge|court|munsif", re.I)


def _strip_lead(value: Optional[str], pattern: str) -> str:
    return re.sub(rf"^\s*{pattern}\s*", "", value or "", flags=re.I).strip()


def bare_parentage(value: Optional[str]) -> str:
    """'S/o Palanisamy' -> 'Palanisamy' (the template prints the relation)."""
    return _strip_lead(value, _RELATION)


def bare_name(value: Optional[str]) -> str:
    """'Mr. R. Vinoth' -> 'R. Vinoth' (the template prints the honorific)."""
    return _strip_lead(value, _HONORIFIC + r"(?=\s)")


def bare_sum(value: Optional[str]) -> str:
    """'Rs. 10,000/-' -> '10,000' (the template prints 'Rs.')."""
    return re.sub(r"\s*/-\s*$", "", _strip_lead(value, _RUPEES))


def bare_station(value: Optional[str]) -> str:
    """'Hasthampatti Police Station' / 'Egmore P.S.' -> 'Hasthampatti' / 'Egmore'."""
    return re.sub(r"[\s,]*\b(police\s+station|p\.\s?s\.?|ps)\s*$", "", value or "",
                  flags=re.I).strip()


def parentage(value: Optional[str], name: Optional[str] = "") -> str:
    """'S/o Rajendran' kept as given; a bare 'Rajendran' gets the relation the
    name's honorific shows (Mr. -> S/o, Ms./Selvi -> D/o), else the neutral
    'son/daughter of' (Mrs. may be D/o or W/o: never guessed)."""
    v = (value or "").strip()
    if not v or re.match(_RELATION, v, re.I):
        return v
    n = (name or "").strip().lower()
    rel = ("S/o" if re.match(r"(mr|thiru)\b", n)
           else "D/o" if re.match(r"(ms|selvi)\b", n) else "son/daughter of")
    return f"{rel} {v}"


_MALE = re.compile(r"(mr|thiru|shri|sri|master)\b", re.I)
_FEMALE = re.compile(r"(mrs|ms|miss|selvi|smt|tmt|kumari)\b", re.I)


def gender_of(name: Optional[str], gender: Optional[str] = None) -> Optional[str]:
    """'m' | 'f' | None: an explicit gender ('male'/'female'/'m'/'f') wins, else
    the name's title (Mr./Thiru -> m; Mrs./Ms./Selvi/Tmt. -> f)."""
    g = (gender or "").strip().lower()[:1]
    if g in ("m", "f"):
        return g
    n = (name or "").strip()
    return "m" if _MALE.match(n) else "f" if _FEMALE.match(n) else None


def pronouns(name: Optional[str], gender: Optional[str] = None) -> dict:
    """The party's he/his/him/himself + son/daughter, resolved from the title or
    gender; the form's 'he/she' alternative stays only when neither tells."""
    g = gender_of(name, gender)

    def pick(m: str, f: str) -> str:
        return m if g == "m" else f if g == "f" else f"{m}/{f}"
    return {"he": pick("he", "she"), "his": pick("his", "her"),
            "him": pick("him", "her"), "himself": pick("himself", "herself"),
            "child": pick("son", "daughter"), "rel": pick("S/o", "D/o")}


_SUBJECT = re.compile(r"(he|she|they|i|it|the|his|her|their|my|petitioner|accused|"
                      r"complainant|mr|mrs|ms|thiru|tmt|selvi)\b", re.I)
_AUX = ("was", "were", "had", "has", "could", "did", "is", "would")


def subject_clause(reason: Optional[str], he: str) -> str:
    """A reason spliced after 'as ...' that has no subject gets one: 'Hospitalised
    for dengue' -> 'he was hospitalised for dengue'; 'had to travel' -> 'he had to
    travel'; 'he was ill' stays as it is."""
    s = clause(reason)
    if not s or _SUBJECT.match(s):
        return s
    first = s.split(" ", 1)[0].lower()
    s = s[0].lower() + s[1:]
    return f"{he} {s}" if first in _AUX else f"{he} was {s}"


def clause(value: Optional[str]) -> str:
    """A reason spliced after 'as ...': lower-case a leading pronoun/article and
    drop the trailing full stop the template already prints."""
    s = (value or "").strip().rstrip(".").strip()
    return re.sub(r"^(The|He|She|They|His|Her|Their|It)\b",
                  lambda m: m.group(1).lower(), s)


def court_and_place(court_name: Optional[str],
                    court_place: Optional[str]) -> Tuple[str, str]:
    """('Judicial Magistrate No. II, Salem', 'Salem') -> ('the Judicial
    Magistrate No. II, Salem', '') for an 'IN THE COURT OF <name> AT <place>'
    heading. A designation the extractor put in court_place moves to the name;
    the place drops when the name already carries it."""
    name, place = (court_name or "").strip(), (court_place or "").strip()
    if not name and _COURTISH.search(place):
        name, place = place, ""
    name = re.sub(r"^\s*(in\s+)?(the\s+)?court\s+of\s+", "", name, flags=re.I).strip()
    if name and not re.match(r"the\b", name, re.I):
        name = "the " + name
    if place and place.lower() in name.lower():
        place = ""
    return name, place


def designation_and_place(court_name: Optional[str],
                          court_place: Optional[str]) -> Tuple[str, str]:
    """For the fixed 'IN THE COURT OF <designation> :: AT <place>' heading:
    ('Judicial Magistrate No. II, Salem', 'Salem') -> ('the Judicial Magistrate
    No. II', 'Salem'); a trailing 'Court' after a Magistrate drops."""
    name, place = court_and_place(court_name, court_place)
    head, sep, tail = name.rpartition(",")
    if sep and head.strip() and not place:
        name, place = head.strip(), tail.strip()
    if re.search(r"magistrate", name, re.I):
        name = re.sub(r"\s+court$", "", name, flags=re.I)
    return name, place


def split_crime(crime_no: Optional[str]) -> Tuple[str, str]:
    """'Crime No. 310 of 2026 of X P.S.' -> ('310', '2026'); '310' -> ('310', '')."""
    from ._state_party import bare_crime_no
    s = bare_crime_no(crime_no)
    m = re.match(r"(.*?)\s*(?:of|/)\s*(\d{4}|\d{2})\b", s)
    return (m.group(1).strip(), m.group(2)) if m else (s, "")


def sum_in_words(value: Optional[str]) -> str:
    """'10,000' -> 'Ten Thousand'; '' when the sum is not a plain rupee figure."""
    from ..components.amount_words import rupees_in_words
    digits = re.sub(r"[,\s]", "", bare_sum(value))
    return rupees_in_words(int(digits)).title() if digits.isdigit() else ""
