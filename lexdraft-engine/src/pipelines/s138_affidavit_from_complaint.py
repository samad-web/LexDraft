"""Derive the supporting s.138 affidavit FROM a built s.138 complaint (spec 3.1).

The complaint is the source of truth. This module takes a *built*
``ComplaintResult.context`` — the facts the complaint pipeline already validated
and refusal-checked — and returns the kwargs for the standalone ``affidavit``
pipeline, so the app produces the complaint and then its proof affidavit without
re-keying a single fact.

Two rules make this a derivation, not a copy:

  1. FIRST PERSON. The complaint pleads in the advocate's third-person voice
     ("The complainant states that ..."). The affidavit is sworn by the
     complainant, so every derived averment is first person ("I state that ...",
     "I further state that ..."). The wording is generated here from the
     complaint's structured facts, never lifted verbatim.

  2. THE WINDOW STOPS RE-RUN. We pass the cheque/presentation/memo/notice facts
     straight through so the affidavit pipeline re-runs the SAME presentation +
     30-day-notice hard stops it always runs for an s.138 matter
     (src/pipelines/affidavit.py). If the complaint somehow carried an out-of-window
     fact, the affidavit refuses too — the two documents can never disagree.

This layer calls no LLM and does no date arithmetic of its own; every date and
amount is read from the complaint context verbatim.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from .s138_notice import Cheque

SPEC = "3.1"


def _as_date(value: Any) -> Optional[date]:
    """The complaint context stores some dates as ``date`` and some as ISO strings
    (see s138_complaint.build). Normalise to ``date`` for the affidavit kwargs,
    which the adapter would otherwise coerce from ISO anyway."""
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _cheque_clause(cheques: List[Dict[str, Any]]) -> str:
    """One first-person sentence describing the cheque(s), reading figures AND
    words from the complaint context (which already computed amount_words)."""
    parts = []
    for c in cheques:
        # Prefer the dd.mm.yyyy body-formatted date the complaint context carries;
        # fall back to the raw date only if an older context lacks it.
        cheque_date = c.get("date_body") or c["date"]
        parts.append(
            f"cheque No. {c['number']} dated {cheque_date} for Rs. {c['amount']}/- "
            f"({c['amount_words']}), drawn on {c['bank']}, {c['branch']}"
        )
    joined = "; and ".join(parts)
    lead = "the cheque" if len(cheques) == 1 else "the cheques"
    return f"I further state that in discharge of the said liability the accused issued {lead}, namely {joined}."


def build_affidavit_kwargs(
    complaint_context: Dict[str, Any],
    *,
    deponent_age: int,
    deponent_occupation: str,
    attestor: str,
    parentage_type: Optional[str] = None,
    parentage_name: Optional[str] = None,
    deponent_address: Optional[str] = None,
    proceeding: Optional[str] = None,
    authority_ref: Optional[str] = None,
    affirm_date: Optional[date] = None,
    deponent_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Map a built complaint context to ``affidavit.build`` kwargs.

    The complaint context supplies every legal fact. The caller supplies only the
    deponent particulars the complaint does not carry (age, occupation, the
    attesting officer, and — where the complaint was sworn by a power agent —
    the authority reference). Sensible fall-backs are read from the complaint
    where they exist (parentage/address of the complainant, the proceeding label).

    Returns kwargs ready for ``src.pipelines.affidavit.build(**kwargs)``. The
    affidavit pipeline then re-runs the s.138 window hard stops on the passed-through
    cheque/date facts, so a defective matter refuses on both documents.
    """
    complainant = complaint_context["complainant"]
    accused = complaint_context["accused"]
    cheques_ctx: List[Dict[str, Any]] = complaint_context["cheques"]

    # Deponent-is-complainant invariant. The proof affidavit is sworn by the
    # complainant (who is CW-1 in the complaint's witness list). If the caller
    # names a deponent, it MUST be the complainant — otherwise the two documents
    # would disagree on who is deposing. Default: the complainant.
    if deponent_name is not None and deponent_name.strip() != complainant["name"].strip():
        raise ValueError(
            "the proof affidavit must be sworn by the complainant "
            f"({complainant['name']!r}); got deponent {deponent_name!r}. The "
            "deponent of an s.138 proof affidavit is CW-1, the complainant."
        )
    deponent_name = complainant["name"]
    # Rebuild the Cheque objects the affidavit pipeline consumes (same contract).
    cheques = [
        Cheque(
            number=c["number"],
            date=_as_date(c["date"]),
            amount=c["amount"],
            bank=c["bank"],
            branch=c["branch"],
            drawer=c["drawer"],
            payee=c["payee"],
        )
        for c in cheques_ctx
    ]

    demand_words = complaint_context["demand_words"]
    demand_amount = complaint_context["demand_amount"]
    dishonour_reason = complaint_context["dishonour_reason"]
    debt = complaint_context.get("debt_slot") or "the legally enforceable debt/liability pleaded in the complaint"

    # Prefer the dd.mm.yyyy body-formatted dates the complaint context carries so
    # the affidavit reads in Indian date format like the complaint (not ISO).
    def _bd(key: str) -> Any:
        return complaint_context.get(f"{key}_body") or complaint_context[key]

    # First-person averments, generated from the complaint's structured facts and
    # ordered as the complaint pleads them. Paragraph numbers are computed by the
    # affidavit component, whose para 1 ALREADY states the deponent's competence
    # ("I am the {role} ... well acquainted with the facts"); so we DO NOT repeat a
    # standing/competence averment here — the first body para goes straight to the
    # liability, avoiding the duplication seen when both restated it.
    body_paras: List[str] = [
        f"I further state that the accused, {accused['name']}, is liable to me in "
        f"respect of {debt}.",
        _cheque_clause(cheques_ctx),
        f"I further state that the said cheque(s) were presented for encashment on "
        f"{_bd('presentation_date')} and were returned dishonoured "
        f"vide the bank's memo dated {_bd('memo_date')} for the reason "
        f"“{dishonour_reason}”, which memo was received by me on "
        f"{_bd('memo_received_date')}.",
        f"I further state that a statutory notice dated {_bd('notice_date')} "
        f"was dispatched on {_bd('notice_dispatch_date')} and served "
        f"on the accused on {_bd('delivery_date')}, calling upon the "
        f"accused to pay the said sum of Rs. {demand_amount}/- ({demand_words}).",
        f"I further state that the accused has failed to pay the said sum within "
        f"fifteen days of the service of the said notice, and the cause of action "
        f"under Section 138 of the Negotiable Instruments Act, 1881 arose on "
        f"{_bd('cause_of_action_date')}.",
        f"I further state that the contents of the accompanying complaint be read as "
        f"part and parcel of this affidavit, and that the averments therein are true "
        f"to my own knowledge.",
    ]
    # Recite the SAME list of documents the complaint lists (standard set +
    # advocate-added), so the affidavit and complaint never disagree on the
    # documents relied upon. Read from the complaint context verbatim.
    all_documents = list(complaint_context.get("documents") or []) + list(
        complaint_context.get("extra_documents") or [])
    if all_documents:
        body_paras.append(
            "I further state that I rely upon the following documents, true copies / "
            "originals whereof are produced herewith: "
            + "; ".join(f"({i + 1}) {d}" for i, d in enumerate(all_documents))
            + "."
        )
    if complaint_context.get("deemed_service") and complaint_context.get("deemed_service_averment"):
        body_paras.insert(
            5,
            f"I further state that {complaint_context['deemed_service_averment']}",
        )

    # Prayer. When the complaint prays for "twice the amount" (the conventional
    # s.138 relief), the affidavit's prayer mirrors it verbatim so the two
    # documents never diverge on the relief sought; otherwise the affidavit uses
    # its standard "taken on record" prayer.
    if complaint_context.get("prayer_twice_amount"):
        prayer = (
            "I pray that this Hon'ble Court may be pleased to summon, prosecute and "
            "punish the accused and direct the accused to pay twice the amount "
            "covered under the said dishonoured cheque(s), under Section 138 read "
            "with Section 142 of the Negotiable Instruments Act, 1881 (as amended by "
            "the Negotiable Instruments Laws (Amendment and Miscellaneous "
            "Provisions) Act, 2002) and in accordance with Section 395 of BNSS, "
            "2023, and this proof affidavit be taken on record in support of the "
            "complaint."
        )
    else:
        prayer = (
            "I pray that this proof affidavit be taken on record in support of the "
            "complaint under Section 138 of the Negotiable Instruments Act, 1881."
        )

    return {
        # matter dimension — drives the affidavit's own s.138 window re-check.
        "matter_type": "s138",
        "affidavit_kind": "s145_proof",
        # deponent
        "deponent_name": deponent_name,
        "age": deponent_age,
        "parentage_type": parentage_type or complainant.get("parentage_type") or "S/o",
        "parentage_name": parentage_name or complainant.get("parentage") or "____",
        "occupation": deponent_occupation,
        "address": deponent_address or complainant.get("address") or "____",
        "role": "complainant",
        # The affidavit template renders "in the above {proceeding}", so this must
        # NOT itself begin with "the above" (which produced "in the above the above
        # complaint"). Just the proceeding label.
        "proceeding": proceeding or "complaint under Section 138 of the Negotiable Instruments Act, 1881",
        "place": complaint_context["place"],
        "attestor": attestor,
        "body_paras": body_paras,
        "prayer": prayer,
        "affirm_date": affirm_date,
        "authority_ref": authority_ref,
        # s.138 particulars passed through verbatim so the affidavit pipeline
        # re-runs the presentation + 30-day-notice hard stops on the same facts.
        "cheques": cheques,
        "presentation_date": _as_date(complaint_context["presentation_date"]),
        "memo_date": _as_date(complaint_context["memo_date"]),
        "memo_received_date": _as_date(complaint_context["memo_received_date"]),
        "dishonour_reason": dishonour_reason,
        "notice_date": _as_date(complaint_context["notice_date"]),
        # Counsel block carried over verbatim so the affidavit's backing sheet
        # names the same advocates as the complaint (doc-5: rendered on the
        # backing sheet of BOTH documents). Empty when the complaint had none.
        "advocate_lines": complaint_context.get("advocate_lines", []),
        "advocate_contact": complaint_context.get("advocate_contact"),
    }
