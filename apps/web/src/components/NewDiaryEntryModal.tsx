import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon, Select, DatePicker, TimePicker, Combobox } from '@lexdraft/ui';
import type { DiaryKind } from '@lexdraft/types';
import { useCreateDiaryEntry } from '@/hooks/useDiary';
import { useCases } from '@/hooks/useCases';
import { useCourtJudges, highCourtFromText } from '@/hooks/useJudges';
import { INDIAN_COURTS } from '@/lib/indian-courts';
import { HearingDayPicker } from './HearingDayPicker';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selects the Kind dropdown when the modal opens. Lets callers open
   *  the modal already in "Judgment" mode so the PDF picker is visible from
   *  the first frame (e.g. when the user is filtered to Judgments and hits
   *  "+ New entry"). */
  defaultKind?: DiaryKind;
}

const KINDS: DiaryKind[] = ['hearing', 'judgment', 'filing'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

// Reminder offsets (days before the next hearing date). 'none' = no reminder.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (≥ 0). The diary reminder is stored as
 *  "days before the hearing", so this converts an absolute reminder day into
 *  that offset. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00`).getTime();
  const b = new Date(`${toIso}T00:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function NewDiaryEntryModal({ open, onClose, defaultKind = 'hearing' }: Props) {
  const create = useCreateDiaryEntry();
  const cases = useCases();
  const showToast = useUIStore((s) => s.showToast);

  const [date, setDate] = useState<string>(todayIso());
  const [time, setTime] = useState<string>('10:30');
  const [kind, setKind] = useState<DiaryKind>(defaultKind);
  const [caseLabel, setCaseLabel] = useState('');
  const [cnr, setCnr] = useState('');
  const [detail, setDetail] = useState('');
  const [forum, setForum] = useState('');
  const [bench, setBench] = useState('');
  const [nextHearingDate, setNextHearingDate] = useState('');
  // Absolute reminder day the advocate picks from the calendar. Stored as an
  // offset (days before the hearing) — see handleSubmit / daysBetween.
  const [reminderDate, setReminderDate] = useState('');
  // When the advocate picks a known matter we auto-fill CNR + forum from the
  // case row — but never clobber a value they've typed themselves.
  const [cnrDirty, setCnrDirty] = useState(false);
  const [forumDirty, setForumDirty] = useState(false);
  const [benchDirty, setBenchDirty] = useState(false);
  // Judgment-only PDF attachment. Stored on the diary row as base64 (see
  // migration 0051). Cleared when the user switches kind to non-judgment so
  // a stale file doesn't get attached to a hearing/filing row.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfReading, setPdfReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_BYTES = 12 * 1024 * 1024;

  // Matter suggestions sourced from the firm's cases. Diary rows reference a
  // matter by its label (caseLabel); listing each title once is enough, and we
  // stash the case court + CNR so picking one pre-fills those fields.
  const matterOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ value: string; hint?: string; court?: string; cnr?: string; judge?: string }> = [];
    for (const c of cases.data ?? []) {
      const title = (c.title ?? '').trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      list.push({
        value: title,
        hint: c.court || undefined,
        court: c.court || undefined,
        cnr: c.cnr || undefined,
        judge: c.judge || undefined,
      });
    }
    return list;
  }, [cases.data]);

  const courtOptions = useMemo(() => INDIAN_COURTS.map((c) => ({ value: c })), []);

  // BENCH suggestions: resolve the free-text FORUM to a High Court and list
  // that court's sitting judges (court_judges roster — see useJudges). When the
  // forum isn't a recognisable High Court, the field stays plain free-text.
  const benchCourt = highCourtFromText(forum);
  const judges = useCourtJudges(benchCourt);
  const benchOptions = useMemo(
    () =>
      (judges.data ?? []).map((j) => ({
        value: j.judge_name,
        label: j.is_chief_justice ? `${j.judge_name} — Chief Justice` : j.judge_name,
      })),
    [judges.data],
  );

  // Picking a known matter fills the CNR + forum (court) + bench (presiding
  // judge) from the case row, unless the advocate has already typed into a
  // field. The bench comes from the matter's last-synced judge (cases.judge).
  const handleMatterChange = (next: string) => {
    setCaseLabel(next);
    const hit = matterOptions.find((m) => m.value === next);
    if (!hit) return;
    if (!forumDirty && hit.court) setForum(hit.court);
    if (!cnrDirty && hit.cnr) setCnr(hit.cnr);
    if (!benchDirty && hit.judge) setBench(hit.judge);
  };

  const reset = () => {
    setDate(todayIso());
    setTime('10:30');
    setKind(defaultKind);
    setCaseLabel('');
    setCnr('');
    setDetail('');
    setForum('');
    setBench('');
    setNextHearingDate('');
    setReminderDate('');
    setPdfFile(null);
    setPdfBase64(null);
    setCnrDirty(false);
    setForumDirty(false);
    setBenchDirty(false);
  };

  // The modal stays mounted between openings; resync Kind to the caller's
  // current default whenever the modal opens. Otherwise switching the diary
  // filter to "Judgments" wouldn't influence which Kind the picker starts on.
  useEffect(() => {
    if (open) setKind(defaultKind);
  }, [open, defaultKind]);

  // Keep the reminder day valid: clear it if the hearing date is removed or the
  // reminder now falls after the hearing.
  useEffect(() => {
    if (reminderDate && (!nextHearingDate || reminderDate > nextHearingDate)) {
      setReminderDate('');
    }
  }, [nextHearingDate, reminderDate]);

  const handleKindChange = (k: DiaryKind) => {
    setKind(k);
    if (k !== 'judgment') {
      setPdfFile(null);
      setPdfBase64(null);
    }
  };

  const handlePdfPicked = (file: File | null) => {
    if (!file) { setPdfFile(null); setPdfBase64(null); return; }
    if (file.type !== 'application/pdf') {
      showToast({ type: 'vermillion', text: 'Only PDF files are supported on judgment entries' });
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast({ type: 'vermillion', text: 'PDF exceeds the 12 MB cap' });
      return;
    }
    setPdfReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      // FileReader.readAsDataURL → "data:application/pdf;base64,<payload>"
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      const b64 = comma >= 0 ? result.slice(comma + 1) : result;
      setPdfFile(file);
      setPdfBase64(b64);
      setPdfReading(false);
    };
    reader.onerror = () => {
      setPdfReading(false);
      showToast({ type: 'vermillion', text: 'Could not read the file' });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const attachment = kind === 'judgment' && pdfFile && pdfBase64
        ? {
            attachmentFileName: pdfFile.name,
            attachmentMime: pdfFile.type,
            attachmentSize: pdfFile.size,
            attachmentBase64: pdfBase64,
          }
        : {};
      await create.mutateAsync({
        date,
        time,
        kind,
        caseLabel: caseLabel.trim(),
        cnr: cnr.trim(),
        detail: detail.trim(),
        forum: forum.trim(),
        bench: bench.trim(),
        nextHearingDate: nextHearingDate || null,
        // Reminder only makes sense against a next hearing date.
        reminderOffsetDays: nextHearingDate && reminderDate ? daysBetween(reminderDate, nextHearingDate) : null,
        ...attachment,
      });
      showToast({ type: 'sage', text: 'Diary entry added' });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to add diary entry';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New diary entry"
      title="Log to court diary"
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add entry'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <Field label="DATE" required>
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="TIME">
          <TimePicker value={time} onChange={setTime} />
        </Field>
        <Field label="KIND" required>
          <Select
            value={kind}
            onChange={(v) => handleKindChange(v as DiaryKind)}
            options={KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))}
          />
        </Field>
        <Field label="CNR" hint="Optional">
          <input
            className="input mono"
            value={cnr}
            onChange={(e) => { setCnr(e.target.value); setCnrDirty(true); }}
            placeholder="e.g. KAHC0100012345/2024"
          />
        </Field>
        <Field label="MATTER" required wide>
          <Combobox
            value={caseLabel}
            onChange={handleMatterChange}
            options={matterOptions}
            placeholder={
              cases.isLoading
                ? 'Loading your matters…'
                : matterOptions.length > 0
                  ? 'Pick a matter, or type a new one'
                  : 'e.g. Mehta v. Skyline'
            }
            required
            autoFocus
            emptyMessage={
              cases.isLoading ? 'Loading…' : 'No match — type to log against a new matter.'
            }
          />
        </Field>
        <Field label="DETAIL" wide>
          <textarea
            className="input"
            rows={3}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Short note about the entry"
          />
        </Field>
        <Field label="FORUM" wide>
          <Combobox
            value={forum}
            onChange={(v) => { setForum(v); setForumDirty(true); }}
            options={courtOptions}
            placeholder="Pick a court or type, e.g. High Court of Karnataka, Court Hall 12"
            emptyMessage="No match — press Enter to keep what you typed."
          />
        </Field>
        <Field label="BENCH" wide hint={benchCourt ? 'Pick a judge or type' : 'Optional'}>
          <Combobox
            value={bench}
            onChange={(v) => { setBench(v); setBenchDirty(true); }}
            options={benchOptions}
            placeholder={
              !benchCourt
                ? "e.g. Hon'ble Justice S. Singh"
                : judges.isLoading
                  ? 'Loading judges…'
                  : benchOptions.length > 0
                    ? `Pick a ${benchCourt.replace(' High Court', '')} judge or type`
                    : "e.g. Hon'ble Justice S. Singh"
            }
            emptyMessage="No match — press Enter to keep what you typed."
          />
        </Field>
        <Field label="NEXT HEARING" hint="Optional">
          <DatePicker value={nextHearingDate} onChange={setNextHearingDate} min={todayIso()} />
        </Field>
        <Field
          label="REMIND ME"
          hint="Optional"
          help={
            nextHearingDate
              ? `Next hearing ${formatDate(nextHearingDate)} · best prep day picked — adjust if needed`
              : 'Set a next hearing date first'
          }
        >
          <HearingDayPicker
            value={reminderDate}
            onChange={setReminderDate}
            min={todayIso()}
            max={nextHearingDate || undefined}
            disabled={!nextHearingDate}
            placeholder="Pick a reminder day"
          />
        </Field>
        {kind === 'judgment' && (
          <Field label="JUDGMENT PDF" hint="Optional · max 12 MB" wide>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => handlePdfPicked(e.target.files?.[0] ?? null)}
            />
            {pdfFile ? (
              <div
                className="row"
                style={{
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 12px',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface)',
                }}
              >
                <Icon name="file" size={14} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pdfFile.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                    {(pdfFile.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handlePdfPicked(null)}
                  title="Remove attachment"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={pdfReading}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                <Icon name="upload" size={14} />
                {pdfReading ? 'Reading…' : 'Attach judgment PDF'}
              </button>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}
