"""In-place Tamil rendering of a produced .docx — PROOF OF CONCEPT (vakalatnama).

The engine renders every document from an English .docx template into a laid-out
.docx (correct tables, alignment, backing sheets). To offer a Tamil version WITHOUT
re-authoring every template, this module walks the ALREADY-RENDERED .docx and
translates each text run IN PLACE — so the layout, tables, fonts and positioning
are byte-for-byte preserved and only the words change.

Translation is GLOSSARY-BASED and deterministic (no network, no LLM): a curated
map of the fixed legal-Tamil boilerplate a court form uses. This is deliberately
higher-quality and more consistent than free machine translation for the fixed
phrases (a court expects the SAME wording every time). Dynamic content the glossary
doesn't cover — party names, addresses, numbers — is left as-is (proper nouns and
figures are not translated). Coverage grows as we verify more legal-Tamil wording.

Scope now: the vakalatnama boilerplate, as the proof. `translate_docx_to_tamil`
is generic, so extending to another form is just adding glossary entries.
"""

from __future__ import annotations

from pathlib import Path
from typing import Union
import re

from docx import Document

# -- Legal-Tamil glossary ----------------------------------------------------
# Ordered longest-first at match time so multi-word phrases win over their parts.
# Keys are matched case-INSENSITIVELY as whole phrases within a run's text.
# VERIFY: these are a starting set for the proof; a Tamil-legal reviewer should
# confirm the court-preferred wording before production use.
_GLOSSARY: dict[str, str] = {
    # headings / titles
    "IN THE COURT OF": "நீதிமன்றத்தில்",
    "IN THE COURT OF THE": "நீதிமன்றத்தில்",
    "VAKALATNAMA": "வக்காலத்நாமா",
    "VAKALAT": "வக்காலத்",
    "Versus": "எதிராக",
    "Verses": "எதிராக",
    # party roles
    "Plaintiff": "வாதி",
    "Defendant": "பிரதிவாதி",
    "Petitioner": "மனுதாரர்",
    "Respondent": "எதிர்மனுதாரர்",
    "Complainant": "புகார்தாரர்",
    "Accused": "குற்றம் சாட்டப்பட்டவர்",
    "Claimant": "உரிமைகோருபவர்",
    # vakalat opening — translate the CONNECTIVE PHRASES around the interpolated
    # name/advocate as whole units, so the Tamil reads in natural word order
    # (appoint-verb AFTER the advocate name, no stray English "the"). The rendered
    # civil opening is: "I/We, {NAME}, the {ROLE} above-named, do hereby appoint
    # {ADV} To appear for And retain Me/Us In the above ...". These phrases split it
    # cleanly around {NAME} and {ADV}.
    # Split the opening around {NAME} and {ADV}. Result reads:
    #   "நான்/நாங்கள், {NAME}, மேற்குறிப்பிட்ட {ROLE}யாகிய, {ADV} ஆகியோரை
    #    இதன்மூலம் நியமித்து, மேற்படி வழக்கில் ..."
    # ", the " opens the role clause; " above-named, do hereby appoint " closes it
    # and starts the appointment — placed so the appoint-verb follows the advocate.
    ", the ": ", மேற்குறிப்பிட்ட ",
    " above-named, do hereby appoint ": "யாகிய, ",
    " above named, do hereby appoint ": "யாகிய, ",
    # After the advocate name comes the long body clause; prepend the appoint verb
    # to the body fragment so "{ADV} ஆகியோரை இதன்மூலம் நியமித்து," leads it.
    "do hereby appoint and retain": "ஆகியோரை இதன்மூலம் நியமித்து தக்கவைத்துக் கொள்கிறேன்",
    "do hereby appoint": "ஆகியோரை இதன்மூலம் நியமிக்கிறேன்",
    "to appear for me/us": "எனக்காக/எங்களுக்காக ஆஜராக",
    "Advocate": "வழக்கறிஞர்",
    "Counsel for": "இதற்கான வழக்கறிஞர்",
    "Address for service": "அறிவிப்பு வழங்கும் முகவரி",
    "Address for service :": "அறிவிப்பு வழங்கும் முகவரி :",
    "Enrolment No": "பதிவு எண்",
    "Mobile No.": "கைபேசி எண்",
    "Email Id": "மின்னஞ்சல் முகவரி",
    "Name": "பெயர்",
    "Address": "முகவரி",
    # Full dated line fragments (civil: "Dated at {place} this ___ day of ___ 20__").
    # Translated as anchored fragments so it reads "{place} இல், ___ ஆம் நாள் ___ 20__".
    "Dated at": "தேதியிட்ட இடம்:",
    " this ____________ day of ": " இல், ____________ ஆம் நாள் ",
    " this ____ day of ": " இல், ____ ஆம் நாள் ",
    "Dated this": "இந்த தேதியில்",
    "day of": "ஆம் நாள்",
    "I/We": "நான்/நாங்கள்",
    "No.": "எண்.",
    # "of 20____" is the blank-fill year fragment in "No. ______ of 20____"
    # (criminal vakalat, golden tn_vakalatnama_criminal.txt). Matching bare
    # "of 20" instead would also hit "of 2026" inside a real case-reference
    # year (e.g. "O.S. No. 12 of 2026") and mangle it — found via a real
    # rendered-document E2E check, not caught by the string-snippet unit
    # tests alone.
    "of 20____": "20____ இல்",
    "I/we accept the Vakalatnama": "வக்காலத்நாமாவை நான்/நாங்கள் ஏற்கிறேன்",
    "ACCEPTED": "ஏற்கப்பட்டது",
    "Details of the Parties": "தரப்பினர் விவரங்கள்",
    # -- full clause fragments (the long dynamic clauses; the advocate name sits
    #    BETWEEN "do hereby appoint" and this fragment, so it stays in place) --
    # CIVIL vakalat body (verbatim from civil_vakalat.pdf), everything AFTER the
    # appointed advocate name:
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
        "ஆகியோரை இதன்மூலம் நியமித்து, மேற்படி வழக்கு/மூல/இதர மனுவில் "
        "எனக்காக/எங்களுக்காக ஆஜராகவும், அதனை "
        "நடத்தவும், வழக்காடவும் அல்லது எதிர்வழக்காடவும், அதில் எடுக்கப்படும் "
        "அனைத்து நடவடிக்கைகளையும், எந்தவொரு தீர்ப்பு அல்லது உத்தரவை அமல்படுத்தும் "
        "விண்ணப்பம் உட்பட மேற்கொள்ள நியமிக்கிறேன்/நியமிக்கிறோம். மேற்படி வழக்கில் "
        "அனைத்து தீர்ப்புகளும் உத்தரவுகளும் முழுமையாக நிறைவேற்றப்படும் வரை, "
        "வழக்கு, இடைக்கால மனு, அமலாக்க மனுக்கள் மற்றும் அமலாக்க விண்ணப்பங்கள் "
        "உள்ளிட்ட அனைத்து இதர நடவடிக்கைகளிலும் இந்த நீதிமன்றத்தில் இறுதியாக "
        "முடிவடையும் வரை ஆஜராகவும், ஆவணங்களைத் திரும்பப் பெறவும், எனக்கு/எங்களுக்கு "
        "செலுத்தப்பட வேண்டிய தொகைகளைப் பெறவும் எனது/எங்களது வழக்கறிஞருக்கு "
        "அதிகாரம் அளிக்கிறேன்/அளிக்கிறோம். அவர்/அவர்கள் தமது சார்பாக செயல்பட வேறு "
        "வழக்கறிஞரை நியமிக்கவும் அதிகாரம் பெற்றுள்ளார்/பெற்றுள்ளனர்."
    ),
    # certificate (civil "read out and explained"):
    (
        "I Certify that the contents of this Vakalat were read out and explained in "
        "my presence to the Executant who appeared perfectly to understand the same "
        "and made his/her/their signature in my presence."
    ): (
        "இந்த வக்காலத்தின் உள்ளடக்கங்கள் என் முன்னிலையில் செயல்படுத்துபவருக்கு "
        "வாசித்து விளக்கப்பட்டது, அவர் அதை முழுமையாகப் புரிந்துகொண்டு என் "
        "முன்னிலையில் தமது கையொப்பமிட்டார் என்பதை நான் சான்றளிக்கிறேன்."
    ),
    "The address for service of the said Advocate is :":
        "மேற்படி வழக்கறிஞரின் அறிவிப்பு வழங்கும் முகவரி :",
    "above-named": "மேற்குறிப்பிட்ட",
    "above named": "மேற்குறிப்பிட்ட",
    "Mr./Ms.": "திரு./திருமதி.",
    "Mr.": "திரு.",
    "Ms.": "திருமதி.",
    # NOTE: bare English connectors ("the", "for", "this", "with") are deliberately
    # LEFT UNTRANSLATED — in Tamil these are grammatical SUFFIXES on the noun, not
    # standalone words, so word-for-word substitution reads wrong. They're rare
    # residue inside otherwise-Tamil clauses; a native-Tamil template (the upgrade
    # path) phrases them correctly. Better a tiny English residue than broken Tamil.
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
        # on their edges. This keeps short connectors safe without hurting phrases.
        if key.replace(" ", "").isalpha():
            # ASCII-letter boundaries (not \b): so "Name" won't hit inside "renamed",
            # BUT a key followed/preceded by a TAMIL letter still matches (Python's \b
            # treats Tamil as a word char, which would wrongly block "Plaintiffயாகிய"
            # after an adjacent fragment was already translated).
            pattern = re.compile(rf"(?<![A-Za-z]){esc}(?![A-Za-z])", re.IGNORECASE)
        else:
            pattern = re.compile(esc, re.IGNORECASE)
        out = pattern.sub(lambda _m, v=_GLOSSARY[key]: v, out)
    return out


def translate_docx_to_tamil(docx_path: Union[str, Path]) -> Path:
    """Walk a rendered .docx and translate every text run + table cell IN PLACE.

    Preserves ALL formatting/layout (only run .text is rewritten). Saves back to
    the same path and returns it. Idempotent-ish: re-running re-translates already
    -translated Tamil to itself (glossary values aren't glossary keys).
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
