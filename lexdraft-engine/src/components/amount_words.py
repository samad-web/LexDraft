"""Rupee amount -> words, Indian numbering system (lakh / crore).

Deterministic. Used wherever a spec requires an amount 'in figures and words,
matching' (e.g. s.138 notice demand). Whole rupees only; paise handling can be
added when a spec needs it.
"""

from __future__ import annotations

_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety",
]


def _two_digits(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + ("-" + _ONES[ones] if ones else "")


def _three_digits(n: int) -> str:
    """0..999 in words (hundreds place)."""
    hundreds, rest = divmod(n, 100)
    parts = []
    if hundreds:
        parts.append(_ONES[hundreds] + " hundred")
    if rest:
        if parts:
            parts.append("and")
        parts.append(_two_digits(rest))
    return " ".join(parts)


def rupees_in_words(amount: int) -> str:
    """Whole-rupee amount in Indian-numbering words, e.g.
    125000 -> 'one lakh twenty-five thousand'."""
    if amount < 0:
        raise ValueError("amount must be non-negative")
    if amount == 0:
        return "zero"

    crore, rest = divmod(amount, 10_000_000)
    lakh, rest = divmod(rest, 100_000)
    thousand, rest = divmod(rest, 1_000)
    hundreds = rest

    parts = []
    if crore:
        parts.append(_group_in_words(crore) + " crore")
    if lakh:
        parts.append(_two_digits(lakh) if lakh < 100 else _three_digits(lakh))
        parts[-1] += " lakh"
    if thousand:
        parts.append((_two_digits(thousand) if thousand < 100
                      else _three_digits(thousand)) + " thousand")
    if hundreds:
        parts.append(_three_digits(hundreds))

    return " ".join(parts)


def _group_in_words(n: int) -> str:
    """A crore-group value (can itself exceed 99 for very large amounts)."""
    if n < 100:
        return _two_digits(n)
    return _three_digits(n)
