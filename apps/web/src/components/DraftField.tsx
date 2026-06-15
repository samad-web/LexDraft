import type { ChangeEvent } from 'react';
import { Select, DatePicker } from '@lexdraft/ui';
import type { DocField } from '@/lib/doc-schemas';

export interface FieldProps {
  field: DocField;
  value: string;
  onChange: (v: string) => void;
}

/**
 * Renders one drafting field by its schema type (text / textarea / select /
 * date / number / currency). Shared by the brief form and the post-generation
 * "complete the missing fields" panel.
 */
export function Field({ field, value, onChange }: FieldProps) {
  const { label, type, placeholder, options, required, optional, rows } = field;
  const labelEl = (
    <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span>{label}</span>
      {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      {optional && (
        <span
          className="mono"
          style={{
            fontSize: 9,
            color: 'var(--text-tertiary)',
            opacity: 0.85,
            fontWeight: 400,
          }}
        >
          OPTIONAL
        </span>
      )}
    </label>
  );

  if (type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          className="input"
          rows={rows ?? 3}
          value={value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    );
  }
  if (type === 'select') {
    return (
      <div>
        {labelEl}
        <Select
          value={value}
          onChange={onChange}
          placeholder="- Select -"
          options={[
            { value: '', label: '- Select -' },
            ...(options ?? []).map((o) => ({ value: o, label: o })),
          ]}
        />
      </div>
    );
  }
  if (type === 'date') {
    return (
      <div>
        {labelEl}
        <DatePicker value={value} onChange={onChange} />
      </div>
    );
  }
  if (type === 'number') {
    return (
      <div>
        {labelEl}
        <input
          type="number"
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    );
  }
  if (type === 'currency') {
    return (
      <div>
        {labelEl}
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            ₹
          </span>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={placeholder}
            style={{ paddingLeft: 28 }}
          />
        </div>
      </div>
    );
  }
  return (
    <div>
      {labelEl}
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
