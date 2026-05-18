import type { ReactNode } from 'react';

// Inline error helper rendered under a form field. Pair with
// aria-invalid + aria-describedby on the input so screen readers
// announce the message. Use a stable `id` per field and pass the
// same id as aria-describedby on the matching input.
//
// Renders nothing when `error` is falsy so the parent layout stays
// stable across valid/invalid transitions (no jitter on first blur).

export interface FieldErrorProps {
  id?: string;
  error?: ReactNode | null | false;
}

export function FieldError({ id, error }: FieldErrorProps) {
  if (!error) return null;
  return (
    <div
      id={id}
      role="alert"
      style={{
        marginTop: 6,
        fontSize: 12,
        color: 'var(--danger)',
        lineHeight: 1.4,
      }}
    >
      {error}
    </div>
  );
}

/** Tiny pure helpers for the most common validations. */
export const validators = {
  email(value: string): string | null {
    const v = value.trim();
    if (!v) return null;
    // Pragmatic check, not RFC-perfect. Catches typos, not adversaries.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
    return null;
  },
  required(value: string | number | null | undefined, label = 'This field'): string | null {
    if (value === null || value === undefined) return `${label} is required.`;
    if (typeof value === 'string' && !value.trim()) return `${label} is required.`;
    return null;
  },
  positiveAmount(value: number | string): string | null {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) return 'Enter a valid number.';
    if (n <= 0) return 'Amount must be greater than zero.';
    return null;
  },
  minLength(value: string, min: number, label = 'This field'): string | null {
    if (!value) return null;
    if (value.length < min) return `${label} must be at least ${min} characters.`;
    return null;
  },
};
