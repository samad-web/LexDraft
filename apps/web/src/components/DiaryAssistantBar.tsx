import { useState, type FormEvent } from 'react';
import { Icon, Select, DatePicker, TimePicker } from '@lexdraft/ui';
import type { DiaryAssistantProposal, DiaryEntryDraft, DiaryKind } from '@lexdraft/types';
import { useParseCommand } from '@/hooks/useDiaryAssistant';
import { useCreateDiaryEntry } from '@/hooks/useDiary';
import { useCreateHearing } from '@/hooks/useCalendar';
import { useDictation } from '@/hooks/useDictation';
import { useUIStore } from '@/store/ui';

interface Props {
  /** Fired when the parsed command is a briefing question, so the parent can
   *  open/refresh the briefing card for the requested range. */
  onBriefing: (range: 'today' | 'week') => void;
}

const KINDS: DiaryKind[] = ['hearing', 'judgment', 'filing'];

function todayIso(): string {
  // Local calendar day, to match the server's diary-assistant clock.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function deriveStatus(date: string): 'today' | 'upcoming' | 'past' {
  const today = todayIso();
  if (!date || date === today) return date === today ? 'today' : 'upcoming';
  return date > today ? 'upcoming' : 'past';
}

export function DiaryAssistantBar({ onBriefing }: Props) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<DiaryAssistantProposal | null>(null);
  const [draft, setDraft] = useState<DiaryEntryDraft | null>(null);
  const [alsoCalendar, setAlsoCalendar] = useState(false);

  const parse = useParseCommand();
  const createEntry = useCreateDiaryEntry();
  const createHearing = useCreateHearing();
  const dictation = useDictation();
  const showToast = useUIStore((s) => s.showToast);

  // The "Also add to Calendar" option is offered only while the (editable) entry
  // is still a hearing — reclassifying it to judgment/filing hides it so we never
  // push a non-hearing entry onto the Calendar.
  const canCalendar = proposal?.intent === 'create_hearing' && draft?.kind === 'hearing';

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || parse.isPending) return;
    try {
      const result = await parse.mutateAsync(value);
      if (result.intent === 'briefing_query') {
        onBriefing(result.briefingRange ?? 'today');
        setText('');
        setProposal(null);
        setDraft(null);
        return;
      }
      if (result.intent === 'unknown' || !result.diaryEntry) {
        showToast({ type: 'amber', text: result.message || "I couldn't read that as a diary action." });
        return;
      }
      setProposal(result);
      setDraft(result.diaryEntry);
      setAlsoCalendar(result.intent === 'create_hearing');
    } catch {
      showToast({ type: 'vermillion', text: 'Could not reach the assistant. Try again.' });
    }
  };

  const discard = () => {
    setProposal(null);
    setDraft(null);
  };

  const confirm = async () => {
    if (!draft) return;
    const caseLabel = draft.caseLabel.trim();
    if (!caseLabel) {
      showToast({ type: 'amber', text: 'Add a matter name before logging.' });
      return;
    }

    const effDate = draft.date || todayIso();
    const forum = draft.forum.trim();
    const detail = draft.detail.trim();

    // Step 1 — the diary entry (the primary write). If this fails the card stays
    // open so the user can retry safely (nothing was written).
    try {
      await createEntry.mutateAsync({
        date: effDate,
        time: draft.time,
        kind: draft.kind,
        caseLabel,
        cnr: draft.cnr.trim(),
        detail,
        forum,
      });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error)?.message ??
        'Failed to log entry';
      showToast({ type: 'vermillion', text: msg });
      return;
    }

    // Diary write succeeded — close the card NOW so a second Confirm can't
    // duplicate it. The optional Calendar push is a separate, best-effort step.
    setText('');
    discard();

    // Step 2 — optional Calendar push. POST /hearings requires a non-empty time
    // and court, so only push when both are present; otherwise log the diary
    // entry and tell the user how to also schedule it.
    if (canCalendar && alsoCalendar) {
      if (!draft.time.trim() || !forum) {
        showToast({ type: 'sage', text: 'Logged to diary. Add a time & court to also put it on the Calendar.' });
        return;
      }
      try {
        await createHearing.mutateAsync({
          case: caseLabel,
          time: draft.time,
          court: forum,
          purpose: detail || 'Hearing',
          status: deriveStatus(effDate),
          date: effDate,
          judge: '',
        });
        showToast({ type: 'sage', text: 'Logged to diary + added to Calendar' });
      } catch {
        showToast({ type: 'amber', text: 'Logged to diary, but couldn’t add it to the Calendar — add it there manually.' });
      }
      return;
    }

    showToast({ type: 'sage', text: 'Logged to diary' });
  };

  const dictate = () =>
    dictation.toggle((t) => setText((prev) => (prev ? `${prev} ${t}` : t)));

  const patch = (p: Partial<DiaryEntryDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <form className="row" style={{ gap: 8, alignItems: 'center' }} onSubmit={submit}>
        <span
          aria-hidden
          style={{ display: 'inline-flex', color: 'var(--accent, var(--text-secondary))' }}
        >
          <Icon name="chat" size={16} />
        </span>
        <input
          className="input"
          style={{ flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Tell the assistant… e.g. "log Mehta v. Skyline hearing tomorrow 11am at HC Karnataka, arguments" or "what’s on this week?"'
          aria-label="Diary assistant command"
        />
        {dictation.supported && (
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${dictation.listening ? 'active' : ''}`}
            onClick={dictate}
            title={dictation.listening ? 'Stop dictation' : 'Dictate'}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
            aria-pressed={dictation.listening}
          >
            <Icon name={dictation.listening ? 'micOff' : 'mic'} size={14} />
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={parse.isPending || !text.trim()}>
          {parse.isPending ? 'Reading…' : 'Ask'}
        </button>
      </form>

      {proposal && draft && (
        <div
          className="col"
          style={{
            gap: 12,
            padding: 'var(--space-4)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-2)',
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="badge badge-cobalt">Proposed</span>
            <span className="body-sm" style={{ color: 'var(--text-secondary)' }}>{proposal.confirmation}</span>
          </div>

          <div className="form-row">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>MATTER *</span>
              <input
                className="input"
                value={draft.caseLabel}
                onChange={(e) => patch({ caseLabel: e.target.value })}
                placeholder="e.g. Mehta v. Skyline"
                autoFocus
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>DATE</span>
              <DatePicker value={draft.date} onChange={(v) => patch({ date: v })} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>TIME</span>
              <TimePicker value={draft.time} onChange={(v) => patch({ time: v })} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>KIND</span>
              <Select
                value={draft.kind}
                onChange={(v) => patch({ kind: v as DiaryKind })}
                options={KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>CNR</span>
              <input className="input mono" value={draft.cnr} onChange={(e) => patch({ cnr: e.target.value })} placeholder="optional" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>FORUM</span>
              <input className="input" value={draft.forum} onChange={(e) => patch({ forum: e.target.value })} placeholder="e.g. High Court of Karnataka, Court Hall 12" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>DETAIL</span>
              <input className="input" value={draft.detail} onChange={(e) => patch({ detail: e.target.value })} placeholder="Short note / purpose" />
            </label>
          </div>

          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {canCalendar && (
              <label className="row" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={alsoCalendar} onChange={(e) => setAlsoCalendar(e.target.checked)} />
                <span className="body-sm">Also add to Calendar</span>
              </label>
            )}
            <span className="spacer" style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={discard}>Discard</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={confirm}
              disabled={createEntry.isPending || createHearing.isPending}
            >
              <Icon name="check" size={13} /> {createEntry.isPending || createHearing.isPending ? 'Saving…' : 'Confirm & log'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
