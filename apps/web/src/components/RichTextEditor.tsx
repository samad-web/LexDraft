import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '@lexdraft/ui';
import { isTableRow } from './engine/DraftBlockText';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  autoFocus?: boolean;
  lang?: string;
}

interface ToolButton {
  cmd: string;
  arg?: string;
  label: string;
  icon?: IconName;
  text?: string;
  active?: () => boolean;
}

export function RichTextEditor({ value, onChange, minHeight = 520, autoFocus, lang }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync external value into the DOM only when it differs - avoids resetting the caret on every keystroke.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const exec = (cmd: string, arg?: string) => {
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
    ref.current?.focus();
  };

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const tools: ReadonlyArray<ToolButton | 'sep'> = [
    { cmd: 'bold', label: 'Bold (Ctrl+B)', text: 'B' },
    { cmd: 'italic', label: 'Italic (Ctrl+I)', text: 'I' },
    { cmd: 'underline', label: 'Underline (Ctrl+U)', text: 'U' },
    'sep',
    { cmd: 'formatBlock', arg: 'H2', label: 'Heading', text: 'H1' },
    { cmd: 'formatBlock', arg: 'H3', label: 'Subheading', text: 'H2' },
    { cmd: 'formatBlock', arg: 'P', label: 'Paragraph', text: 'P' },
    'sep',
    { cmd: 'insertUnorderedList', label: 'Bullet list', text: '•' },
    { cmd: 'insertOrderedList', label: 'Numbered list', text: '1.' },
    'sep',
    { cmd: 'justifyLeft', label: 'Align left', text: '⯇' },
    { cmd: 'justifyCenter', label: 'Center', text: '≡' },
    { cmd: 'justifyRight', label: 'Align right', text: '⯈' },
    'sep',
    { cmd: 'removeFormat', label: 'Clear formatting', text: '⌫' },
    { cmd: 'undo', label: 'Undo', text: '↶' },
    { cmd: 'redo', label: 'Redo', text: '↷' },
  ];

  const btnStyle: CSSProperties = {
    height: 28,
    minWidth: 28,
    padding: '0 8px',
    border: '1px solid var(--border-default)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const sepStyle: CSSProperties = {
    width: 1,
    height: 18,
    background: 'var(--border-default)',
    margin: '0 4px',
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div
        className="row"
        style={{
          gap: 4,
          flexWrap: 'wrap',
          padding: 8,
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          background: 'var(--bg-surface-2)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        {tools.map((t, i) => {
          if (t === 'sep') return <span key={`sep-${i}`} style={sepStyle} />;
          return (
            <button
              key={`${t.cmd}-${t.arg ?? ''}`}
              type="button"
              title={t.label}
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(t.cmd, t.arg)}
              style={btnStyle}
            >
              {t.icon ? <Icon name={t.icon} size={14} /> : (t.text as ReactNode)}
            </button>
          );
        })}
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        lang={lang}
        dir="ltr"
        onInput={handleInput}
        onBlur={handleInput}
        className="court-prose court-prose-paper"
        style={{
          minHeight,
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      />
    </div>
  );
}

export function plainTextToHtml(text: string): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  // Rows of one table may arrive a blank line apart (one paragraph per line): join them.
  const blocks: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const prev = blocks[blocks.length - 1];
    const isRows = (b: string) => b.split('\n').every(isTableRow);
    if (prev !== undefined && isRows(block) && isRows(prev)) blocks[blocks.length - 1] = `${prev}\n${block}`;
    else blocks.push(block);
  }
  return blocks
    .map((block) => {
      // An evidence table (2+ "| a | b |" rows) shows as a table, heading row first.
      const rows = block.split('\n');
      if (rows.length > 1 && rows.every(isTableRow)) {
        const tr = (row: string, tag: 'th' | 'td') =>
          `<tr>${row.trim().slice(1, -1).split('|').map((c) => `<${tag}>${escape(c.trim())}</${tag}>`).join('')}</tr>`;
        return `<table class="draft-table">${rows.map((r, i) => tr(r, i === 0 ? 'th' : 'td')).join('')}</table>`;
      }
      const safe = escape(block).replace(/\n/g, '<br/>');
      return `<p>${safe || '<br/>'}</p>`;
    })
    .join('');
}

/** Editor HTML -> plain text, the inverse of plainTextToHtml: one block per <p>/<div>
 *  (blank line between), <br> a line break, and a table one "| a | b |" line per row
 *  (the evidence-table text form the engine lays out as a Word table). */
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const parts: string[] = [];
  doc.body.childNodes.forEach((node) => {
    if (node.nodeName === 'TABLE') {
      const rows = [...(node as HTMLTableElement).querySelectorAll('tr')]
        .map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()))
        .filter((cells) => cells.some(Boolean))
        .map((cells) => `| ${cells.join(' | ')} |`);
      if (rows.length) parts.push(rows.join('\n'));
      return;
    }
    const text = (node.textContent ?? '').replace(/[ \t]+\n/g, '\n').trim();
    if (text) parts.push(text);
  });
  return parts.join('\n\n');
}
