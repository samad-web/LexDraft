"""r7: free-text relief spliced into "pleased to ..." read "pleased to To dismiss ...,"
and "directing the respondents to A direction to ..."."""
import pytest

from src.components.prayer import relief_clause


@pytest.mark.parametrize("given,want", [
    ("To dismiss I.A. No. 1120 of 2026 and decline the interim injunction.", "dismiss I.A. No. 1120 of 2026 and decline the interim injunction"),
    ("A direction to the respondent to issue patta in his name.", "issue patta in his name"),
    ("directing the respondents to consider his representation;", "consider his representation"),
    ("TNEB to restore supply.", "TNEB to restore supply"),
    ("", ""),
])
def test_relief_clause(given, want):
    assert relief_clause(given) == want


def test_writ_petition_prayer_direction_without_article():
    # r12: "directing the respondents to direction to the respondents to consider ..."
    assert relief_clause("direction to the respondents to consider the petitioner's representation") \
        == "consider the petitioner's representation"
    assert relief_clause("Directions to the respondent to sanction pension.") == "sanction pension"
