import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Icon } from '@lexdraft/ui';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { ReviewPage } from '@/components/review/ReviewPage';
import {
  commit, INK_CSS, redo, startHistory, undo, withoutStroke, withStroke,
  type History, type Ink, type ReviewNote, type ReviewState, type Tool,
} from '@/lib/review-ink';
import { reviewErrorText } from '@/lib/review-copy';

GlobalWorkerOptions.workerSrc = workerUrl;

interface Review {
  id: string; title: string; source: 'draft' | 'document'; case: string; draftId: string | null;
  pageCount: number; marks: ReviewState['marks']; notes: ReviewNote[]; resultDocumentId: string | null;
  canEdit: boolean; draftChanged: boolean; createdAt: string;
}

const TOOLS = [
  ['pen', 'Pen', 'edit'], ['hl', 'Highlighter', 'draft'], ['eraser', 'Eraser', 'close'], ['note', 'Note', 'plus'],
] as const satisfies ReadonlyArray<readonly [Tool, string, string]>;
const COLORS: Ink[] = ['black', 'blue', 'red', 'yellow'];

/** review-copy: mark up a frozen copy of a draft or document with a pen and
 *  margin notes. The source is never changed. Saves itself as you go. */
export function ReviewView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const showToast = useUIStore((s) => s.showToast);
  const [review, setReview] = useState<Review | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<Ink>('red');
  const [fingerDraw, setFingerDraw] = useState(false);
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');
  const [exporting, setExporting] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  // iPhone and iPad portrait: notes slide up over the pages instead of a column.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const lastSaved = useRef<string>('');

  // Load the review and its frozen pages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<Review>(`/reviews/${id}`);
        const blob = await api.getBlob(`/reviews/${id}/pdf`);
        const pdf = await getDocument({ data: new Uint8Array(await (blob as Blob).arrayBuffer()) }).promise;
        const ps = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
        if (cancelled) return;
        const state = { marks: r.marks, notes: r.notes };
        lastSaved.current = JSON.stringify(state);
        setReview(r);
        setPages(ps);
        setHistory(startHistory(state));
      } catch (e) {
        if (!cancelled) setError(reviewErrorText((e as Error).message));
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Page width follows the reading area.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // The scroller always keeps its scrollbar space (overflowY: scroll), and tiny
    // changes are ignored: otherwise, with desktop scrollbars, a scrollbar
    // appearing narrows the pages, which removes it, which widens them... forever.
    const ro = new ResizeObserver(() => {
      const next = Math.min(el.clientWidth - 24, 920);
      setWidth((w) => (Math.abs(w - next) < 2 ? w : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length]);

  const state = history?.present;

  const save = useCallback(async (): Promise<boolean> => {
    if (!state || !review?.canEdit) return true;
    const body = JSON.stringify(state);
    if (body === lastSaved.current) return true;
    setStatus('saving');
    try {
      await api.put(`/reviews/${id}`, state);
      lastSaved.current = body;
      setStatus('saved');
      return true;
    } catch {
      setStatus('failed');
      return false;
    }
  }, [state, review?.canEdit, id]);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (!state || !review?.canEdit || JSON.stringify(state) === lastSaved.current) return;
    setStatus('unsaved');
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [state, review?.canEdit, save]);

  // Don't lose marks by closing the tab mid-save.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (status !== 'saved') e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  const numbered = useMemo(() => (state?.notes ?? []).slice()
    .sort((a, b) => a.page - b.page || a.y - b.y)
    .map((n, i) => ({ ...n, number: i + 1 })), [state?.notes]);

  const change = (next: ReviewState) => setHistory((h) => (h ? commit(h, next) : h));
  const typeNote = (nid: string, text: string) => setHistory((h) => h && ({
    ...h, present: { ...h.present, notes: h.present.notes.map((n) => (n.id === nid ? { ...n, text } : n)) },
  }));

  const exportReview = async () => {
    if (!(await save())) { showToast({ type: 'amber', text: 'Couldn’t save the marks; check the connection and try again.' }); return; }
    setExporting(true);
    try {
      const out = await api.post<{ documentId: string; notesPage: boolean }>(`/reviews/${id}/export`);
      void qc.invalidateQueries({ queryKey: ['documents'] });
      setReview((r) => (r ? { ...r, resultDocumentId: out.documentId } : r));
      showToast({
        type: out.notesPage ? 'sage' : 'amber',
        text: `Saved to ${review?.case && review.case !== '-' ? `${review.case}'s ` : ''}Documents.${out.notesPage ? '' : ' The notes list couldn’t be added this time; the marks are in.'}`,
      });
    } catch (e) {
      showToast({ type: 'amber', text: reviewErrorText((e as Error).message) });
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this review?',
      message: 'Its marks and notes are removed. The draft or document it was made from is not touched, and a copy already saved to Documents stays.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await api.delete(`/reviews/${id}`);
    lastSaved.current = JSON.stringify(state);
    setStatus('saved');
    navigate(-1);
  };

  const sendToRedraft = async (n: ReviewNote) => {
    if (!review?.draftId) return;
    await save();
    navigate('/app/draft', { state: { draftId: review.draftId, redraftNote: { text: n.text, excerpt: n.excerpt } } });
  };

  if (error) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <p role="alert">{error}</p>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  }
  if (!review || !state) return <div className="page" style={{ padding: 24 }} aria-busy="true">Opening the review copy…</div>;

  const edit = review.canEdit;
  return (
    <div className="rv" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header className="row" style={{ gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate(-1)} aria-label="Back"><Icon name="chevron" size={13} style={{ transform: 'rotate(180deg)' }} /> Back</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{review.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Review copy · {review.case !== '-' ? review.case : 'No case'} · {edit ? { saved: 'All marks saved', saving: 'Saving…', unsaved: 'Saving soon…', failed: 'Not saved, retrying' }[status] : 'View only (made by a teammate)'}
          </div>
        </div>
        {narrow && (
          <button type="button" className="btn btn-sm" onClick={() => setNotesOpen((o) => !o)} aria-expanded={notesOpen}>
            Notes ({numbered.length})
          </button>
        )}
        {edit && (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={exportReview} disabled={exporting}>
              <Icon name="documents" size={13} /> {exporting ? 'Saving…' : review.resultDocumentId ? 'Update in Documents' : 'Save to Documents'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={remove} aria-label="Delete review"><Icon name="trash" size={13} /></button>
          </>
        )}
      </header>

      {review.draftChanged && (
        <div role="status" className="row" style={{ gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--border-default)', alignItems: 'center' }}>
          <span>The draft has changed since this review copy was made, so the marks may not line up with it.</span>
          {review.draftId && (
            <button type="button" className="btn btn-sm" onClick={() => navigate('/app/draft', { state: { draftId: review.draftId } })}>
              Open the draft
            </button>
          )}
        </div>
      )}

      {edit && (
        <div role="toolbar" aria-label="Review tools" className="row" style={{ gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="dc-seg" role="radiogroup" aria-label="Tool">
            {TOOLS.map(([t, label, icon]) => (
              <button key={t} type="button" role="radio" aria-checked={tool === t} className={tool === t ? 'is-on' : ''} onClick={() => setTool(t)}>
                <Icon name={icon} size={13} /> {label}
              </button>
            ))}
          </div>
          <div className="row" role="radiogroup" aria-label="Ink colour" style={{ gap: 6 }}>
            {COLORS.map((c) => (
              <button
                key={c} type="button" role="radio" aria-checked={color === c} aria-label={c === 'yellow' ? 'Yellow' : c[0]!.toUpperCase() + c.slice(1)}
                onClick={() => { setColor(c); if (tool === 'eraser' || tool === 'note') setTool(c === 'yellow' ? 'hl' : 'pen'); }}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: INK_CSS[c], cursor: 'pointer',
                  border: color === c ? '3px solid var(--text-primary)' : '1px solid var(--border-default)',
                  outline: color === c ? '2px solid var(--bg-surface)' : 'none', outlineOffset: -5,
                }}
              />
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistory((h) => h && undo(h))} disabled={!history?.past.length}>Undo</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistory((h) => h && redo(h))} disabled={!history?.future.length}>Redo</button>
          <label className="row" style={{ gap: 6, alignItems: 'center', marginLeft: 'auto', cursor: 'pointer' }}>
            <input type="checkbox" checked={fingerDraw} onChange={(e) => setFingerDraw(e.target.checked)} />
            Draw with finger
          </label>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <div ref={scrollerRef} style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'scroll', WebkitOverflowScrolling: 'touch', padding: 12, background: 'var(--bg-surface-2)', height: '100%' }}>
          {width > 0 && pages.map((pg, i) => (
            <ReviewPage
              key={i}
              page={pg}
              index={i}
              width={width}
              strokes={state.marks.pages[i]?.strokes ?? []}
              notes={numbered.filter((n) => n.page === i)}
              tool={tool}
              color={color}
              canEdit={edit}
              fingerDraw={fingerDraw}
              scroller={scrollerRef.current}
              onStroke={(s) => change(withStroke(state, i, s))}
              onErase={(k) => change(withoutStroke(state, i, k))}
              onAddNote={({ x, y, excerpt }) => {
                const nid = crypto.randomUUID();
                change({ ...state, notes: [...state.notes, { id: nid, page: i, x, y, text: '', excerpt }] });
                setOpenNote(nid);
                setNotesOpen(true);
              }}
              onOpenNote={(nid) => { setOpenNote(nid); setNotesOpen(true); }}
            />
          ))}
        </div>

        <aside
          aria-label="Margin notes"
          hidden={narrow && !notesOpen}
          style={narrow
            ? { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '55%', overflow: 'auto', padding: 12, background: 'var(--bg-base)', borderTop: '1px solid var(--border-default)', boxShadow: '0 -8px 24px rgba(0,0,0,0.12)', zIndex: 2 }
            : { flex: '0 0 320px', borderLeft: '1px solid var(--border-default)', overflow: 'auto', padding: 12, height: '100%' }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Margin notes</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {edit ? 'Choose Note, then tap beside a line. Type, use the keyboard’s dictation, or write with Apple Pencil (Scribble).' : 'Notes from the author of this review.'}
          </p>
          {numbered.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No notes yet.</p>}
          {numbered.map((n) => (
            <div key={n.id} className="dc-card" style={{ padding: 10, marginBottom: 8, outline: openNote === n.id ? '2px solid var(--text-primary)' : 'none' }}>
              <div className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12 }}>
                <strong>{n.number}.</strong>
                <span className="muted" style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.excerpt}>
                  Page {n.page + 1}{n.excerpt ? ` · “${n.excerpt}”` : ''}
                </span>
                {edit && (
                  <button type="button" className="btn btn-sm btn-ghost" aria-label={`Delete note ${n.number}`}
                    onClick={() => change({ ...state, notes: state.notes.filter((x) => x.id !== n.id) })}>
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
              {edit ? (
                <textarea
                  className="input"
                  aria-label={`Note ${n.number}`}
                  value={n.text}
                  autoFocus={openNote === n.id && !n.text}
                  maxLength={2000}
                  rows={3}
                  placeholder="e.g. make this para stronger; check the date"
                  onChange={(e) => typeNote(n.id, e.target.value)}
                  style={{ width: '100%', marginTop: 6, resize: 'vertical' }}
                />
              ) : (
                <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{n.text}</p>
              )}
              {edit && review.source === 'draft' && review.draftId && n.text.trim().length >= 3 && (
                <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => void sendToRedraft(n)}
                  title="Opens the draft and runs Redraft on this paragraph with your note (uses credits like any Redraft; exact edits stay free)">
                  Send to Redraft
                </button>
              )}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
