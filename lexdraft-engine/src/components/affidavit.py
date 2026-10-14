"""Affidavit block — context + validation (spec 1.3).

Paragraph numbering is CODE-GENERATED: para 1 is the competence clause, body
paragraphs number from 2, and the prayer paragraph number is computed as the
last. The model never authors a number.

Validation (deterministic, spec 1.3):
  - Deponent competence in para 1 (structural — always emitted).
  - Corporate deponent -> authority reference (board resolution / POA).
  - Third-party deponent -> explicit source-of-knowledge averment.
  - Attestation block present; unfilled attestor flagged.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..rules._result import Assessment

TEMPLATE = "affidavit.docx"


def validate(
    *,
    is_corporate: bool = False,
    authority_ref: Optional[str] = None,
    is_third_party: bool = False,
    source_of_knowledge: Optional[str] = None,
    attestor: Optional[str] = None,
    **_ignored: Any,
) -> Assessment:
    if is_corporate and not authority_ref:
        return Assessment.refuse(
            reason="corporate deponent requires an authority reference "
                   "(board resolution / power of attorney)",
        )
    if is_third_party and not source_of_knowledge:
        return Assessment.refuse(
            reason="third-party deponent requires an explicit source-of-knowledge "
                   "averment",
        )
    if not attestor:
        return Assessment.refuse(
            reason="attestation block incomplete: no attestor "
                   "(Advocate / Notary / Oath Commissioner) supplied",
        )
    return Assessment.allow()


def build_context(
    *,
    deponent_name: str,
    age: int,
    parentage_type: str,
    parentage_name: str,
    occupation: str,
    address: str,
    role: str,
    proceeding: str,
    place: str,
    date: str,
    attestor: str,
    body_paras: Sequence[str],
    prayer: str,
    is_corporate: bool = False,
    authority_ref: Optional[str] = None,
    is_third_party: bool = False,
    source_of_knowledge: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the docxtpl context with computed paragraph numbers. Validation runs
    first; a refused affidavit raises."""
    verdict = validate(
        is_corporate=is_corporate, authority_ref=authority_ref,
        is_third_party=is_third_party, source_of_knowledge=source_of_knowledge,
        attestor=attestor,
    )
    if verdict.refused:
        raise ValueError(verdict.reason)

    # para 1 = competence; body paras number from 2; prayer is the last number.
    numbered_body = [
        {"number": i + 2, "text": text} for i, text in enumerate(body_paras)
    ]
    prayer_number = len(body_paras) + 2  # 1 competence + len(body) + this

    return {
        "deponent": {"name": deponent_name},
        "deponent_name": deponent_name,
        "age": age,
        "parentage_type": parentage_type,
        "parentage_name": parentage_name,
        "occupation": occupation,
        "address": address,
        "role": role,
        "proceeding": proceeding,
        "place": place,
        "date": date,
        "attestor": attestor,
        # Render the "duly authorised to swear ... vide <ref>" sentence whenever an
        # authority reference is present — NOT only for a corporate deponent. The
        # common s.138 case is an INDIVIDUAL power agent swearing for the complainant:
        # is_corporate is False but a POA reference exists and must be recited.
        "authorised": bool(authority_ref),
        "authority_ref": authority_ref,
        "is_third_party": is_third_party,
        "source_of_knowledge": source_of_knowledge,
        "numbered_body": numbered_body,
        "prayer": prayer,
        "prayer_number": prayer_number,
    }
