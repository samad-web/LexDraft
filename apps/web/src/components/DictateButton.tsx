import { Icon } from '@lexdraft/ui';
import { useDictation } from '@/hooks/useDictation';

// =============================================================================
// DictateButton - small mic toggle that speaks into a text field.
//
// Shared across the new-client and new-case forms (and anywhere a free-text
// field benefits from voice entry). Each final transcript is passed to
// onTranscript; the caller decides whether to append or replace. Hidden
// entirely on browsers without the Web Speech API so there's never a dead
// control. `mode='append'` (the default) is best for notes; `mode='replace'`
// suits short single-value fields like a name.
// =============================================================================

interface DictateButtonProps {
  /** Fires with the final transcript text. */
  onTranscript: (text: string) => void;
  /** Optional label; defaults to "Dictate". */
  label?: string;
  /** Small by default so it sits inline next to a field label. */
  size?: 'sm' | 'md';
}

export function DictateButton({ onTranscript, label = 'Dictate', size = 'sm' }: DictateButtonProps) {
  const dictation = useDictation();
  if (!dictation.supported) return null;

  return (
    <button
      type="button"
      className={`btn ${size === 'sm' ? 'btn-sm' : ''}${dictation.listening ? ' btn-primary' : ''}`}
      onClick={() => dictation.toggle(onTranscript)}
      aria-pressed={dictation.listening}
      title={dictation.listening ? 'Stop dictation' : `${label} (voice input)`}
      style={{ flexShrink: 0 }}
    >
      <Icon name="mic" size={12} />
      {dictation.listening ? 'Listening… tap to stop' : label}
    </button>
  );
}
