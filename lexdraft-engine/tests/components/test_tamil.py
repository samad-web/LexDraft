"""Tamil glossary translator (proof: vakalatnama). Deterministic + offline."""

from src.components.tamil import translate_text


def test_core_court_terms_translate():
    assert translate_text("IN THE COURT OF") == "நீதிமன்றத்தில்"
    assert translate_text("VAKALATNAMA") == "வக்காலத்நாமா"
    assert translate_text("Plaintiff") == "வாதி"
    assert translate_text("Versus") == "எதிராக"
    assert translate_text("Advocate") == "வழக்கறிஞர்"


def test_proper_nouns_and_numbers_untouched():
    # Names / numbers must NOT be translated.
    assert "Mahendravarman" in translate_text("Mahendravarman")
    assert "A. Kumar" in translate_text("A. Kumar")
    # A plain non-legal sentence stays as-is.
    assert translate_text("Cheque bounced") == "Cheque bounced"


def test_word_boundary_short_key_no_midword_hit():
    # A short alpha key like "Name" must not corrupt a word that contains it.
    # "Named" should NOT become "<tamil>d".
    out = translate_text("The document was renamed and unnamed.")
    assert "renamed" in out and "unnamed" in out


def test_longest_phrase_wins_over_fragment():
    # "IN THE COURT OF THE" should map as the whole phrase, not leave "THE" dangling.
    out = translate_text("IN THE COURT OF THE")
    assert out == "நீதிமன்றத்தில்"


def test_empty_and_blank_passthrough():
    assert translate_text("") == ""
    assert translate_text("   ") == "   "
