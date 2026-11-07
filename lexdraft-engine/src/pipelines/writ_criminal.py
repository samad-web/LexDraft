"""Writ Petition (Criminal) under Art.226/227 r/w s.482 CrPC
— document pipeline (DPC book pp.63-66).

Used to challenge a detention order (here, under a preventive-detention statute) at
the pre-execution stage and seek its quashing plus production of the grounds of
detention. The book (pp.63-66) recites the impugned detention order, the falsity of
the grounds, the Alka Subhash Gadia / Deepak Bajaj pre-execution exceptions, the
delay, and prays for mandamus (produce record) + certiorari (quash).

Hard requirements (each refuses, no partial output):
  - The impugned order (its reference + date) must be identified — there is nothing
    to quash otherwise.
  - At least one ground must be pleaded (a bare quashing prayer is refused).
  - The no-similar-petition declaration is mandatory (as in the civil writ).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ._bench import MADURAI_COURT, madurai_bench

_PRISON = re.compile(r"\b(?:Central Prison|Special Prison for Women|District Jail|Sub[- ]Jail)"
                     r",\s*[A-Z][A-Za-z]+")
_GOONDA = re.compile(r"\bgoondas?\b|\bAct 14 of 1982\b", re.IGNORECASE)
_TN_ACT_14_1982 = (
    "the Tamil Nadu Prevention of Dangerous Activities of Bootleggers, Cyber Law "
    "Offenders, Drug-Offenders, Forest-Offenders, Goondas, Immoral Traffic Offenders, "
    "Sand-Offenders, Sexual-Offenders, Slum-Grabbers and Video Pirates Act, 1982 "
    "(Tamil Nadu Act 14 of 1982)")

TEMPLATE = "writ_criminal.docx"
SPEC = "dpc-63-66"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class WritCriminalResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> WritCriminalResult:
    return WritCriminalResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="writ_criminal", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


_TN_STATE = ("The State of Tamil Nadu, rep. by the Additional Chief Secretary to "
             "Government, Home, Prohibition and Excise Department, Secretariat, "
             "Chennai-600 009")
_STATE = "The State, rep. by its Secretary to Government, Home Department"


def _array_state(respondents: Sequence[str], high_court: Optional[str],
                 police_station: Optional[str],
                 detention_place: Optional[str]) -> List[str]:
    """A detention writ arrays the State (the detaining Government) first, then
    the prison holding the detenu and the sponsoring police station. A bare 'The
    Government ...' respondent IS the State and takes its proper description; a
    respondent already naming the State is kept as given."""
    names = [r.strip() for r in respondents
             if r.strip() and not r.strip().startswith("[")]
    hc = (high_court or "madras").lower()
    state = _TN_STATE if any(k in hc for k in ("madras", "chennai", "madurai",
                                               "tamil nadu")) else _STATE
    # the Union (a central detention) or any named Government is already the State
    if not any(re.search(r"\bstate\b|government of|secretary|union of india", n, re.I)
               for n in names):
        bare = [i for i, n in enumerate(names)
                if re.match(r"the government\b(?! of)", n, re.I)]
        if bare:
            names.pop(bare[0])
        names.insert(0, state)
    low = " ".join(names).lower()
    if detention_place and detention_place.strip() and "superintendent" not in low:
        dp = detention_place.strip()
        # "The Superintendent, Central Prison, Tiruchirappalli" (the jailor's title)
        names.append(f"The Superintendent, {dp}" if re.search(r"prison|jail", dp, re.I)
                     else f"The Superintendent of Prison, {dp}")
    ps = (police_station or "").strip()
    if ps and ps.lower() not in low:
        if "police station" not in ps.lower():
            ps += " Police Station"
        names.append(f"The Inspector of Police, {ps} (sponsoring authority)")
    return names


def build(
    *,
    petitioner_name: str,
    respondents: Sequence[str],
    impugned_order_ref: str,
    impugned_order_date: Optional[date],
    impugned_order_statute: str,
    facts_narrative: str,
    grounds: Sequence[str],
    pre_execution_stage: bool,
    no_similar_petition: bool,
    filing_date: date,
    place: str,
    high_court: Optional[str] = None,
    # cause-title header (DPC book pp.63-66). Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
    # Habeas corpus (detenu in custody): the detenu and the place of detention.
    detenu_name: Optional[str] = None,
    detention_place: Optional[str] = None,
    # the sponsoring police station (preventive detention). Optional.
    police_station: Optional[str] = None,
) -> WritCriminalResult:
    """Assemble the criminal writ petition, or refuse."""

    # 1. the impugned order must be identified.
    if not impugned_order_ref.strip() or impugned_order_date is None:
        return _refuse(
            "a writ petition to quash an order must identify the impugned order (its "
            "reference and date); it is absent",
            code="writ_criminal_impugned_order_not_identified",
            fields=("impugned_order_ref", "impugned_order_date"),
        )

    # 2. at least one ground.
    if not grounds or not any(g.strip() for g in grounds):
        return _refuse(
            "the grounds on which the impugned order is challenged must be pleaded; a "
            "bare quashing prayer is refused",
            code="writ_criminal_no_grounds", fields=("grounds",),
        )

    # 3. no-similar-petition declaration (mandatory).
    if not no_similar_petition:
        return _refuse(
            "the petition must declare that no similar petition has been filed before "
            "this Hon'ble Court or the Hon'ble Supreme Court; that declaration is "
            "absent",
            code="writ_criminal_no_similar_petition_declaration_missing",
            fields=("no_similar_petition",),
        )

    # A detenu already confined somewhere is past the pre-execution stage: the
    # remedy is habeas corpus (r10: a Goondas detenu in Central Prison came out
    # as a W.P.(Crl.) for certiorari because the flag was set wrongly).
    told = " ".join([impugned_order_ref, facts_narrative, *grounds])
    if not (detention_place or "").strip():
        m = _PRISON.search(told)
        detention_place = m.group(0) if m else None
    pre_execution_stage = pre_execution_stage and not detention_place
    statute = impugned_order_statute.strip()
    # a "Goonda" detention is under TN Act 14 of 1982 — name it in full when the
    # statute is missing or given only as "the Goondas Act".
    if "14 of 1982" not in statute and (
            _GOONDA.search(statute) or ((not statute or statute.startswith("["))
                                        and _GOONDA.search(told))):
        impugned_order_statute = _TN_ACT_14_1982
    high_court = high_court or "Judicature at Madras"
    madurai = madurai_bench(high_court, impugned_order_ref, police_station,
                            petitioner_address, place)
    if madurai and "madurai" not in high_court.lower():
        high_court = MADURAI_COURT

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondents": _array_state(respondents, high_court, police_station,
                                    None if pre_execution_stage else detention_place),
        # None printed as "HIGH COURT OF NONE"; the engine is Madras-first.
        "high_court": high_court,
        "md_suffix": "(MD)" if madurai else "",
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date,
        "impugned_order_statute": impugned_order_statute,
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "grounds": [g for g in grounds if g.strip()],
        "pre_execution_stage": pre_execution_stage,
        # A detention order already executed (detenu in custody) is challenged by
        # a Habeas Corpus Petition; only a pre-execution challenge is a writ
        # petition (certiorari).
        "is_habeas_corpus": not pre_execution_stage,
        "detenu_name": detenu_name,
        "detention_place": detention_place,
        "no_similar_petition": no_similar_petition,
        "place": place,
    }
    return WritCriminalResult(refused=False, context=context)
