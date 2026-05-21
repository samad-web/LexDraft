import { useMemo } from 'react';
import { useLetterheads, type Letterhead } from '@/hooks/useLetterheads';

/**
 * Letterhead picker for export dialogs.
 *
 * Controlled component. Three states the caller cares about:
 *   - `value === undefined` - "auto-default", the exporter will look up the
 *     effective default itself
 *   - `value === null`      - "no letterhead", the user opted out
 *   - `value === string`    - the picked letterhead id
 *
 * We deliberately don't pre-resolve the letterhead inside the picker - the
 * exporter does that with `resolveLetterhead(id)` so the network call only
 * happens at export time, not on every dropdown change.
 */
interface LetterheadPickerProps {
  /** Letterhead id, `null` (suppress), or `undefined` (auto-default). */
  value: string | null | undefined;
  onChange: (next: string | null | undefined) => void;
  /** Label rendered above the select. Defaults to "Letterhead". */
  label?: string;
  /** Optional className for the wrapping container. */
  className?: string;
}

export function LetterheadPicker({
  value,
  onChange,
  label = 'Letterhead',
  className,
}: LetterheadPickerProps) {
  const { data, isLoading } = useLetterheads();
  const items = useMemo(() => buildOptions(data?.firmItems, data?.personalItems, data?.effectiveDefault), [data]);
  const hasAny = (data?.firmItems?.length ?? 0) + (data?.personalItems?.length ?? 0) > 0;

  const selectValue =
    value === undefined ? '__default__' : value === null ? '__none__' : value;

  return (
    <label className={`col ${className ?? ''}`} style={{ gap: 4 }}>
      <span className="label" style={{ fontSize: 11 }}>{label}</span>
      <select
        className="input"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__default__') onChange(undefined);
          else if (v === '__none__') onChange(null);
          else onChange(v);
        }}
        disabled={isLoading}
        style={{ minWidth: 200 }}
      >
        <option value="__default__">
          {data?.effectiveDefault
            ? `Default - ${data.effectiveDefault.name}`
            : 'Default (none configured)'}
        </option>
        <option value="__none__">No letterhead</option>
        {items.length > 0 && (
          <optgroup label="-">
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {!isLoading && !hasAny && (
        <span
          className="body-xs muted"
          style={{ marginTop: 2 }}
        >
          No letterheads configured yet. Add one under{' '}
          <a
            href="/app/settings"
            style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}
          >
            Settings → Letterhead
          </a>
          {' '}so this document picks one up automatically.
        </span>
      )}
    </label>
  );
}

interface PickerOption { id: string; label: string }

function buildOptions(
  firmItems: Letterhead[] | undefined,
  personalItems: Letterhead[] | undefined,
  effective: Letterhead | null | undefined,
): PickerOption[] {
  const out: PickerOption[] = [];
  const seen = new Set<string>();
  for (const l of personalItems ?? []) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ id: l.id, label: `Personal · ${l.name}${l.isDefault ? ' (default)' : ''}` });
  }
  for (const l of firmItems ?? []) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ id: l.id, label: `Firm · ${l.name}${l.isDefault ? ' (default)' : ''}` });
  }
  // Drop the effective-default entry - already represented by the first
  // "Default - <name>" option.
  return out.filter((it) => it.id !== effective?.id);
}
