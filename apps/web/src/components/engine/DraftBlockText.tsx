// =============================================================================
// DraftBlockText — render a composed draft block's text with the light Markdown the
// compose service emits (see intake-compose.service: it BOLDs operative facts with
// **double asterisks** and renders itemised particulars / multi-cheque lists as
// Markdown tables, expecting the caller to convert them to real formatting).
//
// The block model is plain-text {key, text}, so this converts at render time:
//   **bold**              -> <strong>
//   a Markdown table       -> a real <table>
// No external Markdown library — a small, safe, purpose-built parser for exactly the
// two constructs compose produces (and inline bold inside table cells).
// =============================================================================

import type { ReactNode } from 'react';

/** Split a line's text on **bold** spans -> <strong> runs. Safe: React escapes text. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyBase}-b${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A Markdown table is: a header row of `| a | b |`, a `|---|---|` separator, then rows.
 *  Detect a contiguous run of pipe-lines with a separator as its 2nd line. */
function isTableBlock(lines: string[]): boolean {
  return (
    lines.length >= 2 &&
    lines[0]!.trim().startsWith('|') &&
    /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[1]!)
  );
}

function cells(row: string): string[] {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

/** Render one block's text: paragraphs, with any embedded Markdown table as a <table>. */
export function DraftBlockText({ text, blockKey }: { text: string; blockKey: string }): ReactNode {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join(' ');
    out.push(
      <p key={`${blockKey}-p${out.length}`} className="intake__block">
        {renderInline(joined, `${blockKey}-p${out.length}`)}
      </p>,
    );
    para = [];
  };

  while (i < lines.length) {
    // A table starts here?
    const rest = lines.slice(i);
    if (rest[0]!.trim().startsWith('|') && isTableBlock(rest)) {
      flushPara();
      const header = cells(rest[0]!);
      const bodyRows: string[][] = [];
      let j = 2; // skip header + separator
      while (j < rest.length && rest[j]!.trim().startsWith('|')) {
        bodyRows.push(cells(rest[j]!));
        j += 1;
      }
      out.push(
        <table key={`${blockKey}-t${out.length}`} className="draft-table">
          <thead>
            <tr>{header.map((h, k) => <th key={k}>{renderInline(h, `${blockKey}-th${k}`)}</th>)}</tr>
          </thead>
          <tbody>
            {bodyRows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, `${blockKey}-td${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      i += j;
      continue;
    }
    if (rest[0]!.trim() === '') { flushPara(); i += 1; continue; }
    para.push(rest[0]!);
    i += 1;
  }
  flushPara();
  return <>{out}</>;
}
