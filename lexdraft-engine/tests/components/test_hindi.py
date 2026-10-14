"""Hindi glossary translator (proof: vakalatnama). Deterministic + offline.
Mirrors test_tamil.py exactly."""

from src.components.hindi import translate_text


def test_core_court_terms_translate():
    assert translate_text("IN THE COURT OF") == "न्यायालय में"
    assert translate_text("VAKALATNAMA") == "वकालतनामा"
    assert translate_text("Plaintiff") == "वादी"
    assert translate_text("Versus") == "बनाम"
    assert translate_text("Advocate") == "अधिवक्ता"


def test_proper_nouns_and_numbers_untouched():
    # Names / numbers must NOT be translated.
    assert "Mahendravarman" in translate_text("Mahendravarman")
    assert "A. Kumar" in translate_text("A. Kumar")
    # A plain non-legal sentence stays as-is.
    assert translate_text("Cheque bounced") == "Cheque bounced"


def test_word_boundary_short_key_no_midword_hit():
    # A short alpha key like "Name" must not corrupt a word that contains it.
    out = translate_text("The document was renamed and unnamed.")
    assert "renamed" in out and "unnamed" in out


def test_longest_phrase_wins_over_fragment():
    # "IN THE COURT OF THE" should map as the whole phrase, not leave "THE" dangling.
    out = translate_text("IN THE COURT OF THE")
    assert out == "न्यायालय में"


def test_empty_and_blank_passthrough():
    assert translate_text("") == ""
    assert translate_text("   ") == "   "


def test_hindi_and_tamil_glossaries_cover_the_same_key_set():
    # Both proofs scope to the vakalatnama boilerplate in lockstep (per both
    # modules' docstrings) — a key added to one and not the other is a real
    # coverage gap, not a stylistic difference between languages.
    from src.components.tamil import _GLOSSARY as tamil_glossary
    from src.components.hindi import _GLOSSARY as hindi_glossary

    tamil_only = set(tamil_glossary) - set(hindi_glossary)
    hindi_only = set(hindi_glossary) - set(tamil_glossary)
    assert not tamil_only, f"keys in Tamil glossary missing from Hindi: {tamil_only}"
    assert not hindi_only, f"keys in Hindi glossary missing from Tamil: {hindi_only}"
