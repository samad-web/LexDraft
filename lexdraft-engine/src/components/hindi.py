"""In-place Hindi rendering of a produced .docx — PROOF OF CONCEPT (vakalatnama).

Mirrors components/tamil.py exactly — same mechanism, same scope, same caveats.
The engine renders every document from an English .docx template into a laid-out
.docx (correct tables, alignment, backing sheets). To offer a Hindi version WITHOUT
re-authoring every template, this module walks the ALREADY-RENDERED .docx and
translates each text run IN PLACE — so the layout, tables, fonts and positioning
are byte-for-byte preserved and only the words change.

Translation is GLOSSARY-BASED and deterministic (no network, no LLM): a curated
map of the fixed legal-Hindi boilerplate a court form uses — the terminology
Hindi-medium district courts (UP, Bihar, MP, Rajasthan, etc.) actually use, not a
machine translation of the English. Dynamic content the glossary doesn't cover —
party names, addresses, numbers — is left as-is. Coverage grows as we verify more
legal-Hindi wording.

VERIFY: these are a starting set for the proof; a Hindi-legal reviewer (ideally
one practising in a Hindi-medium court) should confirm the court-preferred
wording before production use — same standing caveat components/tamil.py carries
for its glossary.

Scope now: the vakalatnama boilerplate, mirroring Tamil's scope exactly, so the
two can be reviewed and extended in lockstep. `translate_docx_to_hindi` is
generic, so extending to another form is just adding glossary entries.
"""

from __future__ import annotations

from pathlib import Path
from typing import Union
import re

from docx import Document

# -- Legal-Hindi glossary -----------------------------------------------------
# Ordered longest-first at match time so multi-word phrases win over their parts.
# Keys are matched case-INSENSITIVELY as whole phrases within a run's text.
# VERIFY: see module docstring.
_GLOSSARY: dict[str, str] = {
    # headings / titles
    "IN THE COURT OF": "न्यायालय में",
    "IN THE COURT OF THE": "न्यायालय में",
    "VAKALATNAMA": "वकालतनामा",
    "VAKALAT": "वकालत",
    "Versus": "बनाम",
    "Verses": "बनाम",
    # party roles
    "Plaintiff": "वादी",
    "Defendant": "प्रतिवादी",
    "Petitioner": "याचिकाकर्ता",
    "Respondent": "प्रत्यर्थी",
    "Complainant": "परिवादी",
    "Accused": "अभियुक्त",
    "Claimant": "दावेदार",
    # vakalat opening — translate the CONNECTIVE PHRASES around the interpolated
    # name/advocate as whole units, mirroring tamil.py's approach, so Hindi reads
    # in natural word order. Rendered civil opening: "I/We, {NAME}, the {ROLE}
    # above-named, do hereby appoint {ADV} To appear for And retain Me/Us In the
    # above ...".
    ", the ": ", उपरोक्त ",
    " above-named, do hereby appoint ": " को, एतद्द्वारा नियुक्त करता/करते हैं ",
    " above named, do hereby appoint ": " को, एतद्द्वारा नियुक्त करता/करते हैं ",
    "do hereby appoint and retain": "एतद्द्वारा नियुक्त एवं प्रतिधारित करता/करते हैं",
    "do hereby appoint": "एतद्द्वारा नियुक्त करता/करते हैं",
    "to appear for me/us": "मेरी/हमारी ओर से उपस्थित होने",
    "Advocate": "अधिवक्ता",
    "Counsel for": "की ओर से अधिवक्ता",
    "Address for service": "तामील हेतु पता",
    "Address for service :": "तामील हेतु पता :",
    "Enrolment No": "नामांकन क्रमांक",
    "Mobile No.": "मोबाइल क्रमांक",
    "Email Id": "ईमेल पता",
    "Name": "नाम",
    "Address": "पता",
    # Full dated line fragments (civil: "Dated at {place} this ___ day of ___ 20__").
    "Dated at": "दिनांकित स्थान:",
    " this ____________ day of ": " को, ____________ तारीख ",
    " this ____ day of ": " को, ____ तारीख ",
    "Dated this": "दिनांक",
    "day of": "तारीख",
    "I/We": "मैं/हम",
    "No.": "क्रमांक",
    # "of 20____" is the blank-fill year fragment in "No. ______ of 20____"
    # (criminal vakalat, golden tn_vakalatnama_criminal.txt). Matching bare
    # "of 20" instead would also hit "of 2026" inside a real case-reference
    # year (e.g. "O.S. No. 12 of 2026") and mangle it — found via a real
    # rendered-document E2E check (see tamil.py's identical fix/comment;
    # this bug was pre-existing in Tamil and mirrored here before being
    # caught and fixed in both).
    "of 20____": "20____ का",
    "I/we accept the Vakalatnama": "मैं/हम वकालतनामा स्वीकार करता/करते हैं",
    "ACCEPTED": "स्वीकृत",
    "Details of the Parties": "पक्षकारों का विवरण",
    # -- full clause fragments (the long dynamic clauses; the advocate name sits
    #    BETWEEN "do hereby appoint" and this fragment, so it stays in place) --
    (
        "To appear for And retain Me/Us In the above Suit/Original/Miscellaneous "
        "Petition and to conduct and prosecute Or defend the same and all proceedings "
        "that may be taken in respect of any application for any execution of any "
        "decree or order passed there in. I/We empower my/our Advocate to appear in "
        "all miscellaneous proceeding in the above suit or matter till all decree or "
        "orders are fully satisfied or adjusted and all appeals thereto whether in "
        "suit, interlocutory application, execution petitions and Applications in "
        "execution till they are finally disposed of in this court and to obtain the "
        "return of documents and draw moneys that might be payable to me/us in the "
        "said suit or matter. He is/They are also authorised to depute other Counsel "
        "to act on his / their behalf."
    ): (
        "को एतद्द्वारा नियुक्त करता/करते हैं कि वे उपरोक्त वाद/मूल/विविध याचिका में "
        "मेरी/हमारी ओर से उपस्थित हों, उसका संचालन करें तथा अभियोजन या प्रतिरक्षा करें, "
        "तथा उसमें होने वाली समस्त कार्यवाहियों में, किसी भी डिक्री या आदेश के "
        "निष्पादन हेतु किसी भी आवेदन सहित, उपस्थित हों। मैं/हम अपने अधिवक्ता को "
        "अधिकृत करता/करते हैं कि वे उक्त वाद या मामले में सभी डिक्री या आदेश पूर्णतः "
        "संतुष्ट या समायोजित होने तक, तथा वाद, अंतरिम आवेदन, निष्पादन याचिकाओं एवं "
        "निष्पादन में आवेदनों सहित समस्त अपीलों के इस न्यायालय में अंततः निस्तारित "
        "होने तक, सभी विविध कार्यवाहियों में उपस्थित हों, दस्तावेज वापस प्राप्त करें "
        "तथा मुझे/हमें देय धनराशि प्राप्त करें। वे अपनी ओर से कार्य हेतु अन्य "
        "अधिवक्ता नियुक्त करने हेतु भी अधिकृत हैं।"
    ),
    # certificate (civil "read out and explained"):
    (
        "I Certify that the contents of this Vakalat were read out and explained in "
        "my presence to the Executant who appeared perfectly to understand the same "
        "and made his/her/their signature in my presence."
    ): (
        "मैं प्रमाणित करता हूँ कि इस वकालत की विषय-वस्तु मेरे समक्ष निष्पादक को पढ़कर "
        "सुनाई एवं समझाई गई, जिसे उसने पूर्णतः समझा तथा मेरे समक्ष अपने हस्ताक्षर किए।"
    ),
    "The address for service of the said Advocate is :":
        "उक्त अधिवक्ता का तामील हेतु पता है :",
    "above-named": "उपरोक्त नामित",
    "above named": "उपरोक्त नामित",
    "Mr./Ms.": "श्री/श्रीमती",
    "Mr.": "श्री",
    "Ms.": "श्रीमती",
    # NOTE: mirrors tamil.py's note — bare English connectors ("the", "for",
    # "this", "with") are deliberately LEFT UNTRANSLATED where they'd otherwise
    # require Hindi case-marker (postposition) agreement with the noun rather
    # than a standalone word-for-word swap. Rare residue inside otherwise-Hindi
    # clauses; a native-Hindi template (the upgrade path) phrases them correctly.
}

# Pre-sort keys longest-first so "IN THE COURT OF THE" beats "IN THE COURT OF".
_KEYS_LONGEST_FIRST = sorted(_GLOSSARY.keys(), key=len, reverse=True)


def translate_text(text: str) -> str:
    """Translate the glossary phrases in a single run of text, longest-match first.

    Whole-phrase, case-insensitive replacement; anything not in the glossary
    (names, numbers, addresses) is left untouched. Returns the text unchanged when
    nothing matches, so runs with no boilerplate keep their exact original.
    """
    if not text or not text.strip():
        return text
    out = text
    for key in _KEYS_LONGEST_FIRST:
        esc = re.escape(key)
        # For a purely-alphabetic key (e.g. "the", "for"), require WORD BOUNDARIES so
        # "the" doesn't hit inside "there"/"other". Phrases with punctuation/spaces
        # ("No.", "of 20", the long clauses) match as-is — boundaries would misfire
        # on their edges. Mirrors tamil.py's Devanagari-safe boundary handling: use
        # ASCII-letter lookaround (not \b) so a key adjacent to already-translated
        # Hindi text still matches.
        if key.replace(" ", "").isalpha():
            pattern = re.compile(rf"(?<![A-Za-z]){esc}(?![A-Za-z])", re.IGNORECASE)
        else:
            pattern = re.compile(esc, re.IGNORECASE)
        out = pattern.sub(lambda _m, v=_GLOSSARY[key]: v, out)
    return out


def translate_docx_to_hindi(docx_path: Union[str, Path]) -> Path:
    """Walk a rendered .docx and translate every text run + table cell IN PLACE.

    Preserves ALL formatting/layout (only run .text is rewritten). Saves back to
    the same path and returns it. Idempotent-ish: re-running re-translates already
    -translated Hindi to itself (glossary values aren't glossary keys).
    """
    path = Path(docx_path)
    doc = Document(str(path))

    def _walk_paragraph(p) -> None:
        for run in p.runs:
            translated = translate_text(run.text)
            if translated != run.text:
                run.text = translated

    for p in doc.paragraphs:
        _walk_paragraph(p)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    _walk_paragraph(p)
    # headers/footers too (backing sheets sometimes live there)
    for section in doc.sections:
        for container in (section.header, section.footer):
            for p in container.paragraphs:
                _walk_paragraph(p)

    doc.save(str(path))
    return path
