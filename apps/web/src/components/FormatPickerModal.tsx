import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';
import { useEngineStatus } from '@/hooks/useEngineDraft';
import { useDeleteFormat } from '@/hooks/useFirmFormats';
import {
  previewBlankPdf,
  saveBlankPdf,
  useBlankFormat,
  useFormatLibrary,
  type BlankForm,
  type LaweForm,
} from '@/hooks/useFormatLibrary';
import { useUIStore } from '@/store/ui';
import { Modal } from './Modal';
import { UploadFormatModal } from './UploadFormatModal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The format currently chosen, so it can be marked in the list. */
  current: string | null;
  /** Draft a format — sets the Draft page's document type (+ an optional variant
   *  preset, e.g. a LAWE "Property" form = Court Warrant of possession). */
  onPick: (label: string, preset?: Record<string, string>, title?: string) => void;
  /** Open a format's blank form in the Draft page editor, to fill in by hand and
   *  then download as Word or PDF. */
  onOpenBlank: (label: string, blank: BlankForm) => void;
}

/** One format in the library, however it is listed. */
interface Row {
  key: string;
  /** Shown as the row title. */
  title: string;
  /** Secondary line (LAWE section · the format that drafts it). */
  subtitle?: string;
  /** The Draft-page label that drafts / renders it. */
  docLabel: string;
  preset?: Record<string, string>;
  /** Offer a Preview (DifAi's own PDF of the form, in a new tab). */
  previewable?: boolean;
  /** Extra trailing actions (firm: remove). */
  extra?: ReactNode;
}

// Even grid of same-size rows: name (click = draft) · PDF · Word.
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
  gap: 8,
};
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 44,
  padding: '4px 6px 4px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface, transparent)',
};
const NAME: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
  padding: '4px 0',
  background: 'none',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};
const ELLIPSIS: CSSProperties = {
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const ACTION: CSSProperties = { minWidth: 46, justifyContent: 'center' };

/**
 * The FORMS LIBRARY. Every format the engine can draft, in three sections:
 *   - your firm's own formats (uploaded here, private to the firm);
 *   - every format, grouped by category — the engine formats together with the
 *     court-forms library (each a named variant of a format); previews show
 *     DifAi's own rendering (the library's source files are never served).
 * Click a format's name to DRAFT it from the case; PDF downloads the blank form;
 * Word opens the blank form in the editor to fill in, then download.
 */
export function FormatPickerModal({ open, onClose, current, onPick, onOpenBlank }: Props) {
  const engineStatus = useEngineStatus();
  const library = useFormatLibrary();
  const blank = useBlankFormat();
  const firmFormats = engineStatus.data?.firmFormats ?? [];
  const firmLabels = useMemo(() => new Set(firmFormats.map((f) => f.label)), [firmFormats]);
  const formats = useMemo(
    () => (engineStatus.data?.formats ?? []).filter((l) => !firmLabels.has(l)),
    [engineStatus.data?.formats, firmLabels],
  );
  const lawe = library.data?.lawe ?? [];
  const enabled = Boolean(engineStatus.data?.enabled);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The ROW last picked: several LAWE forms draft as the same format, so the
  // tick follows the row the advocate clicked, not every row sharing its label.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const removeFormat = useDeleteFormat();
  const showToast = useUIStore((s) => s.showToast);

  const q = query.trim().toLowerCase();
  const matches = (r: Row) => !q || `${r.title} ${r.subtitle ?? ''}`.toLowerCase().includes(q);

  const firmRows: Row[] = firmFormats.map((f) => ({
    key: `firm:${f.id}`,
    title: f.title,
    docLabel: f.label,
    extra: (
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${f.title}`} title="Remove from your firm's formats"
        onClick={() => { void onRemove(f.id, f.title); }}>
        <Icon name="trash" size={13} aria-hidden />
      </button>
    ),
  }));
  // Every format in one list: the engine formats plus the library's court forms
  // (each a named variant of a format). A library form whose name is exactly an
  // existing format's (e.g. "Bail Bond") isn't listed twice.
  const allRows = useMemo((): Row[] => {
    const formatRows: Row[] = formats.map((label) => ({
      key: `fmt:${label}`, title: label, docLabel: label, previewable: true,
    }));
    const taken = new Set(formats.map((l) => l.trim().toLowerCase()));
    const libraryRows: Row[] = lawe
      .filter((f: LaweForm) => !taken.has(f.title.trim().toLowerCase()))
      .map((f: LaweForm) => ({
        key: `lib:${f.id}`,
        title: f.title,
        subtitle: `${f.group} · drafts as ${f.docLabel}`,
        docLabel: f.docLabel,
        preset: f.preset,
        previewable: true,
      }));
    return [...formatRows, ...libraryRows];
  }, [formats, lawe]);

  const shownFirm = firmRows.filter(matches);
  const shownGroups = groupRows(allRows.filter(matches));
  const totalShown = shownGroups.reduce((n, g) => n + g.rows.length, 0);

  const pick = (label: string, preset?: Record<string, string>, title?: string, key?: string) => {
    setPickedKey(key ?? null);
    onClose();
    onPick(label, preset, title ?? label);
  };

  async function onRemove(id: string, title: string) {
    if (!window.confirm(`Remove "${title}" from your firm's formats?`)) return;
    try {
      await removeFormat.mutateAsync(id);
      showToast({ type: 'sage', text: 'Format removed' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not remove the format' });
    }
  }

  const fetchBlank = async (row: Row, as: 'pdf' | 'word' | 'preview') => {
    setBusy(`${row.key}:${as}`);
    // Open the preview tab NOW (inside the click), or pop-up blockers stop it.
    const tab = as === 'preview' ? window.open('', '_blank') : null;
    if (tab) tab.document.title = `${row.title} — preview`;
    try {
      const form = await blank.mutateAsync({
        docLabel: row.docLabel,
        ...(row.preset && Object.keys(row.preset).length ? { preset: row.preset } : {}),
      });
      if (as === 'preview') {
        if (!tab) throw new Error('popup blocked');
        await previewBlankPdf(tab, form.docxBase64, `${row.title} (blank)`);
      } else if (as === 'pdf') {
        await saveBlankPdf(form.docxBase64, `${row.title} (blank)`);
        showToast({ type: 'sage', text: `${row.title}: blank PDF downloaded` });
      } else {
        onOpenBlank(row.title, form);
        onClose();
      }
    } catch (err) {
      tab?.close();
      const status = (err as { response?: { status?: number } })?.response?.status;
      showToast({
        type: 'amber',
        text: status === 409
          ? `${row.title} can only be produced from the case details. Click its name to draft it instead.`
          : `Could not prepare ${row.title}. Try again in a moment.`,
      });
    } finally {
      setBusy(null);
    }
  };

  const renderRow = (row: Row) => {
    const isCurrent = row.docLabel === current && (pickedKey === null ? !row.preset && !row.subtitle : pickedKey === row.key);
    return (
      <div key={row.key} style={{ ...ROW, ...(isCurrent ? { borderColor: 'var(--text-primary)' } : {}) }}>
        <button type="button" style={NAME} onClick={() => pick(row.docLabel, row.preset, row.title, row.key)} title={`Draft ${row.title}`}>
          <span className="body-sm" style={{ ...ELLIPSIS, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={ELLIPSIS}>{row.title}</span>
            {isCurrent && <Icon name="check" size={12} aria-hidden style={{ flexShrink: 0 }} />}
          </span>
          {row.subtitle && <span className="body-xs muted" style={ELLIPSIS}>{row.subtitle}</span>}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={ACTION} disabled={busy !== null}
          title="Download the blank form as PDF" onClick={() => { void fetchBlank(row, 'pdf'); }}>
          {busy === `${row.key}:pdf` ? '…' : 'PDF'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={ACTION} disabled={busy !== null}
          title="Open the blank form in the editor to fill in, then download as Word" onClick={() => { void fetchBlank(row, 'word'); }}>
          {busy === `${row.key}:word` ? '…' : 'Word'}
        </button>
        {row.previewable && (
          <button type="button" className="btn btn-ghost btn-sm" style={ACTION} disabled={busy !== null}
            title="Preview this form (opens in a new tab)" aria-label={`Preview ${row.title}`}
            onClick={() => { void fetchBlank(row, 'preview'); }}>
            {busy === `${row.key}:preview` ? '…' : '↗'}
          </button>
        )}
        {row.extra}
      </div>
    );
  };

  const heading = (text: string, right?: ReactNode) => (
    <div className="row" style={{ alignItems: 'center', gap: 8, margin: '4px 0 8px' }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>{text}</span>
      <span className="spacer" style={{ flex: 1 }} />
      {right}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={920}
      eyebrow="Formats"
      title="Forms library"
      description="Click a format’s name to draft it from the case. PDF downloads the blank form; Word opens it in the editor so you can fill it in, then download."
      footer={<button type="button" className="btn" onClick={onClose}>Done</button>}
    >
      {!enabled && (
        <p className="body-sm" style={{ marginBottom: 10 }}>
          Engine-routed drafting isn’t switched on for your account yet. You can browse and download
          blank formats, but drafting through them needs the beta enabled by your admin.
        </p>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Icon name="search" size={14} aria-hidden />
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Search formats… (e.g. bail, vakalat, warrant, sale deed)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {/* YOUR FIRM'S FORMATS */}
      <section style={{ marginBottom: 20 }}>
        {heading('YOUR FIRM’S FORMATS', (
          <button type="button" className="btn btn-sm" onClick={() => setUploading(true)}>
            <Icon name="upload" size={12} aria-hidden /> Upload a format
          </button>
        ))}
        {firmRows.length === 0 ? (
          <p className="body-xs muted" style={{ margin: 0 }}>
            Have a format your office uses that isn’t listed? Upload it (PDF, scan or photo, Word) and
            DifAi will draft it from the case.
          </p>
        ) : (
          <div style={GRID}>{shownFirm.map(renderRow)}</div>
        )}
      </section>

      <UploadFormatModal
        open={uploading}
        onClose={() => setUploading(false)}
        onSaved={(label) => { setUploading(false); pick(label); }}
        onUseExisting={(label) => { setUploading(false); pick(label); }}
      />

      {/* ALL FORMATS — one categorised list */}
      {heading('ALL FORMATS', <span className="body-xs muted">{q ? `${totalShown} of ${allRows.length}` : `${allRows.length} formats`}</span>)}
      {engineStatus.isLoading && <span className="body-sm muted">Loading formats…</span>}
      {!engineStatus.isLoading && formats.length === 0 && <span className="body-sm muted">No engine formats available.</span>}
      {!engineStatus.isLoading && formats.length > 0 && totalShown === 0 && (
        <span className="body-sm muted">No format matches “{query}”.</span>
      )}
      <div className="col" style={{ gap: 16 }}>
        {shownGroups.map((g) => (
          <section key={g.group}>
            <div className="body-xs" style={{ fontWeight: 600, marginBottom: 6 }}>{g.group}</div>
            <div style={GRID}>{g.rows.map(renderRow)}</div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Bucket formats into readable groups by keyword — on the row's own name first,
 * then on the format that drafts it (so a court form named "Property" lands with
 * warrants). Purely cosmetic: every row still drafts by itself. Unmatched rows go
 * to "Other".
 */
function groupRows(rows: Row[]): Array<{ group: string; rows: Row[] }> {
  const buckets: Array<{ group: string; test: (l: string) => boolean }> = [
    { group: 'Notices', test: (l) => /notice|reply/i.test(l) },
    { group: 'Pleadings', test: (l) => /plaint|written statement|suit|petition|complaint|caveat|appeal/i.test(l) },
    { group: 'Bail & Criminal', test: (l) => /bail|bond|surety|surrender|crpc|warrant|317|256|criminal/i.test(l) },
    { group: 'Applications', test: (l) => /application|execution|adjourn|urgent|service|process|substituted|indigent|copies/i.test(l) },
    { group: 'Family & Matrimonial', test: (l) => /divorce|maintenance|conjugal|judicial separation|domestic|family|succession/i.test(l) },
    { group: 'Deeds & Conveyancing', test: (l) => /deed|will|power of attorney|agreement|lease|mortgage|gift|relinquish|sale/i.test(l) },
    { group: 'Appearance & Registry', test: (l) => /vakalat|appearance|coding|memorandum/i.test(l) },
    { group: 'Court-Issued', test: (l) => /summons|court notice|court warrant/i.test(l) },
  ];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = buckets.find((b) => b.test(row.title)) ?? buckets.find((b) => b.test(row.docLabel));
    const group = bucket?.group ?? 'Other';
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  // Preserve the bucket order defined above; "Other" last.
  const ordered = [...buckets.map((b) => b.group), 'Other'];
  return ordered
    .filter((g) => groups.has(g))
    .map((group) => ({
      group,
      rows: (groups.get(group) ?? []).sort((a, b) => a.title.localeCompare(b.title) || (a.subtitle ?? '').localeCompare(b.subtitle ?? '')),
    }));
}
