"""A respondent named by a public office counts as a State / Art.12 authority even
when the form leaves is_authority unset; a private company does not."""

from src.service.adapters.writ_petition import _respondent_party


def test_public_offices_are_authorities():
    for name in ["The District Collector, Salem", "The Tahsildar, Salem Taluk",
                 "Union of India, rep. by its Secretary", "The Inspector of Police, E4 Police Station",
                 "The Commissioner, Greater Chennai Corporation", "State of Tamil Nadu"]:
        assert _respondent_party({"name": name}).is_authority, name


def test_private_parties_stay_private_unless_flagged():
    for name in ["M/s XYZ Corporation Ltd", "Thiru. K. Murugan", "ABC Builders, rep. by its Director"]:
        assert not _respondent_party({"name": name}).is_authority, name
    assert _respondent_party({"name": "M/s XYZ Ltd", "is_authority": True}).is_authority
