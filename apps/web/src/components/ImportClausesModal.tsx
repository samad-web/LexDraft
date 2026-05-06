import { useState, type ChangeEvent } from 'react';
import Papa from 'papaparse';
import mammoth from 'mammoth';
import type { CreateClauseRequest } from '@lexdraft/types';
import { useImportClauses } from '@/hooks/useClauses';
import { useUIStore } from '@/store/ui';

interface ImportClausesModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'json' | 'csv' | 'docx';

const JSON_SAMPLE = `[
  {
    "category": "Confidentiality",
    "title": "Standard NDA Clause",
    "description": "Mutual confidentiality with 3-year survival post-termination.",
    "body": "Each Party agrees to hold in strict confidence all Confidential Information…"
  }
]`;

const CSV_SAMPLE = `category,title,description,body
Confidentiality,Standard NDA Clause,Mutual confidentiality with 3-year survival.,Each Party agrees to hold in strict confidence…`;

export function ImportClausesModal({ open, onClose }: ImportClausesModalProps) {
  const [tab, setTab] = useState<Tab>('json');
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<CreateClauseRequest[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [docxCategory, setDocxCategory] = useState('Imported');
  const importMutation = useImportClauses();
  const showToast = useUIStore((s) => s.showToast);

  if (!open) return null;

  const reset = () => {
    setText(''); setParsed([]); setParseError(null);
  };

  const handleTabChange = (t: Tab) => { setTab(t); reset(); };

  // ---- Parsers -------------------------------------------------------------

  const parseJson = (raw: string) => {
    setParseError(null);
    if (!raw.trim()) { setParsed([]); return; }
    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : [data];
      const items: CreateClauseRequest[] = arr.map((it: unknown, i: number) => {
        if (!it || typeof it !== 'object') throw new Error(`Row ${i + 1}: not an object`);
        const r = it as Record<string, unknown>;
        if (typeof r.category !== 'string' || !r.category.trim()) throw new Error(`Row ${i + 1}: missing category`);
        if (typeof r.title    !== 'string' || !r.title.trim())    throw new Error(`Row ${i + 1}: missing title`);
        return {
          category: r.category.trim(),
          title: r.title.trim(),
          description: typeof r.description === 'string' ? r.description : '',
          body: typeof r.body === 'string' ? r.body : '',
        };
      });
      setParsed(items);
    } catch (err) {
      setParsed([]);
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const parseCsv = (raw: string) => {
    setParseError(null);
    if (!raw.trim()) { setParsed([]); return; }
    const result = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
    if (result.errors.length > 0) {
      setParsed([]);
      setParseError(result.errors[0]!.message);
      return;
    }
    const items: CreateClauseRequest[] = [];
    for (const [i, row] of result.data.entries()) {
      const category    = (row.category    ?? '').trim();
      const title       = (row.title       ?? '').trim();
      const description = (row.description ?? '').trim();
      const body        = (row.body        ?? '').trim();
      if (!category || !title) {
        setParsed([]);
        setParseError(`Row ${i + 2}: category and title are required`);
        return;
      }
      items.push({ category, title, description, body });
    }
    setParsed(items);
  };

  /** Convert DOCX → array of clauses, splitting on H1/H2 headings.
   *  Each heading becomes a clause title; paragraphs until the next heading
   *  become the body. Description is left blank. The user picks one
   *  category for the entire file. */
  const parseDocxFile = async (file: File) => {
    setParseError(null);
    try {
      const buffer = await file.arrayBuffer();
      const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer });
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const root = doc.body.firstElementChild;
      if (!root) { setParsed([]); return; }

      const items: CreateClauseRequest[] = [];
      let current: { title: string; bodyParts: string[] } | null = null;
      const flush = () => {
        if (current && current.title.trim()) {
          items.push({
            category: docxCategory.trim() || 'Imported',
            title: current.title.trim(),
            description: '',
            body: current.bodyParts.join('\n\n').trim(),
          });
        }
        current = null;
      };
      Array.from(root.children).forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'h1' || tag === 'h2') {
          flush();
          current = { title: el.textContent ?? '', bodyParts: [] };
        } else if (current) {
          current.bodyParts.push(el.textContent ?? '');
        }
      });
      flush();

      // If no headings found, treat the whole document as one clause
      // titled after the file name.
      if (items.length === 0) {
        const fallbackTitle = file.name.replace(/\.docx$/i, '').replace(/[-_]+/g, ' ');
        items.push({
          category: docxCategory.trim() || 'Imported',
          title: fallbackTitle,
          description: '',
          body: (root.textContent ?? '').trim(),
        });
      }
      setParsed(items);
      setText(`Parsed ${items.length} clause${items.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      setParsed([]);
      setParseError(err instanceof Error ? err.message : 'Could not read DOCX file');
    }
  };

  // ---- File upload --------------------------------------------------------

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (tab === 'docx') {
      await parseDocxFile(f);
      return;
    }
    const raw = await f.text();
    setText(raw);
    if (tab === 'json') parseJson(raw);
    else parseCsv(raw);
  };

  const handleTextChange = (raw: string) => {
    setText(raw);
    if (tab === 'json') parseJson(raw);
    else if (tab === 'csv') parseCsv(raw);
  };

  // ---- Submit -------------------------------------------------------------

  const handleImport = async () => {
    if (parsed.length === 0) {
      showToast({ type: 'vermillion', text: 'Nothing to import — paste or upload a file first' });
      return;
    }
    try {
      const result = await importMutation.mutateAsync(parsed);
      showToast({
        type: result.inserted > 0 ? 'sage' : 'cobalt',
        text: `Imported ${result.inserted}, skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}`,
      });
      reset();
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message ?? 'Import failed';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  // ---- Render -------------------------------------------------------------

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-clauses-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: 'min(720px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Import clauses</div>
          <h3 id="import-clauses-title" className="display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Bulk add to clause bank
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Duplicates (same category + title, case-insensitive) are skipped.
          </p>
        </div>

        {/* tabs */}
        <div className="pill-nav" style={{ alignSelf: 'flex-start' }}>
          {(['json', 'csv', 'docx'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'active' : ''}
              onClick={() => handleTabChange(t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {tab === 'docx' ? (
          <>
            <p className="body-sm muted">
              Each H1/H2 heading becomes a clause; the paragraphs until the next heading become the body.
              If your document has no headings, it will be imported as a single clause.
            </p>
            <Field label="CATEGORY (applied to all imported clauses)">
              <input
                className="input"
                value={docxCategory}
                onChange={(e) => setDocxCategory(e.target.value)}
              />
            </Field>
            <Field label="DOCX FILE">
              <input type="file" accept=".docx" onChange={handleFile} className="input" style={{ padding: '8px 12px' }} />
            </Field>
            {text && <div className="body-sm muted">{text}</div>}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="file"
                accept={tab === 'json' ? '.json,application/json' : '.csv,text/csv'}
                onChange={handleFile}
                className="input"
                style={{ padding: '8px 12px', maxWidth: 300 }}
              />
              <span className="muted body-sm">or paste below</span>
            </div>
            <Field label={tab === 'json' ? 'JSON' : 'CSV'}>
              <textarea
                className="input mono"
                rows={tab === 'json' ? 12 : 8}
                value={text}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder={tab === 'json' ? JSON_SAMPLE : CSV_SAMPLE}
                style={{ fontSize: 12 }}
              />
            </Field>
          </>
        )}

        {parseError && (
          <div className="body-sm" style={{ color: 'var(--danger)' }}>
            ⚠ {parseError}
          </div>
        )}

        {parsed.length > 0 && (
          <div className="card" style={{ padding: 12, background: 'var(--bg-surface-2)' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Preview · {parsed.length} clause{parsed.length === 1 ? '' : 's'}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflow: 'auto' }}>
              {parsed.slice(0, 20).map((c, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  <span className="mono muted" style={{ fontSize: 11 }}>{c.category}</span> · {c.title}
                </li>
              ))}
              {parsed.length > 20 && (
                <li className="muted body-sm">…and {parsed.length - 20} more</li>
              )}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleImport}
            disabled={parsed.length === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? 'Importing…' : `Import ${parsed.length || ''} clauses`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}
