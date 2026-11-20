import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Select, DatePicker, TimePicker, Combobox } from '@lexdraft/ui';
import type { CalendarHearing } from '@lexdraft/types';
import { useCreateHearing, useUpdateHearing } from '@/hooks/useCalendar';
import { useCases } from '@/hooks/useCases';
import { useCourtJudges, isHighCourt } from '@/hooks/useJudges';
import { useTeammates, useAssignHearing, useHearingAssignee, useIsHead } from '@/hooks/useAssignments';
import { INDIAN_COURTS } from '@/lib/indian-courts';
import { useUIStore } from '@/store/ui';
import { toRemindAt, useCreateReminder } from '@/hooks/useReminders';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional defaults - when added from a case detail page. */
  defaultCase?: string;
  /** The case's actual row id, when known (e.g. opened from a case detail
   *  page). Pins the hearing to this exact case instead of letting the
   *  server re-resolve by title - which can silently attach to the wrong
   *  case when two matters share the same title (newest wins). */
  defaultCaseId?: string;
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
  defaultCaseId,
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
    const list: Array<{ value: string; hint?: string; court?: string; judge?: string; id?: string }> = [];
    for (const c of cases.data ?? []) {
      const title = (c.title ?? '').trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      list.push({ value: title, hint: c.court ?? undefined, court: c.court, judge: c.judge ?? undefined, id: c.id });
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
  const [judgeDirty, setJudgeDirty] = useState(false);

  const [caseLabel, setCaseLabel] = useState(existing?.case ?? defaultCase ?? '');
  // Pins the hearing to an exact case row (see Props.defaultCaseId). Only
  // trustworthy while caseLabel still matches the matter it was seeded for -
  // if the user retypes/picks a different matter we drop it so the server
  // re-resolves by title instead of misattaching to the wrong case.
  const [caseId, setCaseId] = useState<string | undefined>(defaultCaseId);
  const [date, setDate] = useState<string>(existing?.date ?? defaultDate ?? todayIso());
  const [time, setTime] = useState<string>(existing?.time ?? '10:30');
  const [court, setCourt] = useState(existing?.court ?? defaultCourt ?? '');
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [status, setStatus] = useState<Status>((existing?.status as Status) ?? 'upcoming');
  const [judge, setJudge] = useState(existing?.judge ?? '');

  // ASSIGN TO — per-hearing handover. Shown to firm heads (who may assign
  // anyone); ordinary advocates reassign via the matter-level handover on the
  // case page (which supports self-handoff). The server is the final authority.
  const isHead = useIsHead();
  const teammates = useTeammates();
  const assignHearing = useAssignHearing();
  const existingAssignee = useHearingAssignee(isEdit ? existing?.id : undefined);
  const [assigneeId, setAssigneeId] = useState('');
  // Hearings are reminded automatically (3 days before, the evening before,
  // the morning). "Also" adds one more at a time the advocate picks.
  const [remindMode, setRemindMode] = useState<'auto' | 'also'>('auto');
  const [remindDate, setRemindDate] = useState('');
  const [remindTime, setRemindTime] = useState('19:00');
  const [remindTouched, setRemindTouched] = useState(false);
  const createReminder = useCreateReminder();
  const dayBefore = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // The extra reminder follows the hearing date (evening before) until the
  // advocate picks its date themselves.
  useEffect(() => {
    if (remindMode === 'also' && !remindTouched) setRemindDate(dayBefore(date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, remindMode]);
  const teammateOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...(teammates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.role}` })),
    ],
    [teammates.data],
  );

  // BENCH suggestions: once the user picks a High Court, list that court's
  // sitting judges (roster synced into court_judges — see useJudges). District
  // courts / tribunals have no roster, so the field stays free-text.
  const judges = useCourtJudges(court);
  const benchOptions = useMemo(
    () =>
      (judges.data ?? []).map((j) => ({
        value: j.judge_name,
        label: j.is_chief_justice ? `${j.judge_name} (Chief Justice)` : j.judge_name,
      })),
    [judges.data],
  );

  // Re-seed form when the target hearing changes (e.g., user switches which
  // row they're editing without closing the modal in between).
  useEffect(() => {
    if (!open) return;
    setCaseLabel(existing?.case ?? defaultCase ?? '');
    setCaseId(defaultCaseId);
    setDate(existing?.date ?? defaultDate ?? todayIso());
    setTime(existing?.time ?? '10:30');
    setCourt(existing?.court ?? defaultCourt ?? '');
    setPurpose(existing?.purpose ?? '');
    setStatus((existing?.status as Status) ?? 'upcoming');
    setJudge(existing?.judge ?? '');
    setCourtDirty(!!existing?.court || !!defaultCourt);
    setJudgeDirty(false);
    setAssigneeId('');
  }, [open, existing, defaultCase, defaultCaseId, defaultCourt, defaultDate]);

  // Prefill the assignee from the hearing's current assignee (edit mode), once
  // that query resolves.
  useEffect(() => {
    if (open && isEdit) setAssigneeId(existingAssignee.data?.id ?? '');
  }, [open, isEdit, existingAssignee.data]);

  // When the user picks a matter from the suggestions that matches a case in
  // their firm, auto-fill the court + bench (the matter's last-synced presiding
  // judge), each only if the user hasn't already typed into that field.
  const handleMatterChange = (next: string) => {
    setCaseLabel(next);
    const hit = matterOptions.find((m) => m.value === next);
    // Picking/typing a matter other than the one this modal was seeded for
    // invalidates the pinned caseId - let the server re-resolve by title
    // (or pin to the freshly-picked option's own id, when unambiguous).
    setCaseId(hit?.id);
    if (!hit) return;
    if (!courtDirty && hit.court) setCourt(hit.court);
    if (!judgeDirty && hit.judge) setJudge(hit.judge);
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
        caseId,
      };
      let hearingId: string | undefined;
      if (isEdit && existing && existing.id) {
        const updated = await update.mutateAsync({ id: existing.id, ...payload });
        hearingId = updated?.id ?? existing.id;
        showToast({ type: 'sage', text: `Hearing updated` });
      } else {
        const created = await create.mutateAsync(payload);
        hearingId = created?.id;
        showToast({ type: 'sage', text: `Hearing scheduled for ${date}` });
      }
      // Apply the assignment only when a head changed it, so we never clobber
      // an existing assignee or hit the endpoint needlessly.
      if (isHead && hearingId && assigneeId !== (existingAssignee.data?.id ?? '')) {
        try {
          await assignHearing.mutateAsync({ hearingId, userId: assigneeId || null });
        } catch {
          showToast({ type: 'vermillion', text: 'Hearing saved, but assignment failed' });
        }
      }
      if (remindMode === 'also' && remindDate) {
        try {
          await createReminder.mutateAsync({
            caseId: caseId ?? null,
            title: `Hearing: ${caseLabel.trim()}`,
            note: [purpose.trim(), court.trim(), `${date} ${time}`].filter(Boolean).join(' · '),
            remindAt: toRemindAt(remindDate, remindTime),
          });
        } catch (err) {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'reminder not set';
          showToast({ type: 'vermillion', text: `Hearing saved, but ${msg.charAt(0).toLowerCase()}${msg.slice(1)}` });
        }
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
        <Field label="BENCH" hint={isHighCourt(court) ? 'Pick a judge or type' : 'Optional'}>
          <Combobox
            value={judge}
            onChange={(v) => { setJudge(v); setJudgeDirty(true); }}
            options={benchOptions}
            placeholder={
              !isHighCourt(court)
                ? "e.g. Hon'ble Justice Singh"
                : judges.isLoading
                  ? 'Loading judges…'
                  : benchOptions.length > 0
                    ? 'Pick a judge or type a bench'
                    : "e.g. Hon'ble Justice Singh"
            }
            emptyMessage="No match, press Enter to keep what you typed."
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
        <Field label="REMIND ME" hint="Automatic: 3 days before, the evening before, the morning" wide>
          <Select
            value={remindMode}
            onChange={(v) => {
              const m = v as 'auto' | 'also';
              setRemindMode(m);
              if (m === 'also' && !remindDate) setRemindDate(dayBefore(date));
            }}
            options={[
              { value: 'auto', label: 'Automatically' },
              { value: 'also', label: 'Automatically, and also at a time I pick' },
            ]}
          />
        </Field>
        {remindMode === 'also' && (
          <>
            <Field label="REMINDER DATE" required>
              <DatePicker value={remindDate} onChange={(v) => { setRemindTouched(true); setRemindDate(v); }} />
            </Field>
            <Field label="REMINDER TIME" required>
              <TimePicker value={remindTime} onChange={setRemindTime} />
            </Field>
          </>
        )}
        {isHead && (
          <Field label="ASSIGN TO" hint="Hand this hearing to a colleague">
            <Select
              value={assigneeId}
              onChange={setAssigneeId}
              options={teammateOptions}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
