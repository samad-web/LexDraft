import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon, Select, DatePicker, TimePicker } from '@lexdraft/ui';
import type { DiaryKind } from '@lexdraft/types';
import { useCreateDiaryEntry } from '@/hooks/useDiary';
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewDiaryEntryModal({ open, onClose, defaultKind = 'hearing' }: Props) {
  const create = useCreateDiaryEntry();
  const showToast = useUIStore((s) => s.showToast);

  const [date, setDate] = useState<string>(todayIso());
  const [time, setTime] = useState<string>('10:30');
  const [kind, setKind] = useState<DiaryKind>(defaultKind);
  const [caseLabel, setCaseLabel] = useState('');
  const [cnr, setCnr] = useState('');
  const [detail, setDetail] = useState('');
  const [forum, setForum] = useState('');
  // Judgment-only PDF attachment. Stored on the diary row as base64 (see
  // migration 0051). Cleared when the user switches kind to non-judgment so
  // a stale file doesn't get attached to a hearing/filing row.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfReading, setPdfReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const MAX_BYTES = 12 * 1024 * 1024;

  const reset = () => {
    setDate(todayIso());
    setTime('10:30');
    setKind(defaultKind);
    setCaseLabel('');
    setCnr('');
    setDetail('');
    setForum('');
    setPdfFile(null);
    setPdfBase64(null);
  };

  // The modal stays mounted between openings; resync Kind to the caller's
  // current default whenever the modal opens. Otherwise switching the diary
  // filter to "Judgments" wouldn't influence which Kind the picker starts on.
  useEffect(() => {
    if (open) setKind(defaultKind);
  }, [open, defaultKind]);

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
            onChange={(e) => setCnr(e.target.value)}
            placeholder="e.g. KAHC0100012345/2024"
          />
        </Field>
        <Field label="MATTER" required wide>
          <input
            className="input"
            value={caseLabel}
            onChange={(e) => setCaseLabel(e.target.value)}
            placeholder="e.g. Mehta v. Skyline"
            required
            autoFocus
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
          <input
            className="input"
            value={forum}
            onChange={(e) => setForum(e.target.value)}
            placeholder="e.g. High Court of Karnataka, Court Hall 12"
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
