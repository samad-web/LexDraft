"""Vakalatnama — advocate-appointment instrument (TN/Madras forms set).

A vakalatnama is the instrument by which a party (the executant) appoints and
authorises an advocate to appear and act for them in a case. The forms set carries
two flavours which this pipeline unifies under `kind`:

  - LONG  — the traditional long-form vakalat with express authority through
            execution proceedings, appeals, drawing of moneys and deputing other
            counsel, plus a read-over-and-explained attestation clause.
  - EFILING — the modern short-form vakalatnama that additionally records the
            advocate's Bar enrolment number and the parties' contact details
            (the e-courts / Bar Council compliance fields).

Generalised: the court name/place are placeholders, so the same template serves
any state. This is a PARTY-FILED document (the advocate/party prepares it), not a
court-issued instrument.

Hard requirements (each refuses, no partial output):
  - At least one advocate must be named (an appointment appointing no one is void).
  - The executant (the party granting the authority) must be named.
  - For the EFILING form, the advocate's Bar enrolment number must be given — the
    short form is invalid for e-filing without it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "vakalatnama.docx"
SPEC = "tn-vakalat"


class VakalatKind(Enum):
    LONG = "long"
    EFILING = "efiling"


class CourtKind(Enum):
    """The court-specific format (party labels, body clause, certificate). Distinct
    from VakalatKind, which is the render STYLE. See docs/vakalatnama-court-formats.md.
    GENERIC keeps the original neutral form for any caller that doesn't specify."""
    GENERIC = "generic"
    CRIMINAL = "criminal"
    SMALL_CAUSES = "small_causes"
    CIVIL = "civil"


# Per-court-kind fixtures: the party-role choices, the operative body clause, the
# certificate/acceptance wording, and the backing-sheet title. Kept as data so the
# template stays declarative and a new court kind is a data change, not new branches.
_COURT_KIND_SPEC: Dict[str, Dict[str, Any]] = {
    CourtKind.GENERIC.value: {
        "title": "VAKALATNAMA",
        "executant_roles": ["Plaintiff", "Petitioner", "Complainant", "Accused"],
        "opposite_roles": ["Defendant", "Respondent"],
        "opposite_label": "Opposite Party",
        "court_heading": None,           # uses court_name placeholder
        "body_clause": None,             # keep the template's neutral default
        "signature_label": "(Signature / LTI of the executant)",
        "has_fee_clause": False,
        "has_counter_agreement": False,
        "certificate_style": "read_over",   # read_over | read_out | none
        "acceptance_line": "I/We accept the Vakalatnama",
        "counsel_label": "Advocate(s) for the executant",
    },
    CourtKind.CRIMINAL.value: {
        "title": "VAKALATNAMA",
        "executant_roles": ["Petitioner", "Accused", "Complainant"],
        "opposite_roles": ["Respondent", "Complainant", "Accused"],
        "opposite_label": "Respondent / Complainant / Accused",
        "court_heading": None,
        # Verbatim from the advocate's criminal_vakalat.pdf (only the "___" appoint
        # blank is replaced by the named advocate at render). See
        # docs/vakalatnama-court-formats.md.
        "body_clause": (
            "do hereby appoint and retain {advocates} to appear for me/us in the "
            "above case on my/our behalf and to plead and I/we further empower "
            "him/Her/them to accept on my/our behalf, service of notice of all "
            "Proceedings in the above case, until Disposal of the case."
        ),
        "signature_label": (
            "(Signature / LTI of the Complainant / Petitioner / Accused / Respondent)"
        ),
        "has_fee_clause": False,
        "has_counter_agreement": False,
        "certificate_style": "read_over",
        "acceptance_line": "I/we accept the Vakalatnama",
        "counsel_label": "Counsel for Complainant / Petitioner / Accused / Respondent",
    },
    CourtKind.SMALL_CAUSES.value: {
        "title": "VAKALAT",
        "executant_roles": ["Plaintiff", "Defendant", "Claimant"],
        "opposite_roles": ["Defendant", "Plaintiff", "Claimant"],
        "opposite_label": "Defendant",
        "court_heading": "In the Court of Small Causes at Madras",
        # Verbatim (advocate small_causes_vakalat.pdf). The template already prints
        # "the {party_role} above-named", so this clause starts at "do hereby appoint".
        "body_clause": (
            "do hereby appoint {advocates} as my/our "
            "Counsel to Commence/defend the above matter/Suit to appear for me/us in "
            "the above cause and to conduct the same and all proceeding upon and "
            "decree or order that may be passed therein and draw moneys and half cost "
            "from court."
        ),
        "signature_label": "Defendant / Plaintiff / Claimant",
        "has_fee_clause": True,
        "has_counter_agreement": True,
        "certificate_style": "none",
        "acceptance_line": None,
        "counsel_label": "Counsel for Plaintiff / Defendant",
    },
    CourtKind.CIVIL.value: {
        "title": "VAKALAT",
        "executant_roles": ["Plaintiff", "Petitioner"],
        "opposite_roles": ["Defendant", "Respondent"],
        # Civil form stacks BOTH labels for each side (Plaintiff over Petitioner;
        # Defendant over Respondent). executant_label / opposite_label carry the
        # stacked pair the template prints.
        "executant_label": "Plaintiff / Petitioner",
        "opposite_label": "Defendant / Respondent",
        "court_heading": None,
        # Civil form: "Dated at ___ this ___ day of ___ 20__" (not "Executed
        # Before"); and an ACCEPTED "address for service of the said Advocate"
        # clause + "Advocate for" signature (not the criminal/small-causes forms).
        "date_style": "dated_at",
        "acceptance_clause": (
            "ACCEPTED : The address for service of the said Advocate is : "
            "______________________ 20____"
        ),
        "advocate_sign_label": "Advocate for",
        # Verbatim (advocate civil_vakalat.pdf).
        "body_clause": (
            "do hereby appoint {advocates} To appear for And retain Me/Us In the "
            "above Suit/Original/Miscellaneous Petition and to conduct and prosecute "
            "Or defend the same and all proceedings that may be taken in respect of "
            "any application for any execution of any decree or order passed there in. "
            "I/We empower my/our Advocate to appear in all miscellaneous proceeding in "
            "the above suit or matter till all decree or orders are fully satisfied or "
            "adjusted and all appeals thereto whether in suit, interlocutory "
            "application, execution petitions and Applications in execution till they "
            "are finally disposed of in this court and to obtain the return of "
            "documents and draw moneys that might be payable to me/us in the said suit "
            "or matter. He is/They are also authorised to depute other Counsel to act "
            "on his / their behalf."
        ),
        "signature_label": "(Signature / LTI of the executant)",
        "has_fee_clause": False,
        "has_counter_agreement": False,
        "certificate_style": "read_out",
        "acceptance_line": None,
        "counsel_label": "Advocate for",
        # Civil form ends at the ACCEPTED clause — no 2-column advocate/party
        # details block (unlike criminal / small-causes / generic).
        "show_details_block": False,
        # Civil advocate form has NO title on page 1 (appoint clause follows the
        # parties directly); the "VAKALAT" title shows only on the backing sheet.
        "show_page1_title": False,
    },
}


@dataclass(frozen=True)
class VakalatnamaResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> VakalatnamaResult:
    return VakalatnamaResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="vakalatnama", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    kind: VakalatKind = VakalatKind.LONG,
    executant_name: str = "",
    party_role: str = "",          # e.g. "Plaintiff", "Petitioner", "Accused"
    advocates: Sequence[str] = (),
    case_ref: str = "",
    place: str = "",
    execution_date: Optional[date] = None,
    court_name: Optional[str] = None,
    court_place: Optional[str] = None,
    opposite_party_name: Optional[str] = None,
    enrolment_no: Optional[str] = None,
    address_for_service: Optional[str] = None,
    advocate_mobile: Optional[str] = None,
    advocate_email: Optional[str] = None,
    party_contact: Optional[str] = None,   # efiling "Details of the Parties"
    # The PARTY's (executant's) address — the "Details of the Parties > Address"
    # line. DISTINCT from `address_for_service`, which is the ADVOCATE's office
    # address. Keeping them separate stops the client's address being printed as
    # the advocate's address-for-service.
    party_address: Optional[str] = None,
    state_language: Optional[str] = None,  # attestation read-over language
    # Court-specific format (party labels, body clause, certificate). Defaults to
    # GENERIC so every existing caller/test is unaffected.
    court_kind: CourtKind = CourtKind.GENERIC,
    # Small-Causes fee amount (Rs.) for the fee clause; only used when the court
    # kind carries a fee clause.
    counsel_fee: Optional[str] = None,
) -> VakalatnamaResult:
    """Assemble the vakalatnama, or refuse."""

    advocate_list = [a for a in advocates if a and a.strip()]

    # GUARD: the advocate-to-appoint is a PERSON's name, never a case description.
    # The extractor, given "draft a vakalat for this case" + case notes, sometimes
    # dumps the whole matter summary into `advocates` (e.g. "Matter for Ambeth …,
    # Legal notice issued and complaint filed under Section 138 …"). A real advocate
    # name is short and has no matter/section phrasing. Reject any entry that looks
    # like a case description and, if that leaves nothing real, fall back to the
    # editable placeholder so the document renders a clean gap instead of garbage.
    _CASE_DESC = re.compile(
        r"matter for|legal notice|complaint filed|section\s*\d|proceedings|"
        r"negotiable instruments|dishonou?r|\bn\.?i\.? act\b|read with",
        re.IGNORECASE,
    )
    def _looks_like_a_name(a: str) -> bool:
        s = a.strip()
        if not s:
            return False
        if s.startswith("[") or "to be provided" in s.lower():
            return True  # an intentional placeholder is fine — renders as a gap
        if _CASE_DESC.search(s):
            return False  # a matter description, not an advocate name
        if len(s) > 80:
            return False  # far too long to be a person's name
        return True
    _had_entries = bool(advocate_list)
    advocate_list = [a for a in advocate_list if _looks_like_a_name(a)]
    if not advocate_list and _had_entries:
        # Entries WERE given but every one was garbage (a case description scraped by
        # the extractor). Don't refuse and don't print the garbage — render an
        # editable placeholder gap the advocate fills in. (A TRULY empty advocates=[]
        # still falls through to the refusal below — that's the honest "no
        # appointment" case for a direct caller.)
        advocate_list = ["[advocate name to be provided]"]

    # FILL-IN, never refuse (user rule): when a vakalat is drafted for a case and a
    # particular didn't extract, render a clearly-marked blank the advocate completes
    # rather than blocking the draft.
    # 1. advocate being appointed — placeholder when none found.
    if not advocate_list:
        advocate_list = ["[advocate name to be provided]"]

    # 2. executant (the party appointing) — placeholder when not named.
    if not executant_name.strip():
        executant_name = "[name of the party to be provided]"

    # 3. party role — placeholder when not identified.
    if not party_role.strip():
        party_role = "[role]"

    # 3. the e-filing short form is invalid without the advocate's Bar enrolment no.
    if kind is VakalatKind.EFILING and not (enrolment_no and enrolment_no.strip()):
        return _refuse(
            "the e-filing vakalatnama must record the advocate's Bar Council "
            "enrolment number; it is absent and the form would be rejected at "
            "e-filing",
            code="vakalatnama_enrolment_no_missing",
            fields=("enrolment_no",),
        )

    spec = _COURT_KIND_SPEC[court_kind.value]

    # --- normalise the court name (fix #1: doubled "COURT OF") ---
    # The template renders "IN THE COURT OF {{ court_name }}". If the supplied
    # court_name ALREADY begins with "Court of ..." or "In the Court of ...", the
    # prefix doubles ("IN THE COURT OF COURT OF THE MAGISTRATE..."). Strip any such
    # leading phrase so the prefix is applied exactly once.
    def _normalise_court(name: Optional[str]) -> Optional[str]:
        if not name:
            return name
        n = name.strip()
        for lead in ("in the court of ", "court of "):
            if n.lower().startswith(lead):
                n = n[len(lead):].lstrip()
        return n
    court_name = _normalise_court(court_name)

    # --- case reference (fix #2: don't inherit a complaint's case number) ---
    # A vakalat's number is the court-assigned filing number, printed as
    # "No. ___ of 20__" until assigned. If the passed case_ref is a DIFFERENT
    # document's registry label (e.g. "CRIMINAL COMPLAINT NO. __ OF 2026",
    # "S.T.C. No. ...", "C.C. No. ..."), it must NOT appear on the vakalat — drop
    # it so the template shows the blank "No. ___ of 20__".
    def _clean_case_ref(ref: str) -> str:
        r = (ref or "").strip()
        if not r:
            return ""
        low = r.lower()
        if any(k in low for k in ("complaint no", "complaint no.", "s.t.c", "stc ",
                                   "c.c. no", "cc no", "crl", "criminal complaint")):
            return ""  # a different document's number — leave the vakalat blank
        return r
    case_ref = _clean_case_ref(case_ref)

    # Render the verbatim body clause with the named advocate(s) (and party role
    # for Small Causes). The advocate list is joined "A, B and C" — as an advocate
    # would write it. When no court-kind body clause exists (GENERIC), the template
    # falls back to its neutral default.
    def _join_advocates(names: List[str]) -> str:
        if len(names) == 1:
            return names[0]
        return ", ".join(names[:-1]) + " and " + names[-1]

    body_clause = spec.get("body_clause")
    if body_clause:
        body_clause = body_clause.format(
            advocates=_join_advocates(advocate_list),
            party_role=party_role,
        )

    # PLACE is the town where the vakalat is signed. On the advocate's printed form
    # it's a fill-in-later blank, so when it's not on record we render an underline
    # gap ("Dated at ____ this ...") rather than refusing to draft. (User rule: if
    # a detail isn't in the documents, leave a placeholder — never refuse.)
    place_display = place.strip() if place and place.strip() else "____________"

    context: Dict[str, Any] = {
        "kind": kind.value,
        "executant_name": executant_name,
        "party_role": party_role,
        "advocates": advocate_list,
        "case_ref": case_ref,
        "place": place_display,
        "execution_date": execution_date.isoformat() if execution_date else None,
        "court_name": court_name,
        "court_place": court_place,
        "opposite_party_name": opposite_party_name,
        "enrolment_no": enrolment_no,
        "address_for_service": address_for_service,
        # Show the advocate's address-for-service ONLY when a real advocate is on
        # record (not a "[… to be provided]" placeholder) AND an address was given.
        # This stops the client's address leaking into the advocate's field.
        "advocate_address_shown": bool(
            address_for_service and address_for_service.strip()
            and advocate_list
            and not any("to be provided" in a.lower() or a.strip().startswith("[")
                        for a in advocate_list)
        ),
        "advocate_mobile": advocate_mobile,
        "advocate_email": advocate_email,
        "party_contact": party_contact,
        "party_address": party_address,
        "state_language": state_language,
        # --- court-kind format (per docs/vakalatnama-court-formats.md) ---
        "court_kind": court_kind.value,
        "vakalat_title": spec["title"],
        # A fixed court heading (Small Causes) overrides the court_name placeholder.
        "court_heading": spec.get("court_heading"),
        "executant_role_choices": spec["executant_roles"],
        "opposite_role_choices": spec["opposite_roles"],
        "opposite_label": spec.get("opposite_label", "Opposite Party"),
        # Executant party label — the civil form stacks "Plaintiff / Petitioner";
        # other kinds use the single chosen party_role.
        "executant_label": spec.get("executant_label", party_role),
        "body_clause": body_clause,
        "signature_label": spec.get("signature_label"),
        "acceptance_line": spec.get("acceptance_line"),
        "counsel_label": spec.get("counsel_label"),
        "has_fee_clause": spec["has_fee_clause"],
        "has_counter_agreement": spec["has_counter_agreement"],
        "certificate_style": spec["certificate_style"],
        "counsel_fee": counsel_fee,
        # Civil-form specifics (defaults keep other kinds unchanged):
        #  - date_style "dated_at" -> "Dated at __ this __ day of __ 20__"
        #    else the default "Executed Before this __ day of __ 20__".
        #  - acceptance_clause -> the civil "ACCEPTED: address for service" line.
        #  - advocate_sign_label -> the signature caption ("Advocate for").
        "date_style": spec.get("date_style", "executed_before"),
        "acceptance_clause": spec.get("acceptance_clause"),
        "advocate_sign_label": spec.get("advocate_sign_label", "Advocate"),
        # The 2-column advocate/party details block appears on the criminal /
        # small-causes / generic forms but NOT on the civil form (which ends at
        # the ACCEPTED "address for service" clause). Default True; the civil
        # spec sets it False via "show_details_block".
        "show_details_block": spec.get("show_details_block", True),
        # The page-1 title (VAKALAT / VAKALATNAMA heading between the parties and
        # the body clause) appears on the criminal / small-causes / generic forms
        # but NOT on the civil form (whose advocate original has the appoint clause
        # follow the parties directly; the title shows only on the page-2 backing
        # sheet). Default True; the civil spec sets it False.
        "show_page1_title": spec.get("show_page1_title", True),
    }
    return VakalatnamaResult(refused=False, context=context)
