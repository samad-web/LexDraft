// =============================================================================
// FormIncompleteMessage — how a 422 (incomplete/malformed form) reads on screen.
//
// This is EMPHATICALLY NOT a refusal. The law is not blocking anything; the form
// just isn't finished. So the tone is a helpful checklist ("a few details left"),
// not a legal finding, and the styling is neutral — never the refusal's flag.
// It renders through its OWN component so the two can never be confused.
// =============================================================================

import { Icon } from '@lexdraft/ui';
import type { EngineValidationIssue } from '@/hooks/useEngineDraft';

interface Props {
  issues: EngineValidationIssue[];
  fieldLabels?: Record<string, string>;
  onFocusField?: (field: string) => void;
}

function label(key: string, labels?: Record<string, string>): string {
  if (labels?.[key]) return labels[key]!;
  return key.replace(/\[\d+\]/g, '').replace(/[._]/g, ' ').trim();
}

function verb(code: string): string {
  switch (code) {
    case 'required': return 'still needs a value';
    case 'malformed': return 'isn’t in the expected format';
    case 'type': return 'has the wrong kind of value';
    case 'enum': return 'must be one of the listed options';
    default: return 'needs attention';
  }
}

export function FormIncompleteMessage({ issues, fieldLabels, onFocusField }: Props) {
  return (
    <div className="engine-incomplete" role="status" aria-live="polite">
      <div className="engine-incomplete__head">
        <span className="engine-incomplete__icon" aria-hidden>
          <Icon name="review" size={18} />
        </span>
        <p className="engine-incomplete__lead">
          Almost there — a few details are still needed before this can be drafted.
        </p>
      </div>
      <ul className="engine-incomplete__list">
        {issues.map((iss) => (
          <li key={`${iss.field}:${iss.code}`}>
            <button
              type="button"
              className="engine-incomplete__fieldbtn"
              onClick={() => onFocusField?.(iss.field)}
            >
              {label(iss.field, fieldLabels)}
            </button>{' '}
            {verb(iss.code)}.
          </li>
        ))}
      </ul>
    </div>
  );
}
