import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useEngineStatus } from '@/hooks/useEngineDraft';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The format currently chosen, so it can be marked in the list. */
  current: string | null;
  /** Choose a format to draft — sets the Draft page's document type. */
  onPick: (label: string) => void;
}

/**
 * The engine FORMAT picker — lets the advocate choose which of the engine's
 * drafting formats to produce (all of them, not just the curated General-AI set).
 * The list is the engine's own catalogue (GET /engine/status -> `formats`), so it
 * always reflects exactly what the engine can draft — the DPC pleadings/deeds and
 * the TN/Madras court forms alike, with no per-format wiring here.
 *
 * Picking a format sets the Draft page's document type; when the engine path is
 * enabled for this advocate, the Engine-Routed card then activates for it.
 */
export function FormatPickerModal({ open, onClose, current, onPick }: Props) {
  const engineStatus = useEngineStatus();
  const formats = engineStatus.data?.formats ?? [];
  const enabled = Boolean(engineStatus.data?.enabled);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => groupFormats(formats), [formats]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((label) => label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const total = formats.length;
  const shown = filtered.reduce((n, g) => n + g.items.length, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Formats"
      title="Choose a format to draft"
      description="Every format the engine can produce — pick one and the drafting card opens for it. The engine still decides what each format needs and enforces the legal hard-stops."
      footer={<button type="button" className="btn" onClick={onClose}>Done</button>}
    >
      {!enabled && (
        <p className="body-sm" style={{ color: 'var(--warning)', marginBottom: 10 }}>
          Engine-routed drafting isn’t switched on for your account yet. You can browse
          the formats, but drafting through them needs the beta enabled by your admin.
        </p>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div className="row" style={{ gap: 6, flex: 1, alignItems: 'center' }}>
          <Icon name="search" size={14} aria-hidden />
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Search formats… (e.g. bail, vakalat, sale deed)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <span className="body-xs muted" style={{ whiteSpace: 'nowrap' }}>
          {query ? `${shown} of ${total}` : `${total} formats`}
        </span>
      </div>

      {engineStatus.isLoading && <span className="body-sm muted">Loading formats…</span>}
      {!engineStatus.isLoading && total === 0 && (
        <span className="body-sm muted">No engine formats available.</span>
      )}
      {!engineStatus.isLoading && total > 0 && shown === 0 && (
        <span className="body-sm muted">No format matches “{query}”.</span>
      )}

      <div className="col" style={{ gap: 16 }}>
        {filtered.map((g) => (
          <div key={g.group} className="col" style={{ gap: 6 }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}
            >
              {g.group.toUpperCase()}
            </span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {g.items.map((label) => {
                const isCurrent = label === current;
                return (
                  <button
                    key={label}
                    type="button"
                    className={`btn btn-sm${isCurrent ? ' btn-primary' : ''}`}
                    onClick={() => { onPick(label); onClose(); }}
                  >
                    {label}
                    {isCurrent && <Icon name="check" size={12} aria-hidden />}
                  </button>
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
