"""Turn the list sections of the hand-authored templates into ruled tables
(build-docs/features/evidence-tables.md): a list of documents, list of dates or index
of annexures prints as a table with a heading row, its rows a docxtpl {%tr for %} loop.

Run once from the engine root: python tools/tableize_templates.py
Idempotent: a template whose loop paragraphs are already gone is left alone.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import List

from docx import Document

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.service.tables import add_table  # noqa: E402

SHARED = ROOT / "templates" / "shared"

# template: [(first loop paragraph text, last loop paragraph text, loop, headings, cells,
#             a typical row - sizes the columns, never printed)]
JOBS = {
    "s138_complaint.docx": [(
        "{%p for d in document_records %}", "{%p endfor %}", "d in document_records",
        ["Sr. No", "Date", "Description of document", "Remarks"],
        ["{{ loop.index }}", "{{ d.date_body }}", "{{ d.description }}", "{{ d.remarks }}"],
        ["15", "25-04-2026", "Cheque issued to the complainant, Cheque No. 000102 for Rs. 3,00,000/-", "Office copy"],
    )],
    "counter_affidavit.docx": [(
        "{% for d in documents %}", "{% endfor %}", "d in documents",
        ["Sr. No", "Description of document"],
        ["{{ loop.index }}", "{{ d }}"],
        ["10", "Sale deed dated 01.01.2004 registered as Doc. No. 123 of 2004"],
    )],
    "call_for_memo.docx": [(
        "{% for d in documents %}", "{% endfor %}", "d in documents",
        ["Sr. No", "Description of document"],
        ["{{ loop.index }}", "{{ d }}"],
        ["10", "Certified copy of the deposition of PW-1"],
    )],
    "appeal_record_cost_schedule.docx": [(
        "{% for d in documents %}", "{% endfor %}", "d in documents",
        ["Sr. No", "Description of document", "Whole or part", "Mark in lower court",
         "Pages to translate", "Pages to print", "Estimated cost"],
        ["{{ loop.index }}",
         "{{ d.description }}{% if d.pages %} ({{ d.pages }} pages){% endif %}"
         "{% if d.count %} ({{ d.count }} in number){% endif %}",
         "{{ d.whole_or_part or '' }}", "{{ d.mark_in_lower_court or '' }}",
         "{{ d.pages_translation or '' }}", "{{ d.pages_printing or '' }}",
         "{% if d.cost_estimate %}{{ d.cost_estimate }}{% else %}[to be computed at the "
         "rate prescribed by the Court]{% endif %}"],
        ["10", "Typed matter of the record (120 pages)", "whole", "Ex. A-1", "120", "120", "Rs. 1,200"],
    )],
}


def _table_rows(loop: str, headings: List[str], cells: List[str]) -> List[List[str]]:
    blank = [""] * (len(headings) - 1)
    return [headings, ["{%tr for " + loop + " %}", *blank], cells, ["{%tr endfor %}", *blank]]


def _replace_loop(doc, first: str, last: str, loop: str, headings, cells, sample) -> bool:
    paras = doc.paragraphs
    starts = [i for i, p in enumerate(paras) if p.text.strip() == first]
    if not starts:
        return False
    i = starts[0]
    j = next(k for k in range(i + 1, len(paras)) if paras[k].text.strip() == last)
    table = add_table(doc, _table_rows(loop, headings, cells), sizing=[sample])
    paras[i]._p.addprevious(table._tbl)
    for p in paras[i:j + 1]:
        p._p.getparent().remove(p._p)
    return True


def _slp(doc) -> bool:
    """SLP: the list of dates as Date | Event, the index of annexures as a table."""
    changed = False
    for p in doc.paragraphs:
        text = p.text
        if text.startswith("{% if list_of_dates %}{% for d in list_of_dates %}"):
            placeholder = text[text.index("{% else %}") + len("{% else %}"):text.rindex("{% endif %}")]
            table = add_table(doc, _table_rows("r in date_rows", ["Date", "Event"],
                                               ["{{ r.date }}", "{{ r.event }}"]),
                              sizing=[["14.12.2015", "The High Court passed the impugned final judgment and order."]])
            _wrap(p, table, "list_of_dates", placeholder)
            changed = True
        elif text.startswith("{% if annexures %}{% for a in annexures %}"):
            placeholder = text[text.index("{% else %}") + len("{% else %}"):text.rindex("{% endif %}")]
            table = add_table(doc, _table_rows("a in annexures", ["Annexure", "Description", "Page"],
                                               ["P-{{ loop.index }}", "{{ a }}", ""]),
                              sizing=[["P-10", "True copy of the impugned judgment dated 14.12.2015 in W.P. No. 5427 of 2004", "100-120"]])
            _wrap(p, table, "annexures", placeholder)
            changed = True
    return changed


def _wrap(p, table, var: str, placeholder: str) -> None:
    """Replace paragraph p with: {%p if var %} TABLE {%p else %} placeholder {%p endif %}."""
    import copy
    def para(text):
        el = copy.deepcopy(p._p)
        p._p.addprevious(el)
        from docx.text.paragraph import Paragraph
        q = Paragraph(el, p._parent)
        runs = q.runs
        runs[0].text = text
        for r in runs[1:]:
            r.text = ""
    para("{%p if " + var + " %}")
    p._p.addprevious(table._tbl)
    para("{%p else %}")
    para(placeholder)
    para("{%p endif %}")
    p._p.getparent().remove(p._p)


def main() -> None:
    for name, jobs in JOBS.items():
        doc = Document(str(SHARED / name))
        if any(_replace_loop(doc, *job) for job in jobs):
            doc.save(str(SHARED / name))
            print("tableized", name)
    slp = SHARED / "special_leave_petition.docx"
    doc = Document(str(slp))
    if _slp(doc):
        doc.save(str(slp))
        print("tableized", slp.name)


if __name__ == "__main__":
    main()
