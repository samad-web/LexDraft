// =============================================================================
// DocumentAskPanel — "Ask this document" in the composer rail.
//
// The advocate uploads an FIR, an order or the other side's pleading (PDF,
// photo/scan or .docx) and asks questions about it. Answers come only from that
// document and show the passages they rely on, with page and paragraph.
//
// Session-only: POST /drafting/document/read turns the file into page texts
// (read locally on the server, nothing stored) and this component keeps them in
// memory; each question sends them back to POST /drafting/document/ask. Closing
// the document, leaving the page or reloading forgets it.
// =============================================================================

import { useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { api } from '@/lib/api';
import '@/styles/chambers/draft-tools.css';

interface DocPage { page: number | null; text: string }

interface ReadDoc {
  fileName: string;
  kind: 'pdf' | 'image' | 'docx' | 'text';
  ocr: boolean;
  pages: DocPage[];
  chars: number;
  truncated: boolean;
}

interface AskQuote { page: number | null; paragraph: number; text: string }
interface AskResult { found: boolean; answer: string; quotes: AskQuote[] }

interface Turn {
  question: string;
  result?: AskResult;
  error?: string;
}

const MAX_BYTES = 8 * 1024 * 1024; // the API's per-file cap
const ACCEPT = 'application/pdf,.pdf,image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const STARTERS = ['Summarise this document', 'What are the key dates?', 'Which sections are invoked?'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

const cite = (q: AskQuote) => (q.page === null ? `Para ${q.paragraph}` : `Page ${q.page} · para ${q.paragraph}`);

export function DocumentAskPanel() {
  const [doc, setDoc] = useState<ReadDoc | null>(null);
  const [reading, setReading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('That file is over 8 MB. Upload a smaller copy or just the pages you need.');
      return;
    }
    setReading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const read = await api.post<ReadDoc>('/drafting/document/read', {
        file: { fileName: file.name, mime: file.type || 'application/octet-stream', dataBase64 },
      });
      setDoc(read);
      setTurns([]);
    } catch (err) {
      setError((err as Error).message || 'Could not read the document');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!doc || q.length < 2 || asking) return;
    setAsking(true);
    setQuestion('');
    const history = turns
      .filter((t) => t.result)
      .slice(-4)
      .map((t) => ({ question: t.question, answer: t.result!.answer }));
    setTurns((ts) => [...ts, { question: q }]);
    try {
      const result = await api.post<AskResult>('/drafting/document/ask', {
        fileName: doc.fileName, pages: doc.pages, question: q, ...(history.length ? { history } : {}),
      });
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, result } : t)));
    } catch (err) {
      const msg = (err as Error).message || 'Could not answer';
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: msg } : t)));
    } finally {
      setAsking(false);
    }
  };

  const close = () => {
    setDoc(null);
    setTurns([]);
    setQuestion('');
    setError(null);
  };

  const pageCount = doc ? doc.pages.filter((p) => p.page !== null).length : 0;

  return (
    <section className="dc-card">
      <div className="dc-eyebrow">Ask this document</div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {!doc && (
        <>
          <button className="btn dw-wide" type="button" disabled={reading} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} /> {reading ? 'Reading the document…' : 'Upload FIR, order or pleading'}
          </button>
          <p className="dc-card-text">
            PDF, photo or scan, or Word. Answers come only from that document, with the page and paragraph. It is not saved: it is forgotten when you close it or leave.
          </p>
        </>
      )}

      {error && <p className="dc-card-text">{error}</p>}

      {doc && (
        <>
          <div className="dt-file">
            <Icon name="file" size={14} aria-hidden />
            <span className="dt-file-name" title={doc.fileName}>{doc.fileName}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label="Close document">
              <Icon name="close" size={13} />
            </button>
          </div>
          <p className="dw-note">
            {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? '' : 's'} read` : 'Read'}
            {doc.ocr ? ' from a scan, so some words may be misread' : ''}
            {doc.truncated ? '. Very long: only the first part was read' : ''}.
          </p>

          {turns.length > 0 && (
            <div className="dt-qa" aria-live="polite">
              {turns.map((t, i) => (
                <div key={i} className="dt-turn">
                  <p className="dt-q">{t.question}</p>
                  {!t.result && !t.error && <p className="dt-a">Reading…</p>}
                  {t.error && <p className="dt-a">{t.error}</p>}
                  {t.result && (
                    <>
                      <p className={`dt-a${t.result.found ? '' : ' is-missing'}`}>{t.result.answer}</p>
                      {t.result.quotes.map((q, k) => (
                        <blockquote key={k} className="dt-quote">
                          “{q.text}”
                          <span className="dt-cite">{cite(q)}</span>
                        </blockquote>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {turns.length === 0 && (
            <div className="dw-btn-row dw-quick">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="chip dw-quick-chip" disabled={asking} onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="dt-ask-row">
            <textarea
              className="input"
              rows={2}
              value={question}
              placeholder="Ask about this document, e.g. when was the accused arrested?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question); }
              }}
              disabled={asking}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={asking || question.trim().length < 2}
              onClick={() => void ask(question)}
              aria-label="Ask"
            >
              <Icon name="arrow" size={14} />
            </button>
          </div>
          <p className="dc-card-text">If the answer is not in the document, it says so. Check the quoted passage before relying on it.</p>
        </>
      )}
    </section>
  );
}
