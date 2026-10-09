import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatePicker, Select } from '@lexdraft/ui';
import type { Case, CaseStage, CaseStatus, CaseType } from '@lexdraft/types';
import { useCreateCase } from '@/hooks/useCases';
import { useCreateDocument } from '@/hooks/useDocuments';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { useConflictsCheck, type ConflictHit, type ConflictsResult } from '@/hooks/useConflicts';
import { useEcourtsCnr } from '@/hooks/useEcourts';
import { Icon } from '@lexdraft/ui';
import { DictateButton } from './DictateButton';
import { FileStager, type StagedFile } from './FileStager';
import { Field } from './Modal';

const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

interface NewCaseModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the type field from the active list filter (e.g. "Civil"). */
  defaultType?: CaseType | string;
  /** Pre-fill from a retained lead: client name, matter title, and type.
   *  Applied when the modal opens so the advocate only confirms court/CNR. */
  prefill?: { client?: string; title?: string; type?: string };
}

const TYPES: CaseType[] = ['Civil', 'Criminal', 'Commercial', 'Property', 'Banking', 'Family', 'Tax', 'Other'];
const STAGES: CaseStage[] = ['Filing', 'Summons', 'WS', 'Evidence', 'Arguments', 'Judgment', 'Appeal', 'Other'];
const STATUSES: CaseStatus[] = ['Active', 'Pending', 'Closed', 'Archived'];

/** Best-effort document type from a filename, so staged uploads land with a
 *  useful chip instead of a bare "Other". Mirrors NewDocumentModal.inferType. */
function inferDocType(filename: string): string {
  const lower = filename.toLowerCase();
  if (/plaint/.test(lower)) return 'Plaint';
  if (/written.statement|\bws\b/.test(lower)) return 'WS';
  if (/affidavit/.test(lower)) return 'Affidavit';
  if (/notice/.test(lower)) return 'Notice';
  if (/contract|agreement|deed/.test(lower)) return 'Contract';
  if (/vakalat/.test(lower)) return 'Vakalatnama';
  if (/petition/.test(lower)) return 'Petition';
  const ext = lower.match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'Word document';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'heic') return 'Scan';
  return 'Other';
}

function placeholderCnr(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TEMP-${today}-${rand}`;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** eCourts party fields arrive numbered and multi-line, e.g.
 *  "1) Thangapandian @ Ajay\n2) Another Party". Take the FIRST party and strip
 *  the leading ordinal ("1)"/"1."), collapsing whitespace — a clean name for a
 *  cause title. Returns '' when the field is blank. */
function cleanParty(raw: string | null | undefined): string {
  const first = (raw ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? '';
  return first.replace(/^\s*\d+\s*[).]\s*/, '').replace(/\s+/g, ' ').trim();
}

/** eCourts returns dates as "dd-mm-yyyy" (or sometimes yyyy-mm-dd). Normalise to
 *  the yyyy-mm-dd the date input expects; return '' if it isn't a parseable date. */
function toIsoDate(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
}

/**
 * Pull the opposing party out of the matter title. Indian filings overwhelmingly
 * use "X v. Y" / "X vs Y" / "X versus Y" - the right-hand-side is the opposing
 * party. We split on the first separator and trim. If no separator is found we
 * return undefined; the conflict-check still runs against the client name.
 */
function deriveOpposingFromTitle(title: string): string | undefined {
  const t = title.trim();
  if (!t) return undefined;
  const sep = /\s+(?:v\.?|vs\.?|versus)\s+/i;
  const parts = t.split(sep);
  if (parts.length < 2) return undefined;
  const rhs = parts.slice(1).join(' ').trim();
  return rhs.length > 0 ? rhs : undefined;
}

export function NewCaseModal({ open, onClose, defaultType, prefill }: NewCaseModalProps) {
  const navigate = useNavigate();
  const create = useCreateCase();
  const createDocument = useCreateDocument();
  const showToast = useUIStore((s) => s.showToast);
  const conflicts = useConflictsCheck();

  // Documents staged in the modal, uploaded after the case is created (the
  // case's title is the label documents file against).
  const [stagedDocs, setStagedDocs] = useState<StagedFile[]>([]);

  // Free-text (or dictated) description of the matter. Saved as a shared case
  // note after the case is created, so it shows in the case's Notes section and
  // AI drafting can pull it in. Optional.
  const [caseContent, setCaseContent] = useState('');

  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [court, setCourt] = useState('');
  const [cnr, setCnr] = useState('');
  const [type, setType] = useState<CaseType | string>(defaultType ?? 'Civil');

  // Apply a lead-retain prefill once, when the modal opens with one. Keyed on
  // `open` so re-opening the plain "New case" button doesn't re-inject stale
  // values, and so the advocate can still edit the fields afterward.
  useEffect(() => {
    if (!open || !prefill) return;
    if (prefill.client) setClient(prefill.client);
    if (prefill.title) setTitle(prefill.title);
    if (prefill.type) setType(prefill.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [stage, setStage] = useState<CaseStage | string>('Filing');
  const [status, setStatus] = useState<CaseStatus>('Active');
  const [next, setNext] = useState<string>(todayPlus(14));

  // ---- eCourts auto-fetch: when the advocate enters a valid 16-char CNR, look
  // the case up on eCourts and pre-fill title / court / next-hearing so they
  // don't retype what the record already has. The hook only fires on a valid CNR
  // shape (built-in debounce), and we auto-apply the result once per CNR — the
  // advocate can still edit every field afterward.
  const cnrValid = CNR_RE.test(cnr.trim());
  const cnrLookup = useEcourtsCnr(cnrValid ? cnr : null);
  const [appliedCnr, setAppliedCnr] = useState<string>('');

  useEffect(() => {
    const h = cnrLookup.data;
    if (!h) return;
    const key = cnr.trim().toUpperCase();
    if (key === appliedCnr) return; // already applied this CNR
    setAppliedCnr(key);

    // eCourts party names come numbered/multi-line ("1) Thangapandian @ Ajay\n
    // 2) ...") — take the first party and strip the "1)" ordinal so the title
    // reads cleanly. A side can also come back blank (data not on record).
    const pet = cleanParty(h.petName || h.pet_name);
    const res = cleanParty(h.resName || h.res_name);
    // Only fill fields the advocate hasn't already typed — never clobber input.
    // Build a "v." title only when BOTH sides are present; otherwise use whichever
    // side we have, so we never produce "Ajay v. " with a dangling blank.
    const derivedTitle =
      pet && res ? `${pet} v. ${res}`
      : pet || res || '';
    if (derivedTitle) setTitle((cur) => cur.trim() ? cur : derivedTitle);
    if (h.court_name) setCourt((cur) => cur.trim() ? cur : h.court_name.trim());
    if (pet) setClient((cur) => cur.trim() ? cur : pet);
    const nd = (h.date_next_list || '').trim();
    // eCourts dates are dd-mm-yyyy; convert to yyyy-mm-dd for the date field.
    const iso = toIsoDate(nd);
    if (iso) setNext((cur) => (cur === todayPlus(14) || !cur ? iso : cur));
    showToast({ type: 'sage', text: 'Case details fetched from eCourts' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnrLookup.data]);

  // Conflict-check state. `lastResult` survives between debounce refires so
  // the panel doesn't flicker to empty during typing.
  const [conflictResult, setConflictResult] = useState<ConflictsResult | null>(null);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [overrideAck, setOverrideAck] = useState(false);

  const opposingDerived = useMemo(() => deriveOpposingFromTitle(title), [title]);

  // Debounce 400ms after the user stops typing in client/title. We send both
  // the typed client (party we represent) and the derived opposing party.
  useEffect(() => {
    if (!open) return undefined;
    const c = client.trim();
    const o = (opposingDerived ?? '').trim();
    if (!c && !o) {
      setConflictResult(null);
      setOverrideAck(false);
      return undefined;
    }
    const handle = window.setTimeout(() => {
      conflicts.mutate(
        {
          partyNames: c ? [c] : [],
          opposingNames: o ? [o] : [],
        },
        {
          onSuccess: (r) => {
            setConflictResult(r);
            // Re-typing resets the override gate so the user can't bypass a
            // fresh red flag by having acked an older one.
            setOverrideAck(false);
            setConflictDismissed(false);
          },
          // Silent failure: don't blow up the form if the feature is gated
          // off or the API hiccups - the lawyer can still file the matter.
          onError: () => setConflictResult(null),
        },
      );
    }, 400);
    return () => window.clearTimeout(handle);
    // We intentionally exclude `conflicts` to avoid re-firing on mutation
    // identity changes; client + opposing changes are what we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, opposingDerived]);

  if (!open) return null;

  const severity = conflictResult?.severity ?? 'green';
  const hasRed = severity === 'red';
  const submitBlocked = hasRed && !overrideAck;

  // Append a dictated transcript to a string field, spaced from existing text.
  const appendSpoken = (
    setter: (fn: (prev: string) => string) => void,
  ) => (text: string) => {
    setter((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitBlocked) return;
    // All fields are optional. Fall back to a readable placeholder title so the
    // matter doesn't show as a blank row in the list.
    const resolvedTitle = title.trim() || (client.trim() ? `Matter for ${client.trim()}` : 'Untitled matter');
    const payload: Omit<Case, 'id'> = {
      cnr: cnr.trim() || placeholderCnr(),
      title: resolvedTitle,
      client: client.trim(),
      court: court.trim(),
      type,
      stage,
      status,
      next,
    };
    try {
      const created = await create.mutateAsync(payload);

      // Save the typed/dictated case content as a shared note on the new matter
      // so it appears in the case's Notes section and AI drafting can use it.
      // Best-effort: a note failure never blocks the case from opening.
      if (caseContent.trim()) {
        try {
          await api.post('/case-notes', {
            caseId: created.id,
            body: caseContent.trim(),
            visibility: 'shared',
            title: 'Case content',
          });
        } catch {
          showToast({ type: 'amber', text: 'Case created, but the case-content note could not be saved. Add it from the Notes section.' });
        }
      }

      // Upload any documents staged in the modal, filing them against the new
      // case's title (the label the documents system relates docs to a case
      // by). Sequential so a mid-run failure is attributable; the case is
      // already created, so a failed upload never loses the matter itself.
      let uploaded = 0;
      const failed: string[] = [];
      for (const doc of stagedDocs) {
        try {
          await createDocument.mutateAsync({
            name: doc.name,
            type: inferDocType(doc.name),
            case: created.title,
            updated: 'just now',
            fileName: doc.name,
            fileMime: doc.mime,
            fileSize: doc.size,
            fileBase64: doc.base64,
          });
          uploaded += 1;
        } catch {
          failed.push(doc.name);
        }
      }

      if (failed.length > 0) {
        showToast({
          type: 'amber',
          text: `Case created. ${uploaded} document${uploaded === 1 ? '' : 's'} attached; ${failed.length} failed (${failed.join(', ')}). Retry from the Documents tab.`,
        });
      } else {
        showToast({
          type: 'sage',
          text: uploaded > 0
            ? `Case "${created.title}" created with ${uploaded} document${uploaded === 1 ? '' : 's'}`
            : `Case "${created.title}" created`,
        });
      }

      setStagedDocs([]);
      setCaseContent('');
      onClose();
      // Land on the Documents tab so the advocate sees the attached papers (or
      // can add more) immediately - the section they'd otherwise hunt for.
      navigate(`/app/cases/${created.id}?tab=documents`);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to create case';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-case-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>New matter</div>
          <h3 id="new-case-title" className="display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Open a case file
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            All fields are optional, fill in what you have. Leave CNR blank to auto-generate a placeholder you can update later.
          </p>
        </div>

        <Field label="MATTER TITLE" wide>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mehta v. Skyline Constructions"
            autoFocus
          />
        </Field>

        <div className="form-row">
          <Field label="CLIENT">
            <input
              className="input"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Primary client (party we represent)"
            />
          </Field>
          <Field label="COURT">
            <input
              className="input"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
              placeholder="e.g. High Court of Karnataka"
            />
          </Field>
          <Field
            label="CNR"
            hint={
              cnrValid && cnrLookup.isFetching ? 'Fetching from eCourts…'
              : cnrValid && cnrLookup.data ? 'Fetched from eCourts ✓'
              : cnrValid && cnrLookup.isError ? 'No eCourts record, enter details manually'
              : 'Optional: enter a 16-char CNR to auto-fetch from eCourts'
            }
          >
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                className="input mono"
                value={cnr}
                onChange={(e) => setCnr(e.target.value)}
                placeholder={placeholderCnr()}
                style={{ paddingRight: 34, width: '100%', boxSizing: 'border-box' }}
              />
              {cnrValid && (
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex' }}
                >
                  {cnrLookup.isFetching
                    ? <span className="blink" style={{ color: 'var(--text-tertiary)' }}>●</span>
                    : cnrLookup.data
                      ? <Icon name="check" size={14} />
                      : cnrLookup.isError
                        ? <Icon name="flag" size={14} />
                        : null}
                </span>
              )}
            </div>
          </Field>
          <Field label="NEXT HEARING" hint="Optional: leave blank if none is fixed yet">
            <DatePicker value={next} onChange={setNext} />
          </Field>
          <Field label="TYPE">
            <Select
              value={String(type)}
              onChange={(v) => setType(v as CaseType)}
              options={TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="STAGE">
            <Select
              value={String(stage)}
              onChange={(v) => setStage(v as CaseStage)}
              options={STAGES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="STATUS">
            <Select
              value={status}
              onChange={(v) => setStatus(v as CaseStatus)}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
        </div>

        <Field label="CASE CONTENT / NOTES" hint="Optional: type or dictate the matter's background, facts, or working notes. Saved to the case's Notes." wide>
          <div className="row" style={{ gap: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
            <DictateButton onTranscript={appendSpoken(setCaseContent)} label="Voice note" />
          </div>
          <textarea
            className="input"
            value={caseContent}
            onChange={(e) => setCaseContent(e.target.value)}
            placeholder="e.g. Facts of the matter, client's account, key dates, working theory. Tap Voice note and speak instead of typing."
            rows={5}
            style={{ resize: 'vertical', minHeight: 100, fontFamily: 'inherit' }}
            maxLength={50_000}
          />
        </Field>

        <Field label="DOCUMENTS" hint="Optional: attach the matter's papers now; they'll be filed against this case." wide>
          <FileStager
            files={stagedDocs}
            onChange={setStagedDocs}
            onError={(msg) => showToast({ type: 'amber', text: msg })}
          />
        </Field>

        <ConflictPanel
          result={conflictResult}
          loading={conflicts.isPending}
          dismissed={conflictDismissed}
          onDismiss={() => setConflictDismissed(true)}
          overrideAck={overrideAck}
          onOverrideChange={setOverrideAck}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn" onClick={() => { setStagedDocs([]); setCaseContent(''); onClose(); }}>Cancel</button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={create.isPending || createDocument.isPending || submitBlocked}
            title={submitBlocked ? 'Confirm conflict review to proceed' : undefined}
          >
            {create.isPending
              ? 'Opening case…'
              : createDocument.isPending
                ? 'Attaching documents…'
                : stagedDocs.length > 0
                  ? `Open case file & attach ${stagedDocs.length}`
                  : 'Open case file'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ConflictPanelProps {
  result: ConflictsResult | null;
  loading: boolean;
  dismissed: boolean;
  onDismiss: () => void;
  overrideAck: boolean;
  onOverrideChange: (v: boolean) => void;
}

/**
 * Surfaces conflict-check output above the submit button. Green is subtle
 * and dismissible - we don't want to congratulate the lawyer on every new
 * matter. Amber + red are sticky.
 */
function ConflictPanel({ result, loading, dismissed, onDismiss, overrideAck, onOverrideChange }: ConflictPanelProps) {
  if (!result && loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          padding: '8px 10px',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        Scanning conflicts…
      </div>
    );
  }
  if (!result) return null;

  if (result.severity === 'green') {
    if (dismissed) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          padding: '8px 10px',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span>No conflicts found across firm matters.</span>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', fontSize: 12, padding: 0,
          }}
          aria-label="Dismiss conflict notice"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const isRed = result.severity === 'red';
  const accent = isRed ? 'var(--danger)' : 'var(--warning)';
  const heading = isRed
    ? 'Existing client / direct conflict detected'
    : 'Potential conflict - name appears in a past matter';

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: accent }}>{heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {result.hits.slice(0, 6).map((h, i) => (
          <li key={hitKey(h, i)}>
            <HitLine hit={h} />
          </li>
        ))}
        {result.hits.length > 6 ? (
          <li style={{ color: 'var(--text-tertiary)' }}>
            + {result.hits.length - 6} more match{result.hits.length - 6 === 1 ? '' : 'es'}…
          </li>
        ) : null}
      </ul>
      {isRed ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={overrideAck}
            onChange={(e) => onOverrideChange(e.target.checked)}
          />
          I have reviewed and proceed anyway
        </label>
      ) : null}
    </div>
  );
}

function hitKey(h: ConflictHit, i: number): string {
  return `${h.classification}-${h.side}-${h.matchedName}-${h.matterId ?? ''}-${h.clientId ?? ''}-${i}`;
}

function HitLine({ hit }: { hit: ConflictHit }) {
  const where = hit.matterTitle
    ? `matter “${hit.matterTitle}”`
    : hit.clientName
      ? `client “${hit.clientName}”`
      : 'firm records';
  const label = (() => {
    switch (hit.classification) {
      case 'existing_client':
        return `“${hit.matchedName}” is an existing client (${where})`;
      case 'same_advocate_other_side':
        return `Firm has previously acted for “${hit.matchedName}” in ${where}`;
      case 'past_matter_party':
      default:
        return `“${hit.matchedName}” appears in ${where}`;
    }
  })();
  return <span>{label}</span>;
}
