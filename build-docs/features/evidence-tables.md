# Evidence tables (list of documents, annexures, summaries)

Status: built and tested locally 2026-11-14, incl. part 2 (built-in format templates, Copy as table, editor plain text); not deployed.

## Purpose
Indian court practice sets out evidence material as a ruled table, not prose: a list of documents (Sr. No | Date | Description of document | Remarks), an index of annexures, a list of dates, or a summary of admissions (Point | Admission / Position). DifAi currently flattens these into text:
- The compose prompt says "no tables" (`intake-compose.service.ts:684`), and so does the open-drafting prompt (`open-draft.service.ts:97`).
- `normaliseComposedMarkdown` turns any table into `a  |  b` text lines.
- `compose_docx` (engine `src/service/compose.py`) has no table block.
- Templates write "LIST OF DOCUMENTS:" as plain lines (`build_templates.py:1020`, 3157, 4907).

## Rule (user, 2026-11-14)
Any evidence material in a draft or a format must be a table, whether a list of documents, list of dates, index or annexures, summary of evidence or admissions, or schedule of documents. That covers the preview, Word and PDF.

## Architecture
- **Text form:** a table stays as pipe rows in the draft text. The first row is the column headings, one row per line, with no `|---|` rule. Consecutive pipe rows make one table block. This means Save, redraft and edits keep working on plain text.
- **Prompts:** both prompts change "no tables" to "evidence lists and summaries as a table, first row the headings". Standard columns:
  - List of documents: Sr. No | Date | Description of document | Remarks
  - Index of annexures: Annexure | Description | Page
  - List of dates: Date | Event
  - Summary of admissions: Point | Admission / Position
- **normaliseComposedMarkdown:** keeps pipe rows as pipe rows, drops the rule line and pads rows to the header's column count.
- **Segmenter:** a table block is never renumbered or split into paragraphs.
- **Preview:** `DraftBlockText.tsx` renders a table block as a bordered table.
- **Word:** `compose.py` gets a `table` block type. It writes a Word table with all borders, a bold header row, and the header repeated on each page.
- **PDF:** made from the Word file, so it gets the table automatically.
- **Engine templates:** the list-of-documents, list-of-dates and translated-documents sections use the same table.
- **Copy to clipboard:** tab-separated, so a table pasted into Word stays a table.

## Impact map
| Area | Risk |
|---|---|
| `intake-compose.service.ts` (normalise, segment, prompt) | Renumbering a table row; a `|` inside prose read as a table |
| `open-draft.service.ts` prompt and review | The review step may flag table rows as "unnumbered paras" |
| Citation and amount checks (`citationsToVerify`, lost-particular check) | Dates and amounts inside cells must still be checked |
| `redraft-no-ai` and local edits | Edits to one cell must keep the row intact |
| `DraftBlockText.tsx` preview | Narrow screen, so the table scrolls inside its box |
| Engine `compose.py` and `build_templates.py` | Mirror in **both** engine copies (see format-import memory) |
| Imported formats (`firm_engine_formats`) | A format with its own table must keep it |

## Edge cases
- Only one row, or rows with different cell counts: pad or merge into the header width.
- A `|` used in prose (for example "s.138 | NI Act"): it is only a table with 2+ consecutive pipe rows and the first row in heading style.
- Tamil or Hindi drafts: same table, with the headings in that language.
- A missing date or remark: the cell holds `[placeholder]`.
- A long table: rows don't break across pages, and the header repeats.

## Acceptance criteria
1. Drafting a document that has a list of documents gives a ruled table in the preview, Word and PDF, with the four standard columns.
2. A summary of admissions (Point | Admission / Position) comes out as a 2-column table.
3. No table row gets a paragraph number. Numbering of the paragraphs around it is unchanged.
4. Dates and amounts in cells still pass the citation and particulars checks.
5. Copying the draft and pasting it into Word gives a table.
6. Existing drafts with no tables render exactly as before (regression).
