import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useEngineStatus } from '@/hooks/useEngineDraft';
import { useDeleteFormat } from '@/hooks/useFirmFormats';
import { saveDocx, useBlankFormat, useFormatLibrary, type LaweForm } from '@/hooks/useFormatLibrary';
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
  onPick: (label: string, preset?: Record<string, string>) => void;
}

/**
 * The FORMS LIBRARY. Every format the engine can draft, in three sections:
 *   - your firm's own formats (uploaded here, private to the firm);
 *   - the LAWE forms library (lawe.co.in), each mapped to the format that drafts
 *     it, with a link to the original on LAWE's site (never re-hosted here);
 *   - every engine format, grouped.
 * Each format can be DRAFTED (opens the drafting card for it — the case, typed
 * details and attachments fill it) or DOWNLOADED BLANK as an editable Word form.
 */
export function FormatPickerModal({ open, onClose, current, onPick }: Props) {
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
  const [downloading, setDownloading] = useState<string | null>(null);
  const removeFormat = useDeleteFormat();
  const showToast = useUIStore((s) => s.showToast);

  const q = query.trim().toLowerCase();
  const shownFirm = useMemo(
    () => (q ? firmFormats.filter((f) => f.label.toLowerCase().includes(q)) : firmFormats),
    [firmFormats, q],
  );
  const shownLawe = useMemo(
    () => (q
      ? lawe.filter((f) => `${f.title} ${f.group} ${f.docLabel}`.toLowerCase().includes(q))
      : lawe),
    [lawe, q],
  );
  const groups = useMemo(() => groupFormats(formats), [formats]);
  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((label) => label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  const total = formats.length;
  const shown = filtered.reduce((n, g) => n + g.items.length, 0);

  const pick = (label: string, preset?: Record<string, string>) => { onPick(label, preset); onClose(); };

  const onRemove = async (id: string, title: string) => {
    if (!window.confirm(`Remove "${title}" from your firm's formats?`)) return;
    try {
      await removeFormat.mutateAsync(id);
      showToast({ type: 'sage', text: 'Format removed' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not remove the format' });
    }
  };

  const download = async (key: string, docLabel: string, fileTitle: string, preset?: Record<string, string>) => {
    setDownloading(key);
    try {
      const out = await blank.mutateAsync({ docLabel, ...(preset && Object.keys(preset).length ? { preset } : {}) });
      saveDocx(out.docxBase64, `${fileTitle} (blank)`);
      showToast({ type: 'sage', text: `${fileTitle}: blank Word form downloaded` });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      showToast({
        type: 'amber',
        text: status === 409
          ? `${fileTitle} can only be produced from the case details. Use Draft instead.`
          : `Could not download ${fileTitle}.`,
      });
    } finally {
      setDownloading(null);
    }
  };

  const DownloadButton = ({ id, docLabel, title, preset }: { id: string; docLabel: string; title: string; preset?: Record<string, string> }) => (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title="Download blank (editable Word)"
      aria-label={`Download ${title} as a blank Word form`}
      disabled={downloading !== null}
      onClick={() => { void download(id, docLabel, title, preset); }}
    >
      {downloading === id ? '…' : <Icon name="download" size={12} aria-hidden />}
    </button>
  );

  const eyebrow = (text: string) => (
    <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
      {text}
    </span>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      eyebrow="Formats"
      title="Forms library"
      description="Draft any format from the case, or download it blank as an editable Word form. Drafting fills it from the case you picked, what you type and anything you attach."
      footer={<button type="button" className="btn" onClick={onClose}>Done</button>}
    >
      {!enabled && (
        <p className="body-sm" style={{ marginBottom: 10 }}>
          Engine-routed drafting isn’t switched on for your account yet. You can browse and download
          blank formats, but drafting through them needs the beta enabled by your admin.
        </p>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <div className="row" style={{ gap: 6, flex: 1, alignItems: 'center' }}>
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
      </div>

      {/* YOUR FIRM'S FORMATS */}
      <div className="col" style={{ gap: 6, marginBottom: 18 }}>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          {eyebrow('YOUR FIRM’S FORMATS')}
          <span className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" onClick={() => setUploading(true)}>
            <Icon name="upload" size={12} aria-hidden /> Upload a format
          </button>
        </div>
        {firmFormats.length === 0 ? (
          <span className="body-xs muted">
            Have a format your office uses that isn’t listed? Upload it (PDF, scan or photo, Word) and
            LexDraft will draft it from the case.
          </span>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {shownFirm.map((f) => (
              <span key={f.id} className="row" style={{ gap: 2, alignItems: 'center' }}>
                <button type="button" className={`btn btn-sm${f.label === current ? ' btn-primary' : ''}`} onClick={() => pick(f.label)}>
                  {f.title}
                  {f.label === current && <Icon name="check" size={12} aria-hidden />}
                </button>
                <DownloadButton id={`firm:${f.id}`} docLabel={f.label} title={f.title} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${f.title}`} title="Remove"
                  onClick={() => { void onRemove(f.id, f.title); }}>
                  <Icon name="trash" size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <UploadFormatModal
        open={uploading}
        onClose={() => setUploading(false)}
        onSaved={(label) => { setUploading(false); pick(label); }}
        onUseExisting={(label) => { setUploading(false); pick(label); }}
      />

      {/* LAWE FORMS LIBRARY */}
      {lawe.length > 0 && (
        <details open={Boolean(q)} style={{ marginBottom: 18 }}>
          <summary className="row" style={{ cursor: 'pointer', gap: 8, alignItems: 'center', listStyle: 'none' }}>
            {eyebrow(`LAWE FORMS LIBRARY (${shownLawe.length})`)}
            <span className="body-xs muted">Court forms from lawe.co.in, ready to draft here</span>
          </summary>
          <div className="col" style={{ gap: 2, marginTop: 8 }}>
            {shownLawe.map((f: LaweForm) => (
              <div key={f.id} className="row" style={{ gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="col" style={{ flex: 1, minWidth: 0 }}>
                  <span className="body-sm">{f.title}</span>
                  <span className="body-xs muted">{f.group} · drafts as {f.docLabel}</span>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => pick(f.docLabel, f.preset)}>Draft</button>
                <DownloadButton id={`lawe:${f.id}`} docLabel={f.docLabel} title={f.title} preset={f.preset} />
                <a className="btn btn-ghost btn-sm" href={f.url} target="_blank" rel="noopener noreferrer"
                  title="Open the original form on lawe.co.in">
                  Original ↗
                </a>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ALL FORMATS */}
      <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
        {eyebrow('ALL FORMATS')}
        <span className="spacer" style={{ flex: 1 }} />
        <span className="body-xs muted">{q ? `${shown} of ${total}` : `${total} formats`}</span>
      </div>
      {engineStatus.isLoading && <span className="body-sm muted">Loading formats…</span>}
      {!engineStatus.isLoading && total === 0 && <span className="body-sm muted">No engine formats available.</span>}
      {!engineStatus.isLoading && total > 0 && shown === 0 && (
        <span className="body-sm muted">No format matches “{query}”.</span>
      )}
      <div className="col" style={{ gap: 16 }}>
        {filtered.map((g) => (
          <div key={g.group} className="col" style={{ gap: 6 }}>
            {eyebrow(g.group.toUpperCase())}
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {g.items.map((label) => {
                const isCurrent = label === current;
                return (
                  <span key={label} className="row" style={{ gap: 2, alignItems: 'center' }}>
                    <button type="button" className={`btn btn-sm${isCurrent ? ' btn-primary' : ''}`} onClick={() => pick(label)}>
                      {label}
                      {isCurrent && <Icon name="check" size={12} aria-hidden />}
                    </button>
                    <DownloadButton id={`fmt:${label}`} docLabel={label} title={label} />
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Bucket the engine's flat label list into readable groups by keyword. Purely
 * cosmetic — every label still routes by itself; this only organises the picker.
 * Anything unmatched falls into "Other".
 */
function groupFormats(formats: string[]): Array<{ group: string; items: string[] }> {
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
  const groups = new Map<string, string[]>();
  const put = (group: string, label: string) => {
    const arr = groups.get(group) ?? [];
    arr.push(label);
    groups.set(group, arr);
  };
  for (const label of formats) {
    const bucket = buckets.find((b) => b.test(label));
    put(bucket?.group ?? 'Other', label);
  }
  // Preserve the bucket order defined above; "Other" last.
  const ordered = [...buckets.map((b) => b.group), 'Other'];
  return ordered
    .filter((g) => groups.has(g))
    .map((group) => ({ group, items: (groups.get(group) ?? []).sort((a, b) => a.localeCompare(b)) }));
}
