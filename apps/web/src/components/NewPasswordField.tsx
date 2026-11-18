import { useState } from 'react';
import { passwordProblem, PASSWORD_RULE } from '@/lib/password';

/** Required strong password for accounts created through Google + WhatsApp
 *  (team invite, co-counsel link). Owner 2026-11-18: every sign-up sets one. */
export function NewPasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [touched, setTouched] = useState(false);
  const problem = touched && value ? passwordProblem(value) : null;
  return (
    <div>
      <label className="label required" htmlFor={id}>
        Password
        <span className="hint">{PASSWORD_RULE}</span>
      </label>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={128}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={!!problem}
        aria-describedby={problem ? `${id}-err` : undefined}
      />
      {problem && <div id={`${id}-err`} role="alert" className="body-xs" style={{ marginTop: 6, fontWeight: 600 }}>{problem}</div>}
    </div>
  );
}
