"""The vakalatnama is now a FILL-IN form (user rule: if a detail isn't on record,
leave a placeholder — never refuse and never dead-end asking). So an EMPTY or
all-blank `advocates` list no longer 422s and no longer hard-refuses: it coerces
through, and the pipeline renders "[advocate name to be provided]" as an editable
gap. Real entries are still kept and blanks dropped.
"""

import pytest

from src.service import adapters
from src.service.adapters import AdapterValidationError
import src.service.adapters.vakalatnama  # register the adapter


def _base(**over):
    kw = dict(kind="long", executant_name="Ambeth Arivukarasan",
              party_role="Complainant", advocates=["M. Gowtham"],
              case_ref="S.T.C. No. 1 of 2026", place="Chennai",
              court_kind="criminal")
    kw.update(over)
    return kw


def _adapter():
    return adapters.get_adapter("vakalatnama")


def test_valid_advocates_coerce_ok():
    kw = _adapter().coerce(_base())
    assert kw["advocates"] == ["M. Gowtham"]


def test_empty_advocates_coerces_through_no_422():
    # FILL-IN: an empty list is allowed (no 422); the pipeline placeholders it.
    kw = _adapter().coerce(_base(advocates=[]))
    assert kw.get("advocates", []) == []
    from src.pipelines import vakalatnama as vk
    r = vk.build(**kw)
    assert not r.refused
    assert r.context["advocates"] == ["[advocate name to be provided]"]


def test_all_blank_advocates_coerces_through_no_422():
    # All-blank entries no longer 422; the pipeline filters them and placeholders it.
    kw = _adapter().coerce(_base(advocates=["  ", ""]))
    from src.pipelines import vakalatnama as vk
    r = vk.build(**kw)
    assert not r.refused
    assert r.context["advocates"] == ["[advocate name to be provided]"]


def test_placeholder_advocates_passes_through_for_draft_now_gap():
    # A bracketed placeholder is DELIBERATELY allowed through so the draft-now
    # gesture can render the field as a visible, advocate-editable gap instead of
    # dead-ending. (A genuinely empty/whitespace list still 422s — see above.)
    kw = _adapter().coerce(_base(advocates=["[advocate name to be provided]"]))
    assert kw["advocates"] == ["[advocate name to be provided]"]


def test_blank_entries_are_dropped_but_real_ones_kept():
    # The pipeline drops blank/whitespace entries and keeps the real advocate name.
    kw = _adapter().coerce(_base(advocates=["M. Gowtham", "  ", ""]))
    from src.pipelines import vakalatnama as vk
    r = vk.build(**kw)
    assert r.context["advocates"] == ["M. Gowtham"]
