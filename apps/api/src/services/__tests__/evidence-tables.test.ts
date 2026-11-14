import { describe, expect, it } from 'vitest';
import { isTableRow, normaliseComposedMarkdown, numberBody } from '../intake-compose.service';
import { cleanLines } from '../open-draft.service';

// evidence-tables (build-docs/features/evidence-tables.md): a list of documents or a
// summary of admissions stays as "| a | b |" rows the engine lays out as a Word table.
const MD = [
  '| Sr. No | Date | Description of document | Remarks |',
  '|---|---|---|---|',
  '|01.|13-02-2026| Copy of CSR No.262/2026 |Xerox|',
].join('\n');

describe('evidence tables', () => {
  it('composed Markdown table keeps its rows as pipe rows, rule dropped', () => {
    expect(normaliseComposedMarkdown(MD).split('\n')).toEqual([
      '| Sr. No | Date | Description of document | Remarks |',
      '| 01. | 13-02-2026 | Copy of CSR No.262/2026 | Xerox |',
    ]);
  });

  it('a table paragraph is never numbered; paragraphs around it number on', () => {
    const table = normaliseComposedMarkdown(MD);
    expect(numberBody(['The petitioner relies on the documents below.', table, 'Hence this petition.'], 4))
      .toEqual(['4. The petitioner relies on the documents below.', table, '5. Hence this petition.']);
  });

  it('prose with a pipe is not a row; a rule is not a row', () => {
    expect(isTableRow('Cheque | dishonoured')).toBe(false);
    expect(isTableRow('| Point | Admission / Position |')).toBe(true);
  });

  it('open drafting keeps table rows and drops the rule line', () => {
    expect(cleanLines('LIST OF DOCUMENTS\n| Point | Admission |\n| --- | --- |\n| Salary proof | Not filed |'))
      .toEqual(['LIST OF DOCUMENTS', '| Point | Admission |', '| Salary proof | Not filed |']);
  });

  it('no-table text is unchanged', () => {
    expect(normaliseComposedMarkdown('1. The **facts** are these.')).toBe('1. The facts are these.');
  });
});
