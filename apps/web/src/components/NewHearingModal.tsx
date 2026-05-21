import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Select, DatePicker, TimePicker, Combobox } from '@lexdraft/ui';
import type { CalendarHearing } from '@lexdraft/types';
import { useCreateHearing, useUpdateHearing } from '@/hooks/useCalendar';
import { useCases } from '@/hooks/useCases';
import { INDIAN_COURTS } from '@/lib/indian-courts';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional defaults - when added from a case detail page. */
  defaultCase?: string;
  defaultCourt?: string;
  defaultDate?: string;
  /** When provided, the modal switches to edit mode for this hearing. */
  existing?: CalendarHearing;
}

type Status = 'today' | 'upcoming' | 'past';
const STATUSES: Status[] = ['upcoming', 'today', 'past'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewHearingModal({
  open,
  onClose,
  defaultCase,
  defaultCourt,
  defaultDate,
  existing,
}: Props) {
  const create = useCreateHearing();
  const update = useUpdateHearing();
  const cases = useCases();
  const showToast = useUIStore((s) => s.showToast);
  const isEdit = !!existing;

  // Build matter suggestions from open cases. Hearings reference a case by its
  // title (the server re-resolves to case_id within the firm), so listing each
  // case title once is enough. The court hint lets the picker show context
  // when the user is choosing among similarly-named matters.
  const matterOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ value: string; hint?: string; court?: string }> = [];
    for (const c of cases.data ?? []) {
      const title = (c.title ?? '').trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      list.push({ value: title, hint: c.court ?? undefined, court: c.court });
    }
    return list;
  }, [cases.data]);

  const courtOptions = useMemo(
    () => INDIAN_COURTS.map((c) => ({ value: c })),
    [],
  );

  // Auto-fill the court if the picked matter has one and the user hasn't
  // already typed a court themselves. We track this with a separate state so
  // we never overwrite a deliberate court entry.
  const [courtDirty, setCourtDirty] = useState(false);

  const [caseLabel, setCaseLabel] = useState(existing?.case ?? defaultCase ?? '');
  const [date, setDate] = useState<string>(existing?.date ?? defaultDate ?? todayIso());
  const [time, setTime] = useState<string>(existing?.time ?? '10:30');
  const [court, setCourt] = useState(existing?.court ?? defaultCourt ?? '');
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [status, setStatus] = useState<Status>((existing?.status as Status) ?? 'upcoming');
  const [judge, setJudge] = useState('');

  // Re-seed form when the target hearing changes (e.g., user switches which
  // row they're editing without closing the modal in between).
  useEffect(() => {
    if (!open) return;
    setCaseLabel(existing?.case ?? defaultCase ?? '');
    setDate(existing?.date ?? defaultDate ?? todayIso());
    setTime(existing?.time ?? '10:30');
    setCourt(existing?.court ?? defaultCourt ?? '');
    setPurpose(existing?.purpose ?? '');
    setStatus((existing?.status as Status) ?? 'upcoming');
    setJudge('');
    setCourtDirty(!!existing?.court || !!defaultCourt);
  }, [open, existing, defaultCase, defaultCourt, defaultDate]);

  // When the user picks a matter from the suggestions that matches a case in
  // their firm, auto-fill the court (only if they haven't already typed one).
  const handleMatterChange = (next: string) => {
    setCaseLabel(next);
    if (!courtDirty) {
      const hit = matterOptions.find((m) => m.value === next);
      if (hit?.court) setCourt(hit.court);
    }
  };

  const pending = create.isPending || update.isPending;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        case: caseLabel.trim(),
        time,
        court: court.trim(),
        purpose: purpose.trim(),
        status,
        date,
        judge: judge.trim(),
      };
      if (isEdit && existing && existing.id) {
        await update.mutateAsync({ id: existing.id, ...payload });
        showToast({ type: 'sage', text: `Hearing updated` });
      } else {
        await create.mutateAsync(payload);
        showToast({ type: 'sage', text: `Hearing scheduled for ${date}` });
      }
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? (isEdit ? 'Failed to update hearing' : 'Failed to schedule hearing');
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? 'Edit hearing' : 'Add hearing'}
      title={isEdit ? 'Update this hearing' : 'Schedule a hearing'}
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add hearing'}
          </button>
        </>
      }
    >
      <Field label="MATTER" required wide>
        <Combobox
          value={caseLabel}
          onChange={handleMatterChange}
          options={matterOptions}
          placeholder={
            cases.isLoading
              ? 'Loading your matters…'
              : matterOptions.length > 0
                ? 'Pick a past or open matter, or type a new one'
                : 'e.g. Mehta v. Skyline'
          }
          required
          autoFocus
          emptyMessage={
            cases.isLoading
              ? 'Loading…'
              : 'No match - we’ll create a placeholder matter for this hearing.'
          }
        />
        <span className="body-xs muted" style={{ marginTop: 4 }}>
          Existing clients show up here. Typing a new name creates a placeholder matter you can flesh out later from <em>Cases</em>.
        </span>
      </Field>
      <div className="form-row">
        <Field label="DATE" required>
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="TIME" required>
          <TimePicker value={time} onChange={setTime} />
        </Field>
        <Field label="COURT" required>
          <Combobox
            value={court}
            onChange={(v) => { setCourt(v); setCourtDirty(true); }}
            options={courtOptions}
            placeholder="Start typing or pick from list"
            required
          />
        </Field>
        <Field label="JUDGE" hint="Optional">
          <input
            className="input"
            value={judge}
            onChange={(e) => setJudge(e.target.value)}
            placeholder="e.g. Hon. Justice Singh"
          />
        </Field>
        <Field label="PURPOSE" required wide>
          <input
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Arguments on interim relief"
            required
          />
        </Field>
        <Field label="STATUS" required>
          <Select
            value={status}
            onChange={(v) => setStatus(v as Status)}
            options={STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </Field>
      </div>
    </Modal>
  );
}
