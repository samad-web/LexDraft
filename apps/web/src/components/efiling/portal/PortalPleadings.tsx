import { useEffect, useMemo, useRef, useState } from 'react';
import { PortalModal } from '../PortalKit';
import {
  fileToBase64, useAddPleadingFile, useAddPleadingIndex, useDeletePleading, useDeletePleadingIndex, useDraftPleadings,
  useMergePleadings, useOathCase, useOathDocument, useOathScreen, usePlayOath, usePleadingAuth, usePleadingCase,
  usePleadingEsign, usePleadingIndex, usePleadingScreen, useResubmitPleading, useSavePleadingAuth, useSendPleadingOtp,
  useStartPleadingEsign, useStepPleadingEsign, useSubmitDraftPleading, useSubmitPleadingFiles, useVerifyPleadingOtp,
  useViewPleadingFile, useUploadOath, useSearchPleadingCases, useTemplateScreen, useTemplateCase, useGenerateTemplate,
  type AddedFile, type AuthChoice, type CaseRef, type GatewayView, type PleadingRow, type PleadingTable, type PortalCall, type PortalOption,
} from '@/hooks/efiling/pleadings';

// =============================================================================
// Pleadings > Pleading Upload (with its Pleading Index and eSign tabs) and
// Pleadings > Video Recording, live on the advocate's portal account. Every
// label, tab, list column and row button comes from the portal page itself
// (read by the API); DifAi only falls back to the portal function's meaning
// where the portal shows a bare icon. Monochrome, as the rest of eFiling.
// =============================================================================

// What a portal row button does, by the portal function it calls - used only
// when the portal shows a bare icon with no text or title.
const FN_LABEL: Record<string, string> = {
  showFile: 'View', removeFile: 'Delete', openPdf: 'View', addIndex: 'Add Index', deleteIndex: 'Delete',
  addAuth: 'Authorise', showFrame: 'eSign', showEsignFrame1: 'OTP', setVideo: 'Play',
  submit_pleading: 'Submit', resubmit_pleading: 'Re-Submit',
};
const callLabel = (c: PortalCall) => c.label || FN_LABEL[c.fn] || c.fn;
const errText = (e: unknown, fallback: string) => (e as Error)?.message || fallback;

const isRow = (r: PleadingTable['rows'][number]): r is PleadingRow => 'cells' in r;

const inverseBtn: React.CSSProperties = {
  background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 4,
  padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};

/** What the portal said after a step (its alert boxes / messages). */
function Said({ lines, error }: { lines?: string[]; error?: unknown }) {
  const all = [...(lines ?? []).filter(Boolean), ...(error ? [errText(error, 'The portal did not answer. Try again.')] : [])];
  if (!all.length) return null;
  return (
    <div role="status" style={{ border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', padding: '8px 12px', borderRadius: 4 }}>
      {all.map((l, i) => <p key={i} className="body-sm" style={{ margin: 0 }}>{l}</p>)}
    </div>
  );
}

/**
 * A portal list as it shows there: dark header, group rows (DataTables
 * rowGroup), each cell's lines, and the row's own buttons (the portal
 * functions it calls) in its last column.
 */
function PleadingList({ table, empty, onCall, busy, check }: {
  table: PleadingTable | undefined; empty: string; busy?: boolean;
  onCall?: (row: PleadingRow, call: PortalCall) => void;
  check?: { picked: Set<string>; toggle: (id: string) => void };
}) {
  if (!table || !table.rows.some(isRow)) return <p className="body-sm muted">{empty}</p>;
  const cols = Math.max(table.headers.length, ...table.rows.map((r) => (isRow(r) ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {table.headers.length ? (
          <thead><tr>{table.headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700 }}>{h}</th>)}</tr></thead>
        ) : null}
        <tbody>
          {table.rows.map((r, i) => (isRow(r) ? (
            <tr key={i} style={{ background: i % 2 ? undefined : 'var(--bg-surface-2)' }}>
              {Array.from({ length: cols }, (_, j) => {
                const last = j === cols - 1;
                const box = j === 1 && check ? r.checks?.find((c) => c.id.startsWith('chk_')) : undefined;
                return (
                  <td key={j} style={td}>
                    {box ? (
                      <label className="row" style={{ gap: 6, justifyContent: 'center' }}>
                        <input type="checkbox" checked={check!.picked.has(box.id)} onChange={() => check!.toggle(box.id)} aria-label={`Select ${r.cells[j] ?? box.name}`} />
                        <span>{r.cells[j]}</span>
                      </label>
                    ) : r.cells[j]}
                    {last && onCall && r.calls?.length ? (
                      <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: r.cells[j] ? 6 : 0 }}>
                        {r.calls.filter((c) => FN_LABEL[c.fn]).map((c, k) => (
                          <button key={k} type="button" disabled={busy} style={inverseBtn} onClick={() => onCall(r, c)}>{callLabel(c)}</button>
                        ))}
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ) : (
            <tr key={i}><td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/** "Are you sure?" as the portal's confirm() asks it. */
function Confirm({ title, text, yes, onYes, onNo, busy }: { title: string; text: string; yes: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  return (
    <PortalModal title={title} onClose={onNo} level={3}>
      <p className="body-sm">{text}</p>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNo}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onYes} disabled={busy}>{busy ? 'Working on the portal…' : yes}</button>
      </div>
    </PortalModal>
  );
}

function FileModal({ title, file, error, pending, onClose, kind = 'pdf' }: {
  title: string; file?: { url: string } | undefined; error?: unknown; pending: boolean; onClose: () => void; kind?: 'pdf' | 'video';
}) {
  return (
    <PortalModal title={title} onClose={onClose} level={2}>
      {pending ? <p className="body-sm">Opening on the portal…</p> : null}
      <Said error={error} />
      {file ? (kind === 'video'
        ? <video src={file.url} controls style={{ width: '100%', maxHeight: '70vh', background: 'var(--bg-inverse)' }} />
        : <iframe title={title} src={file.url} style={{ width: '100%', height: '75vh', border: '1px solid var(--border-default)' }} />) : null}
    </PortalModal>
  );
}

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 220px' };
const lbl: React.CSSProperties = { fontWeight: 700, fontSize: 14 };

/**
 * The case box: the e-filing numbers as listed; for an existing case the
 * portal's search box (type 3+ letters, it lists the advocate's matching cases).
 */
function CaseChooser({ label, existing, options, value, onChange, onSearch, searching, searchError }: {
  label: string; existing: boolean; options: PortalOption[]; value: string; onChange: (v: string) => void;
  onSearch: (term: string) => void; searching: boolean; searchError: unknown;
}) {
  const [term, setTerm] = useState('');
  return (
    <div className="col" style={{ gap: 8, maxWidth: 520 }}>
      {existing ? (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label style={field}><span style={lbl}>{label}</span>
            <input className="input" placeholder="Enter Text" value={term} onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && term.trim().length >= 3) onSearch(term.trim()); }} /></label>
          <button type="button" className="btn btn-ghost btn-sm" disabled={term.trim().length < 3 || searching} onClick={() => onSearch(term.trim())}>{searching ? 'Searching…' : 'Search'}</button>
        </div>
      ) : null}
      <label style={field}>
        {existing ? null : <span style={lbl}>{label}</span>}
        <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
        </select>
      </label>
      <Said error={searchError} />
    </div>
  );
}

// ---- Pleadings > Use Template ---------------------------------------------------

function UseTemplate({ sessionId }: { sessionId: string }) {
  const screen = useTemplateScreen(sessionId);
  const s = screen.data;
  const [source, setSource] = useState('');
  const [value, setValue] = useState('');
  const [type, setType] = useState('');
  const [parties, setParties] = useState<Set<string>>(new Set());
  useEffect(() => { if (s && !source) setSource(s.sources.find((x) => x.checked)?.value ?? s.sources.find((x) => x.value === '3')?.value ?? s.sources[0]?.value ?? '3'); }, [s, source]);
  const c: CaseRef | null = value ? { source, value } : null;
  const caseQ = useTemplateCase(sessionId, c);
  const search = useSearchPleadingCases(sessionId);
  const gen = useGenerateTemplate(sessionId);
  const resetGen = gen.reset;
  useEffect(() => { setType(''); setParties(new Set()); resetGen(); }, [caseQ.data, resetGen]);
  const label = (id: string, fallback: string) => s?.labels[id] || fallback;
  if (screen.isLoading) return <p className="body-sm">Opening Pleadings &gt; Use Template on your portal…</p>;
  if (screen.isError || !s) return <Said error={screen.error ?? new Error("Couldn't open Use Template on the portal.")} />;
  const v = caseQ.data;
  // Only one side's clients at a time, as on the portal.
  const sideOn = v?.parties.find((p) => parties.has(p.value))?.side ?? null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{s.title || 'Use Template'}</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={screen.isFetching || caseQ.isFetching}
          onClick={() => { void screen.refetch(); if (c) void caseQ.refetch(); }}>{screen.isFetching || caseQ.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
      </div>
      <div className="row" role="radiogroup" aria-label="Case" style={{ gap: 18, flexWrap: 'wrap' }}>
        {s.sources.map((r) => (
          <label key={r.value} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
            <input type="radio" name="tpl-cases" checked={source === r.value} onChange={() => { setSource(r.value); setValue(''); }} />{r.label}
          </label>
        ))}
      </div>
      {source === '1' || source === '3' ? (
        <CaseChooser label={source === '1' ? label('txt_case_search', 'Case') : label('sel_pde_no', 'e-Filing Number')}
          existing={source === '1'} options={source === '1' ? search.data?.items ?? [] : s.efiled} value={value} onChange={setValue}
          onSearch={(term) => search.mutate({ term })} searching={search.isPending} searchError={search.error} />
      ) : <p className="body-sm">A registered case by its case number is chosen on the portal for now; DifAi covers the e-filed and existing-case choices.</p>}
      <Said error={caseQ.error} />
      {caseQ.isFetching && !v ? <p className="body-sm">Reading the case on the portal…</p> : null}
      {v ? (
        <>
          {v.parties.length ? (
            <fieldset style={{ border: '1px solid var(--border-default)', padding: '8px 12px' }}>
              <legend style={lbl}>{v.clientsLabel || 'My Clients'}</legend>
              <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                {v.parties.map((p) => (
                  <label key={p.value} className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" disabled={!!sideOn && sideOn !== p.side} checked={parties.has(p.value)}
                      onChange={() => setParties((x) => { const n = new Set(x); if (n.has(p.value)) n.delete(p.value); else n.add(p.value); return n; })} />
                    {p.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label style={{ ...field, maxWidth: 520 }}><span style={lbl}>{label('type_pleading', 'Type of Pleading')} *</span>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value); gen.reset(); }}>
              <option value="">Select</option>
              {v.pleadingTypes.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
            </select></label>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!type || gen.isPending}
              onClick={() => gen.mutate({ ...c!, typePleading: type, parties: [...parties] })}>{gen.isPending ? 'Generating on the portal…' : label('submit', 'Generate')}</button>
            {gen.data ? <a className="btn btn-ghost btn-sm" href={gen.data.url} download={`${v.pleadingTypes.find((o) => o.value === type)?.text || 'template'}.doc`}>{label('rptname', 'Download')}</a> : null}
          </div>
          <Said error={gen.error} />
        </>
      ) : null}
    </div>
  );
}

// ---- Pleadings > Pleading Upload ------------------------------------------------

type Tab = 'upload' | 'index' | 'esign';
const tabOf = (id: string, i: number): Tab => (id === 'pleading_index_tab' ? 'index' : id === 'pleading_esign_tab' ? 'esign' : i === 0 ? 'upload' : 'upload');

function PleadingUpload({ sessionId }: { sessionId: string }) {
  const screen = usePleadingScreen(sessionId);
  const s = screen.data;
  const [source, setSource] = useState<string>('');
  const [value, setValue] = useState('');
  const [tab, setTab] = useState<Tab>('upload');
  useEffect(() => {
    if (!s || source) return;
    setSource(s.selected?.source ?? s.sources.find((x) => x.checked)?.value ?? s.sources.find((x) => x.value === '3')?.value ?? s.sources[0]?.value ?? '3');
    if (s.selected) setValue(s.selected.value);
  }, [s, source]);
  const c: CaseRef | null = value ? { source, value } : null;
  const caseQ = usePleadingCase(sessionId, c);
  const search = useSearchPleadingCases(sessionId);
  const options = source === '1' ? search.data?.items ?? s?.existing ?? [] : s?.efiled ?? [];
  const label = (id: string, fallback: string) => s?.labels[id] || fallback;

  if (screen.isLoading) return <p className="body-sm">Opening Pleadings &gt; Pleading Upload on your portal…</p>;
  if (screen.isError || !s) return <Said error={screen.error ?? new Error("Couldn't open Pleading Upload on the portal.")} />;
  const tabs = s.tabs.length ? s.tabs.map((t, i) => ({ key: tabOf(t.id, i), label: t.label })) : [{ key: 'upload' as Tab, label: s.title || 'Pleading Upload' }];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{s.title || 'Pleading Upload'}</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={screen.isFetching || caseQ.isFetching}
          onClick={() => { void screen.refetch(); if (c) void caseQ.refetch(); }}>{screen.isFetching || caseQ.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
      </div>
      <div className="row" role="radiogroup" aria-label="Case" style={{ gap: 18, flexWrap: 'wrap' }}>
        {s.sources.map((r) => (
          <label key={r.value} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
            <input type="radio" name="pl-cases" value={r.value} checked={source === r.value} onChange={() => { setSource(r.value); setValue(''); }} />
            {r.label}
          </label>
        ))}
      </div>
      <CaseChooser label={source === '1' ? label('txt_case_search', 'Case') : label('sel_pde_no', 'e-Filing Number')}
        existing={source === '1'} options={options} value={value} onChange={setValue}
        onSearch={(term) => search.mutate({ term })} searching={search.isPending} searchError={search.error} />
      {caseQ.isError ? <Said error={caseQ.error} /> : null}
      {c ? (
        <>
          <div role="tablist" className="row" style={{ gap: 0, borderBottom: '2px solid var(--text-primary)', flexWrap: 'wrap' }}>
            {tabs.map((t) => (
              <button key={t.key + t.label} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                style={{ padding: '10px 18px', border: 'none', cursor: 'pointer', fontWeight: 700, background: tab === t.key ? 'var(--bg-inverse)' : 'transparent', color: tab === t.key ? 'var(--text-inverse)' : 'inherit' }}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'upload' ? <UploadTab sessionId={sessionId} c={c} labels={s.labels} docTypes={s.docTypes} /> : null}
          {tab === 'index' ? <IndexTab sessionId={sessionId} c={c} labels={s.labels} /> : null}
          {tab === 'esign' ? <EsignTab sessionId={sessionId} c={c} /> : null}
        </>
      ) : <p className="body-sm muted">Select the case to upload pleadings against.</p>}
    </div>
  );
}

/** The portal's own title notes (upload_pleading.js, on blur of the title). */
function titleNotes(v: string): string | null {
  if (!v) return null;
  if (/^_+$/.test(v)) return 'Please Enter Valid File Name.';
  if (/^_|_$/.test(v)) return 'Underscore cannot be at start or end.';
  if (!/^[a-z0-9_]+$/i.test(v)) return 'Only letters, numbers and underscore allowed.';
  if ((v.match(/_/g) ?? []).length > 5) return 'Maximum 5 underscores allowed.';
  return null;
}

function UploadTab({ sessionId, c, labels, docTypes }: { sessionId: string; c: CaseRef; labels: Record<string, string>; docTypes: Array<{ value: string; text: string }> | null }) {
  const caseQ = usePleadingCase(sessionId, c);
  const add = useAddPleadingFile(sessionId);
  const submit = useSubmitPleadingFiles(sessionId);
  const del = useDeletePleading(sessionId);
  const merge = useMergePleadings(sessionId);
  const view = useViewPleadingFile(sessionId);
  const [docType, setDocType] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<AddedFile[] | null>(null);
  const [parties, setParties] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | { kind: 'submit' } | { kind: 'delete'; no: string } | { kind: 'merge' }>(null);
  const [mergeTitle, setMergeTitle] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const data = submit.data?.view ?? del.data?.view ?? merge.data?.view ?? caseQ.data;
  // Newest result wins: whichever finished last carries the list.
  const [latest, setLatest] = useState<typeof data>(undefined);
  useEffect(() => { setLatest(caseQ.data); setAdded(null); setParties(new Set()); setPicked(new Set()); }, [caseQ.data]);
  const view_ = latest ?? data;
  const addedNow = added ?? view_?.added ?? [];
  const lockedTitle = docType === '1';
  const notes = titleNotes(title);
  const busy = add.isPending || submit.isPending || del.isPending || merge.isPending;

  const doAdd = async () => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    add.mutate({ ...c, title, docType: docType || null, file: { name: file.name, base64 } }, {
      onSuccess: (r) => { setAdded(r.added); if (r.ok) { setTitle(''); setFile(null); setDocType(''); if (fileRef.current) fileRef.current.value = ''; } },
    });
  };
  const onCall = (_row: PleadingRow, call: PortalCall) => {
    const no = call.args[0] ?? '';
    if (call.fn === 'showFile') { setViewing(no); view.mutate({ ...c, pleadingNumber: no }); }
    if (call.fn === 'removeFile') setConfirm({ kind: 'delete', no });
  };
  const closeView = () => { if (view.data) URL.revokeObjectURL(view.data.url); setViewing(null); view.reset(); };
  const picks = [...picked].map((id) => id.replace(/^chk_/, ''));

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {docTypes ? (
          <label style={field}>
            <span style={lbl}>{labels['selDocType'] || 'Document Type'}</span>
            <select className="input" value={docType} onChange={(e) => {
              const v = e.target.value;
              setDocType(v);
              // As the portal: the type's name becomes the title (fixed for value 1).
              setTitle(v ? docTypes.find((o) => o.value === v)?.text ?? '' : '');
            }}>
              <option value="">Select</option>
              {docTypes.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
            </select>
          </label>
        ) : null}
        <label style={field}>
          <span style={lbl}>{labels['file_name'] || 'Document Title'} *</span>
          <input className="input" value={title} readOnly={lockedTitle} onChange={(e) => setTitle(e.target.value)} />
          {notes ? <span className="body-sm" style={{ fontWeight: 700 }}>{notes}</span> : null}
        </label>
        <label style={field}>
          <span style={lbl}>{labels['doc_file_name'] || 'Choose file'} *</span>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={!file || !title || busy} onClick={() => void doAdd()}>
          {add.isPending ? 'Adding on the portal…' : labels['add_btn'] || 'Add'}
        </button>
      </div>
      <Said lines={add.data?.portal} error={add.error} />
      {addedNow.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border-default)' }}>
          {addedNow.map((f, i) => (
            <li key={i} className="row" style={{ gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 200px' }}>{f.title}</span>
              <span style={{ flex: '1 1 200px', fontWeight: 600 }}>{f.file}{f.signed ? <span style={{ ...inverseBtn, marginLeft: 8, cursor: 'default' }}>Digitally Signed</span> : null}</span>
              <span className="body-sm muted">{f.size}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {view_?.parties.length ? (
        <fieldset style={{ border: '1px solid var(--border-default)', padding: '8px 12px' }}>
          <legend style={lbl}>{view_.clientsLabel || 'My Clients'}</legend>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            {view_.parties.map((p) => (
              <label key={p.value} className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={parties.has(p.value)} onChange={() => setParties((s) => { const n = new Set(s); if (n.has(p.value)) n.delete(p.value); else n.add(p.value); return n; })} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!addedNow.length || busy || !!title} onClick={() => setConfirm({ kind: 'submit' })}>
          {submit.isPending ? 'Submitting on the portal…' : labels['submit'] || 'Submit'}
        </button>
        {title && addedNow.length ? <span className="body-sm">Press {labels['add_btn'] || 'Add'} for the title you typed first.</span> : null}
      </div>
      <Said lines={submit.data?.portal ?? del.data?.portal ?? merge.data?.portal} error={submit.error ?? del.error ?? merge.error} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>{caseQ.isFetching ? 'Reading the portal…' : ''}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={picked.size < 2 || busy} onClick={() => { setMergeTitle(''); setConfirm({ kind: 'merge' }); }}>Merge</button>
      </div>
      <PleadingList table={view_?.table} empty="No pleading uploaded for this case yet." onCall={onCall} busy={busy}
        check={{ picked, toggle: (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }) }} />

      {confirm?.kind === 'submit' ? (
        <Confirm title={labels['submit'] || 'Submit'} yes={labels['submit'] || 'Submit'} busy={submit.isPending}
          text={`Submit ${addedNow.length} added file${addedNow.length === 1 ? '' : 's'} as this case's pleading on the portal${parties.size ? '' : ' (tick at least one client first)'}?`}
          onNo={() => setConfirm(null)}
          onYes={() => submit.mutate({ ...c, parties: [...parties] }, { onSuccess: (r) => { setLatest(r.view); setAdded(r.view.added); setConfirm(null); }, onError: () => setConfirm(null) })} />
      ) : null}
      {confirm?.kind === 'delete' ? (
        <Confirm title="Delete" yes="Delete" busy={del.isPending}
          text="Do you want to delete this document? The associated oath recording will also be deleted permanently."
          onNo={() => setConfirm(null)}
          onYes={() => del.mutate({ ...c, pleadingNumber: confirm.no }, { onSuccess: (r) => { setLatest(r.view); setConfirm(null); }, onError: () => setConfirm(null) })} />
      ) : null}
      {confirm?.kind === 'merge' ? (
        <PortalModal title="Merge" onClose={() => setConfirm(null)} level={2}>
          <div className="col" style={{ gap: 12 }}>
            <ol className="body-sm" style={{ margin: 0 }}>{picks.map((p) => <li key={p}>{p}</li>)}</ol>
            <label style={field}><span style={lbl}>{labels['merge_txt'] || 'Document Title'} *</span>
              <input className="input" value={mergeTitle} onChange={(e) => setMergeTitle(e.target.value)} /></label>
            <p className="body-sm">After merging document, previous indexing of documents get removed, confirm?</p>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!mergeTitle.trim() || merge.isPending}
                onClick={() => merge.mutate({ ...c, pleadingNumbers: picks, title: mergeTitle.trim() }, { onSuccess: (r) => { setLatest(r.view); setPicked(new Set()); setConfirm(null); }, onError: () => setConfirm(null) })}>
                {merge.isPending ? 'Merging on the portal…' : 'Merge'}
              </button>
            </div>
          </div>
        </PortalModal>
      ) : null}
      {viewing ? <FileModal title={viewing} file={view.data} error={view.error} pending={view.isPending} onClose={closeView} /> : null}
    </div>
  );
}

// ---- Pleading Index tab ---------------------------------------------------------

function IndexTab({ sessionId, c, labels }: { sessionId: string; c: CaseRef; labels: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const list = usePleadingIndex(sessionId, c, all, true);
  const addIx = useAddPleadingIndex(sessionId);
  const delIx = useDeletePleadingIndex(sessionId);
  const view = useViewPleadingFile(sessionId);
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', from: '', to: '' });
  const [deleting, setDeleting] = useState<{ no: string; sr: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [table, setTable] = useState<PleadingTable | undefined>(undefined);
  useEffect(() => { setTable(list.data?.table); }, [list.data]);
  const onCall = (_row: PleadingRow, call: PortalCall) => {
    const no = call.args[0] ?? '';
    if (call.fn === 'addIndex') { setForm({ title: '', from: '', to: '' }); addIx.reset(); setAdding(no); view.mutate({ ...c, pleadingNumber: no }); }
    if (call.fn === 'deleteIndex') setDeleting({ no, sr: call.args[1] ?? '' });
    if (call.fn === 'openPdf') { setViewing(no); view.mutate({ ...c, pleadingNumber: no }); }
  };
  const closeView = () => { if (view.data) URL.revokeObjectURL(view.data.url); view.reset(); };
  return (
    <div className="col" style={{ gap: 14 }}>
      <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {list.data?.showAllLabel || labels['chkShowAll'] || 'Show All'}
      </label>
      {list.isLoading ? <p className="body-sm">Reading the index on the portal…</p> : null}
      <Said lines={delIx.data?.portal} error={list.error ?? delIx.error} />
      <PleadingList table={table} empty="No Index Created for This Document." onCall={onCall} busy={addIx.isPending || delIx.isPending} />
      {adding ? (
        <PortalModal title={`Add Index - ${adding}`} onClose={() => { setAdding(null); closeView(); }} level={2}>
          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="col" style={{ gap: 10, flex: '1 1 280px' }}>
              <label style={field}><span style={lbl}>{labels['index_title'] || 'Index Title'} *</span>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label style={field}><span style={lbl}>{labels['from_page_no'] || 'From Page No.'} *</span>
                <input className="input" inputMode="numeric" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value.replace(/\D/g, '') })} /></label>
              <label style={field}><span style={lbl}>{labels['to_page_no'] || 'To Page No.'} *</span>
                <input className="input" inputMode="numeric" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value.replace(/\D/g, '') })} /></label>
              <Said lines={addIx.data?.portal} error={addIx.error} />
              <button type="button" className="btn btn-primary btn-sm" disabled={addIx.isPending}
                onClick={() => addIx.mutate({ ...c, pleadingNumber: adding, title: form.title, fromPage: Number(form.from || 0), toPage: Number(form.to || 0) }, {
                  onSuccess: (r) => { setTable(r.table); if (r.ok) setForm({ title: '', from: '', to: '' }); },
                })}>{addIx.isPending ? 'Saving on the portal…' : 'Submit'}</button>
            </div>
            <div style={{ flex: '2 1 420px' }}>
              {view.isPending ? <p className="body-sm">Opening the document…</p> : null}
              {view.data ? <iframe title={adding} src={view.data.url} style={{ width: '100%', height: '65vh', border: '1px solid var(--border-default)' }} /> : null}
            </div>
          </div>
        </PortalModal>
      ) : null}
      {deleting ? (
        <Confirm title="Delete" text="Want to delete?" yes="Delete" busy={delIx.isPending} onNo={() => setDeleting(null)}
          onYes={() => delIx.mutate({ ...c, pleadingNumber: deleting.no, srNo: deleting.sr }, { onSuccess: (r) => { setTable(r.table); setDeleting(null); }, onError: () => setDeleting(null) })} />
      ) : null}
      {viewing ? <FileModal title={viewing} file={view.data} error={view.error} pending={view.isPending} onClose={() => { setViewing(null); closeView(); }} /> : null}
    </div>
  );
}

// ---- eSign tab -------------------------------------------------------------------

function EsignTab({ sessionId, c }: { sessionId: string; c: CaseRef }) {
  const [all, setAll] = useState(false);
  const list = usePleadingEsign(sessionId, c, all, true);
  const [table, setTable] = useState<PleadingTable | undefined>(undefined);
  useEffect(() => { setTable(list.data?.table); }, [list.data]);
  const [auth, setAuth] = useState<{ no: string; pde: string; month: string } | null>(null);
  const [accept, setAccept] = useState<PortalCall | null>(null);
  const [otp, setOtp] = useState<PortalCall | null>(null);
  const [gateway, setGateway] = useState(false);
  const start = useStartPleadingEsign(sessionId);
  const onCall = (_row: PleadingRow, call: PortalCall) => {
    if (call.fn === 'addAuth') setAuth({ no: call.args[0] ?? '', pde: call.args[1] ?? c.value, month: call.args[2] ?? '' });
    if (call.fn === 'showFrame') setAccept(call);
    if (call.fn === 'showEsignFrame1') setOtp(call);
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {list.data?.showAllLabel || 'Show All'}
      </label>
      {list.isLoading ? <p className="body-sm">Reading the eSign list on the portal…</p> : null}
      <Said error={list.error} />
      <PleadingList table={table} empty="No pleading to sign for this case." onCall={onCall} />
      {auth ? <AuthModal sessionId={sessionId} c={c} target={auth} onClose={() => setAuth(null)} onSaved={setTable} /> : null}
      {accept ? (
        <AcceptModal busy={start.isPending} error={start.error} label={callLabel(accept)} onClose={() => { setAccept(null); start.reset(); }}
          onAccept={() => start.mutate({ ...c, pleadingNumber: accept.args[0] ?? '', signCounter: accept.args[1] ?? '', pageCreated: accept.args[2] ?? '', userName: accept.args[3] ?? '' }, {
            onSuccess: () => { setAccept(null); setGateway(true); },
          })} />
      ) : null}
      {gateway && start.data ? <GatewayModal sessionId={sessionId} first={start.data} onClose={() => { setGateway(false); start.reset(); void list.refetch(); }} /> : null}
      {otp ? <OtpModal sessionId={sessionId} c={c} call={otp} onClose={() => setOtp(null)} onVerified={(t) => t && setTable(t)} /> : null}
    </div>
  );
}

/** "To be signed By": the advocates and clients, eSign or OTP each (the portal's popover). */
function AuthModal({ sessionId, c, target, onClose, onSaved }: {
  sessionId: string; c: CaseRef; target: { no: string; pde: string; month: string }; onClose: () => void; onSaved: (t: PleadingTable) => void;
}) {
  const read = usePleadingAuth(sessionId);
  const save = useSavePleadingAuth(sessionId);
  const [state, setState] = useState<Record<string, { on: boolean; sign: string }>>({});
  useEffect(() => {
    read.mutate({ ...c, pleadingNumber: target.no, pdeNo: target.pde, dirMonth: target.month }, {
      onSuccess: (a: AuthChoice) => {
        const s: Record<string, { on: boolean; sign: string }> = {};
        for (const p of [...a.advocates, ...a.clients]) s[p.id] = { on: p.checked, sign: p.choices.find((x) => x.checked)?.value ?? '' };
        setState(s);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per pleading
  }, [target.no]);
  const a = read.data;
  const group = (title: string, people: AuthChoice['advocates']) => (
    <div className="col" style={{ gap: 6 }}>
      <b>{title}</b>
      {people.length ? people.map((p) => {
        const st = state[p.id] ?? { on: false, sign: '' };
        return (
          <div key={p.id} className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6, alignItems: 'center', flex: '1 1 220px' }}>
              <input type="checkbox" checked={st.on} onChange={(e) => setState({ ...state, [p.id]: { ...st, on: e.target.checked } })} />{p.label}
            </label>
            {p.choices.map((ch) => (
              <label key={ch.value} className="row" style={{ gap: 4, alignItems: 'center' }}>
                <input type="radio" name={`sign-${p.id}`} disabled={!st.on} checked={st.sign === ch.value} onChange={() => setState({ ...state, [p.id]: { ...st, sign: ch.value } })} />{ch.label}
              </label>
            ))}
          </div>
        );
      }) : <span className="body-sm muted">None</span>}
    </div>
  );
  const pick = (people: AuthChoice['advocates']) => people.filter((p) => state[p.id]?.on).map((p) => ({ value: p.value, sign: state[p.id]?.sign ?? '' }));
  return (
    <PortalModal title={a?.labels.title || 'To be signed By'} onClose={onClose} level={2}>
      {read.isPending ? <p className="body-sm">Reading who can sign on the portal…</p> : null}
      <Said lines={save.data?.portal} error={read.error ?? save.error} />
      {a ? (
        <div className="col" style={{ gap: 14 }}>
          {group(a.labels.advocates || 'Advocates', a.advocates)}
          {group(a.labels.clients || 'Clients', a.clients)}
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending}
              onClick={() => save.mutate({ ...c, pleadingNumber: target.no, advocates: pick(a.advocates), clients: pick(a.clients) }, {
                onSuccess: (r) => { if (r.ok) { onSaved(r.table); onClose(); } },
              })}>{save.isPending ? 'Saving on the portal…' : a.labels.submit || 'Submit'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : null}
    </PortalModal>
  );
}

function AcceptModal({ label, busy, error, onAccept, onClose }: { label: string; busy: boolean; error: unknown; onAccept: () => void; onClose: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <PortalModal title={label} onClose={onClose} level={2}>
      <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I accept the Terms &amp; Conditions</label>
        <button type="button" className="btn btn-primary btn-sm" disabled={!ok || busy} onClick={onAccept}>{busy ? 'Opening the eSign page…' : label}</button>
      </div>
      <Said error={error} />
    </PortalModal>
  );
}

/** The Aadhaar eSign gateway the portal opened: its own fields, typed by the advocate and passed on as typed. */
function GatewayModal({ sessionId, first, onClose }: { sessionId: string; first: GatewayView; onClose: () => void }) {
  const step = useStepPleadingEsign(sessionId);
  const g = step.data ?? first;
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { setValues({}); }, [g.url, g.fields.length]);
  return (
    <PortalModal title="eSign" onClose={onClose} level={2}>
      <div className="col" style={{ gap: 12 }}>
        {g.done ? <p style={{ fontWeight: 700 }}>{g.text.join(' ') || 'Document signed Successfully'}</p> : null}
        <Said lines={g.portal} error={step.error} />
        {!g.done && g.screenshotBase64 ? <img alt="The eSign page on the portal" src={`data:image/png;base64,${g.screenshotBase64}`} style={{ maxWidth: '100%', border: '1px solid var(--border-default)' }} /> : null}
        {!g.done && !g.fields.length && !g.screenshotBase64 ? <p className="body-sm">{g.url ? 'The eSign page did not show any field. Close and try eSign again.' : 'The portal did not open the eSign page.'}</p> : null}
        {!g.done ? g.fields.map((f) => (
          <label key={f.key} style={field}>
            <span style={lbl}>{f.label}</span>
            {f.type === 'checkbox' ? <input type="checkbox" checked={values[f.key] === 'true'} onChange={(e) => setValues({ ...values, [f.key]: String(e.target.checked) })} />
              : f.type === 'select' ? (
                <select className="input" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
                </select>
              ) : <input className="input" type={f.type === 'password' ? 'password' : 'text'} autoComplete="off" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
          </label>
        )) : null}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!g.done ? g.buttons.map((b) => (
            <button key={b} type="button" className="btn btn-primary btn-sm" disabled={step.isPending} onClick={() => step.mutate({ values, press: b })}>{step.isPending ? 'On the eSign page…' : b}</button>
          )) : <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Close</button>}
        </div>
      </div>
    </PortalModal>
  );
}

/** OTP authentication instead of eSign (the portal's #verifyMsg window). */
function OtpModal({ sessionId, c, call, onClose, onVerified }: { sessionId: string; c: CaseRef; call: PortalCall; onClose: () => void; onVerified: (t?: PleadingTable) => void }) {
  const send = useSendPleadingOtp(sessionId);
  const verify = useVerifyPleadingOtp(sessionId);
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  return (
    <PortalModal title={`${callLabel(call)} - ${call.args[2] ?? ''}`} onClose={onClose} level={2}>
      <div className="col" style={{ gap: 12, maxWidth: 420 }}>
        <label style={field}><span style={lbl}>Mobile</span>
          <input className="input" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} /></label>
        <button type="button" className="btn btn-primary btn-sm" disabled={send.isPending || send.data?.locked}
          onClick={() => send.mutate({ ...c, args: call.args, mobile })}>{send.isPending ? 'Sending…' : send.data?.button || 'Send OTP'}</button>
        <Said lines={send.data?.portal} error={send.error} />
        <label style={field}><span style={lbl}>OTP</span>
          <input className="input" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <button type="button" className="btn btn-primary btn-sm" disabled={verify.isPending || !send.data}
          onClick={() => verify.mutate({ otp }, { onSuccess: (r) => { setOtp(''); if (r.ok) { onVerified(r.table); } } })}>{verify.isPending ? 'Verifying…' : 'Verify'}</button>
        <Said lines={verify.data?.portal} error={verify.error} />
        {verify.data?.ok ? <p style={{ fontWeight: 700 }}>OTP Authenticated</p> : null}
      </div>
    </PortalModal>
  );
}

// ---- Dashboard > Draft Pleadings / Completed Pleadings -----------------------------

const GRN_TEXT = 'You have not selected GRN, if you have to add court fee for this case then select payment menu from epayment. Do you want to submit case without court fee..?';

/** Draft Pleadings (Submit with the GRN chosen in the row) or Completed Pleadings (Re-Submit after objections). */
export function PortalDraftPleadings({ sessionId, kind }: { sessionId: string; kind: 'draft' | 'completed' }) {
  const list = useDraftPleadings(sessionId, kind);
  const submit = useSubmitDraftPleading(sessionId);
  const resubmit = useResubmitPleading(sessionId);
  const [grn, setGrn] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<null | { call: PortalCall }>(null);
  const rows = (list.data?.rows ?? []).filter(isRow);
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  const go = (call: PortalCall) => {
    if (call.fn === 'resubmit_pleading') resubmit.mutate({ efilingNumber: call.args[0] ?? '' }, { onSettled: () => setAsk(null) });
    else {
      const [uniqueId = '', typeOfCase = '', efilingNumber = ''] = call.args;
      const g = grn[uniqueId] ?? '';
      submit.mutate({ uniqueId, typeOfCase, efilingNumber, grn: g, withoutCourtFee: !g }, { onSettled: () => setAsk(null) });
    }
  };
  const asking = ask?.call;
  const askText = asking?.fn === 'resubmit_pleading' ? `Re-submit ${asking.args[0] ?? ''} to the court?`
    : asking && !(grn[asking.args[0] ?? ''] ?? '') ? GRN_TEXT : `Submit ${asking?.args[2] ?? ''} to the court with GRN ${grn[asking?.args[0] ?? ''] ?? ''}? It cannot be undone.`;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{kind === 'draft' ? 'Draft Pleadings' : 'Completed Pleadings'}</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={list.isFetching} onClick={() => void list.refetch()}>{list.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
      </div>
      <Said lines={submit.data?.portal ?? resubmit.data?.portal} error={list.error ?? submit.error ?? resubmit.error} />
      {list.isLoading ? <p className="body-sm">Reading the portal…</p> : !rows.length ? <p className="body-sm muted">No {kind === 'draft' ? 'draft' : 'completed'} pleadings on your portal account.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{(list.data?.headers ?? []).map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? undefined : 'var(--bg-surface-2)' }}>
                  {r.cells.map((cell, j) => {
                    const sel = r.selects?.find((s) => (r.calls ?? []).some((c) => c.fn === 'submit_pleading' && c.args[0] === s.id));
                    const call = (r.calls ?? []).find((c) => (c.fn === 'submit_pleading' || c.fn === 'resubmit_pleading') && callLabel(c) === cell.trim());
                    if (sel && j === r.cells.findIndex((x, k) => k === j && !x && sel)) {
                      return (
                        <td key={j} style={td}>
                          <select className="input" aria-label="GRN" value={grn[sel.id] ?? ''} onChange={(e) => setGrn({ ...grn, [sel.id]: e.target.value })}>
                            {sel.options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td key={j} style={td}>
                        {call ? <button type="button" style={inverseBtn} disabled={submit.isPending || resubmit.isPending} onClick={() => setAsk({ call })}>{callLabel(call)}</button> : cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {asking ? (
        <Confirm title={callLabel(asking)} text={askText} yes={asking.fn === 'submit_pleading' && !(grn[asking.args[0] ?? ''] ?? '') ? 'Submit without court fee' : callLabel(asking)}
          busy={submit.isPending || resubmit.isPending} onNo={() => setAsk(null)} onYes={() => go(asking)} />
      ) : null}
    </div>
  );
}

// ---- Pleadings > Video Recording (oath) ---------------------------------------------

function OathRecording({ sessionId }: { sessionId: string }) {
  const screen = useOathScreen(sessionId);
  const s = screen.data;
  const [searchCase, setSearchCase] = useState('');
  const [pdeNo, setPdeNo] = useState('');
  const [document, setDocument] = useState('');
  const [client, setClient] = useState('');
  useEffect(() => { if (s && !searchCase) setSearchCase(s.sources.find((x) => x.checked)?.value ?? s.sources[0]?.value ?? ''); }, [s, searchCase]);
  const caseQ = useOathCase(sessionId, pdeNo ? { searchCase, pdeNo } : null);
  const docQ = useOathDocument(sessionId, document ? { searchCase, pdeNo, document } : null);
  const play = usePlayOath(sessionId);
  const [playing, setPlaying] = useState<string | null>(null);
  const label = (id: string, fallback: string) => s?.labels[id] || docQ.data?.labels[id] || fallback;
  const recorderLabels = useMemo(() => Object.entries(s?.labels ?? {}).filter(([k]) => k.startsWith('recorder')).map(([, v]) => v), [s]);

  if (screen.isLoading) return <p className="body-sm">Opening Pleadings &gt; Video Recording on your portal…</p>;
  if (screen.isError || !s) return <Said error={screen.error ?? new Error("Couldn't open Video Recording on the portal.")} />;
  const d = docQ.data;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{s.title || 'Video Recording'}</h2>
        <button type="button" className="btn btn-ghost btn-sm" disabled={screen.isFetching || caseQ.isFetching}
          onClick={() => { void screen.refetch(); if (pdeNo) void caseQ.refetch(); }}>{screen.isFetching || caseQ.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
      </div>
      <div className="row" role="radiogroup" aria-label="Case" style={{ gap: 18, flexWrap: 'wrap' }}>
        {s.sources.map((r) => (
          <label key={r.value} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 600 }}>
            <input type="radio" name="oath-case" checked={searchCase === r.value} onChange={() => { setSearchCase(r.value); setPdeNo(''); setDocument(''); }} />{r.label}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <label style={field}><span style={lbl}>{label('sel_pde_no', 'e-Filing Number')}</span>
          <select className="input" value={pdeNo} onChange={(e) => { setPdeNo(e.target.value); setDocument(''); setClient(''); }}>
            <option value="">Select</option>
            {s.cases.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
          </select></label>
        <label style={field}><span style={lbl}>{label('selDocument', 'Document')}</span>
          <select className="input" value={document} disabled={!caseQ.data} onChange={(e) => { setDocument(e.target.value); setClient(''); }}>
            <option value="">Select</option>
            {(caseQ.data?.documents ?? []).map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
          </select></label>
      </div>
      <Said error={caseQ.error ?? docQ.error} />
      {docQ.isFetching ? <p className="body-sm">Reading the document's details on the portal…</p> : null}
      {d ? (
        <div className="col" style={{ gap: 12, border: '1px solid var(--border-default)', padding: 14 }}>
          {[['est_name', 'Establishment', d.establishment], ['cause_tit', 'Cause Title', d.causeTitle], ['case_num', 'Case Number', d.caseNumber], ['liti_name', 'Litigant', d.litigants]]
            .filter(([, , v]) => v).map(([id, fb, v]) => (
              <div key={id} className="row" style={{ gap: 10, flexWrap: 'wrap' }}><b style={{ minWidth: 160 }}>{label(id!, fb!)}</b><span>{v}</span></div>
            ))}
          {d.oathMessage ? <p style={{ border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', padding: 12, margin: 0 }}>{d.oathMessage}</p> : null}
          <label style={{ ...field, maxWidth: 420 }}><span style={lbl}>{label('selClientList', 'Client')}</span>
            <select className="input" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">Select Client</option>
              {d.clients.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
            </select></label>
          <Recorder sessionId={sessionId} labels={recorderLabels} target={client ? { searchCase, pdeNo, document, client } : null} clientName={client.split('~')[2] ?? ''} />
        </div>
      ) : null}
      {pdeNo ? (
        <PleadingList table={caseQ.data?.videos} empty="No oath video recorded for this case yet."
          onCall={(_r, call) => { if (call.fn === 'setVideo') { setPlaying(call.args[0] ?? ''); play.mutate({ filepath: call.args[0] ?? '' }); } }} />
      ) : null}
      {playing ? <FileModal kind="video" title="Oath Video" file={play.data} error={play.error} pending={play.isPending} onClose={() => { if (play.data) URL.revokeObjectURL(play.data.url); setPlaying(null); play.reset(); }} /> : null}
    </div>
  );
}

/** The webcam recorder (the portal uses RecordRTC in the browser); the recording goes up through the portal's own upload. */
function Recorder({ sessionId, labels, target, clientName }: {
  sessionId: string; labels: string[]; clientName: string;
  target: { searchCase: string; pdeNo: string; document: string; client: string } | null;
}) {
  const upload = useUploadOath(sessionId);
  const live = useRef<HTMLVideoElement>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'done'>('idle');
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); if (clip) URL.revokeObjectURL(clip.url); }, [clip]);
  const startLabel = labels.find((l) => /start/i.test(l)) || 'Start Recording';
  const pauseLabel = labels.find((l) => /pause/i.test(l)) || 'Pause';
  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (live.current) { live.current.srcObject = stream; void live.current.play(); }
      const mime = ['video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || 'video/webm' });
        setClip({ blob, url: URL.createObjectURL(blob) });
        setState('done');
      };
      r.start(1000);
      rec.current = r;
      setClip(null);
      setState('recording');
    } catch (e) {
      setErr(errText(e, 'The camera could not be opened in this browser.'));
    }
  };
  const doUpload = async () => {
    if (!clip || !target) return;
    const base64 = await fileToBase64(clip.blob);
    upload.mutate({ ...target, video: { base64, mimeType: clip.blob.type || 'video/webm' } }, { onSettled: () => setConfirm(false) });
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      {clientName ? <p className="body-sm" style={{ margin: 0 }}><b>{clientName}</b></p> : null}
      <video ref={live} muted playsInline style={{ width: '100%', maxWidth: 520, background: 'var(--bg-inverse)', display: state === 'recording' || state === 'paused' ? 'block' : 'none' }} />
      {clip ? <video src={clip.url} controls style={{ width: '100%', maxWidth: 520, background: 'var(--bg-inverse)' }} /> : null}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {state === 'idle' || state === 'done' ? <button type="button" className="btn btn-primary btn-sm" disabled={!target} onClick={() => void start()}>{startLabel}</button> : null}
        {state === 'recording' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { rec.current?.pause(); setState('paused'); }}>{pauseLabel}</button> : null}
        {state === 'paused' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { rec.current?.resume(); setState('recording'); }}>Resume</button> : null}
        {state === 'recording' || state === 'paused' ? <button type="button" className="btn btn-primary btn-sm" onClick={() => rec.current?.stop()}>Stop Recording</button> : null}
        {clip ? <button type="button" className="btn btn-primary btn-sm" disabled={upload.isPending || !target} onClick={() => setConfirm(true)}>{upload.isPending ? 'Uploading to the portal…' : 'Upload'}</button> : null}
      </div>
      {!target ? <p className="body-sm muted">Select the client first.</p> : null}
      <Said lines={upload.data?.portal} error={err ? new Error(err) : upload.error} />
      {confirm ? (
        <Confirm title="Upload" text="Do you want to Upload this Oath Video? Once uploaded it cannot be modified or re-uploaded." yes="Upload"
          busy={upload.isPending} onNo={() => setConfirm(false)} onYes={() => void doUpload()} />
      ) : null}
    </div>
  );
}

// ---- entry ------------------------------------------------------------------------

/** The Pleadings menu, live on the portal: Use Template, Pleadings (upload with its Index and eSign tabs), Video Recording. */
export function PortalPleadings({ sessionId, view }: { sessionId: string; view: 'templates' | 'pleadings' | 'oath' }) {
  if (view === 'templates') return <UseTemplate sessionId={sessionId} />;
  return view === 'oath' ? <OathRecording sessionId={sessionId} /> : <PleadingUpload sessionId={sessionId} />;
}
