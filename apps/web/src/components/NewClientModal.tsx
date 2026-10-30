import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon, Select, DatePicker } from '@lexdraft/ui';
import type { Case, Client, ClientStatus, ClientType, Lead } from '@lexdraft/types';
import { useClients, useCreateClient, useUpdateClient } from '@/hooks/useClients';
import { useCreateCase } from '@/hooks/useCases';
import { useCreateDocument } from '@/hooks/useDocuments';
import { useLeads } from '@/hooks/useLeads';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { DictateButton } from './DictateButton';
import { FileStager, type StagedFile } from './FileStager';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided the modal renders in edit mode — pre-fills from this row
   *  and calls PATCH /clients/:id instead of POST /clients. */
  existing?: Client | null;
}

const TYPES: ClientType[] = ['Individual', 'Corporate', 'Govt'];
const STATUSES: ClientStatus[] = ['active', 'prospect', 'inactive'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatINR(value: number): string {
  return value.toLocaleString('en-IN');
}

function placeholderCnr(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TEMP-${today}-${rand}`;
}

/** Best-effort document type from a filename so staged uploads get a useful
 *  chip. Mirrors NewCaseModal.inferDocType. */
function inferDocType(filename: string): string {
  const lower = filename.toLowerCase();
  if (/plaint/.test(lower)) return 'Plaint';
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

export function NewClientModal({ open, onClose, existing }: Props) {
  const create = useCreateClient();
  const update = useUpdateClient();
  const createCase = useCreateCase();
  const createDocument = useCreateDocument();
  const showToast = useUIStore((s) => s.showToast);
  const { data: leads = [] } = useLeads();
  const wonLeads = useMemo(() => leads.filter((l) => l.stage === 'won'), [leads]);
  const { data: allClients = [] } = useClients();

  const isEdit = !!existing;
  const [name, setName] = useState('');
  const [type, setType] = useState<ClientType>('Individual');
  const [status, setStatus] = useState<ClientStatus>('active');
  const [lastContact, setLastContact] = useState<string>(todayIso());
  const [email, setEmail] = useState<string>('');

  // Optional "open a case for this client" section. All fields optional; the
  // section only does anything when the advocate expands it and fills something
  // in. On create-only (not edit), it lets the whole client + first matter +
  // its content/files be captured in one flow.
  const [addCase, setAddCase] = useState(false);
  const [caseTitle, setCaseTitle] = useState('');
  const [caseContent, setCaseContent] = useState('');
  const [caseDocs, setCaseDocs] = useState<StagedFile[]>([]);

  const appendSpoken = (
    setter: (fn: (prev: string) => string) => void,
  ) => (text: string) => {
    setter((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
  };

  // Hydrate form from `existing` when the modal opens for edit; clear it
  // back to defaults when opening in create mode.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name);
      setType(existing.type);
      setStatus(existing.status);
      setLastContact(existing.lastContact || todayIso());
      setEmail(existing.email ?? '');
    } else {
      setName('');
      setType('Individual');
      setStatus('active');
      setLastContact(todayIso());
      setEmail('');
    }
    // Always reset the optional-case section when (re)opening.
    setAddCase(false);
    setCaseTitle('');
    setCaseContent('');
    setCaseDocs([]);
  }, [open, existing]);

  const handlePickLead = (lead: Lead) => {
    setName(lead.name);
    setStatus('active');
    setLastContact(lead.capturedAt.slice(0, 10) || todayIso());
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    try {
      if (isEdit && existing) {
        await update.mutateAsync({
          id: existing.id,
          patch: {
            name: name.trim(),
            type,
            status,
            lastContact,
            // Send undefined (not '') so the server preserves the existing
            // email when the field is intentionally cleared — clearing an
            // email requires a separate UI affordance, not the edit form.
            email: trimmedEmail || undefined,
          },
        });
        showToast({ type: 'sage', text: `Client "${name.trim()}" updated` });
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          type,
          status,
          lastContact,
          email: trimmedEmail || undefined,
        });

        // Optionally open a first case for this client, in the same flow. Only
        // runs when the advocate expanded the section AND supplied at least a
        // title, case content, or a document. The case is linked to the client
        // by name (same as everywhere else).
        const wantsCase = addCase && (caseTitle.trim() || caseContent.trim() || caseDocs.length > 0);
        if (wantsCase) {
          const resolvedTitle = caseTitle.trim() || `Matter for ${created.name}`;
          try {
            const newCase = await createCase.mutateAsync({
              cnr: placeholderCnr(),
              title: resolvedTitle,
              client: created.name,
              court: '',
              type: 'Civil',
              stage: 'Filing',
              status: 'Active',
              next: '',
            } as Omit<Case, 'id'>);

            if (caseContent.trim()) {
              try {
                await api.post('/case-notes', {
                  caseId: newCase.id,
                  body: caseContent.trim(),
                  visibility: 'shared',
                  title: 'Case content',
                });
              } catch { /* non-fatal - note can be re-added from the case */ }
            }

            let uploaded = 0;
            const failed: string[] = [];
            for (const doc of caseDocs) {
              try {
                await createDocument.mutateAsync({
                  name: doc.name,
                  type: inferDocType(doc.name),
                  case: newCase.title,
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

            showToast({
              type: failed.length ? 'amber' : 'sage',
              text: failed.length
                ? `Client & case created; ${uploaded} file${uploaded === 1 ? '' : 's'} attached, ${failed.length} failed (${failed.join(', ')}).`
                : `Client "${created.name}" added with a new case${uploaded ? ` and ${uploaded} file${uploaded === 1 ? '' : 's'}` : ''}`,
            });
          } catch {
            // Client is saved; the case failed. Tell the user so they can open
            // it from the client page rather than losing the client entirely.
            showToast({
              type: 'amber',
              text: `Client "${created.name}" added, but the case could not be created. Open one from the client page.`,
            });
          }
        } else {
          showToast({ type: 'sage', text: `Client "${created.name}" added` });
        }
      }
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? (isEdit ? 'Failed to update client' : 'Failed to add client');
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const busy = create.isPending || update.isPending || createCase.isPending || createDocument.isPending;

  // Soft warning only — there's no DB uniqueness constraint on client name
  // (legitimately repeated names, e.g. common surnames, are allowed), so this
  // never blocks submission. It just catches the common case of someone
  // about to create an accidental duplicate instead of finding the existing
  // record, which otherwise silently splits that client's matters/invoices
  // across two rows.
  const trimmedName = name.trim().toLowerCase();
  const duplicateClient = trimmedName
    ? allClients.find((c) => c.id !== existing?.id && c.name.trim().toLowerCase() === trimmedName)
    : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? 'Edit client' : 'New client'}
      title={isEdit ? `Edit ${existing?.name ?? 'client'}` : 'Add a client'}
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy
              ? (isEdit ? 'Saving…' : 'Adding…')
              : isEdit
                ? 'Save changes'
                : addCase && (caseTitle.trim() || caseContent.trim() || caseDocs.length > 0)
                  ? 'Add client & case'
                  : 'Add client'}
          </button>
        </>
      }
    >
      <Field label="CLIENT NAME" required wide>
        {isEdit ? (
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <ClientNameAutocomplete
            value={name}
            onChange={setName}
            wonLeads={wonLeads}
            onPickLead={handlePickLead}
          />
        )}
        {duplicateClient && (
          <p className="cm-form-note" role="status">
            <Icon name="flag" size={12} />
            <span>A client named "{duplicateClient.name}" already exists. Continuing will create a second, separate record.</span>
          </p>
        )}
      </Field>
      <Field
        label="CONTACT EMAIL"
        wide
        hint="Required before the client portal can be enabled for this client."
      >
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. mehta@example.com"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="form-row">
        <Field label="TYPE" required>
          <Select
            value={type}
            onChange={(v) => setType(v as ClientType)}
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="STATUS" required>
          <Select
            value={status}
            onChange={(v) => setStatus(v as ClientStatus)}
            options={STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          />
        </Field>
        <Field label="LAST CONTACT">
          <DatePicker value={lastContact} onChange={setLastContact} />
        </Field>
      </div>

      {/* Optional: open the client's first case in the same flow. Create-mode
          only - editing a client is about the client record, not new matters. */}
      {!isEdit && (
        <div className="cm-addcase">
          {!addCase ? (
            <button
              type="button"
              className="cm-addcase-btn"
              onClick={() => setAddCase(true)}
            >
              <span className="cm-addcase-plus" aria-hidden><Icon name="plus" size={13} /></span>
              <span>
                <strong>Also open a case for this client</strong>
                <span className="cm-hint">Optional: matter title, notes and files in the same step.</span>
              </span>
            </button>
          ) : (
            <div className="cm-addcase-box">
              <div className="cm-addcase-head">
                <div>
                  <div className="cm-addcase-title">New case</div>
                  <div className="cm-hint">Optional. Linked to this client by name.</div>
                </div>
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddCase(false); setCaseTitle(''); setCaseContent(''); setCaseDocs([]); }}>
                  Remove
                </button>
              </div>

              <Field label="MATTER TITLE" wide>
                <input
                  className="input"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  placeholder={`e.g. ${name.trim() || 'Client'} v. Opposing Party`}
                />
              </Field>

              <Field label="CASE CONTENT / NOTES" hint="Type or dictate the matter's facts / background. Saved to the case's Notes." wide>
                <div className="row" style={{ gap: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
                  <DictateButton onTranscript={appendSpoken(setCaseContent)} label="Voice note" />
                </div>
                <textarea
                  className="input"
                  value={caseContent}
                  onChange={(e) => setCaseContent(e.target.value)}
                  placeholder="Facts, client's account, key dates. Tap Voice note and speak instead of typing."
                  rows={4}
                  style={{ resize: 'vertical', minHeight: 90, fontFamily: 'inherit' }}
                  maxLength={50_000}
                />
              </Field>

              <Field label="CASE FILES" hint="Optional: attach the matter's papers; filed against the new case." wide>
                <FileStager
                  files={caseDocs}
                  onChange={setCaseDocs}
                  onError={(msg) => showToast({ type: 'amber', text: msg })}
                />
              </Field>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---- Client name autocomplete ---------------------------------------------
// Free-text input with a popover of won-lead suggestions. Filters as you type;
// picking a suggestion fills name + sets status=active + last-contact from the
// lead's capturedAt. Typing freely (no match) is fully allowed.

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  wonLeads: ReadonlyArray<Lead>;
  onPickLead: (lead: Lead) => void;
}

function ClientNameAutocomplete({ value, onChange, wonLeads, onPickLead }: AutocompleteProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    if (wonLeads.length === 0) return [];
    const q = value.trim().toLowerCase();
    if (!q) return wonLeads.slice(0, 8);
    return wonLeads.filter((l) => l.name.toLowerCase().includes(q)).slice(0, 8);
  }, [value, wonLeads]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (lead: Lead) => {
    onPickLead(lead);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open) {
      const lead = matches[activeIndex];
      if (lead) {
        e.preventDefault();
        choose(lead);
      }
    }
  };

  const showMenu = open && matches.length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="input"
        value={value}
        onChange={(e) => { onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { if (wonLeads.length > 0) setOpen(true); }}
        onKeyDown={handleKey}
        placeholder="e.g. Mehta Enterprises Pvt. Ltd."
        required
        autoFocus
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showMenu}
      />
      {showMenu && (
        <div
          className="select-menu"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            maxHeight: 280,
            overflowY: 'auto',
            zIndex: 60,
          }}
        >
          <div className="cm-suggest-head">From won leads</div>
          {matches.map((lead, i) => {
            const active = i === activeIndex;
            return (
              <div
                key={lead.id}
                role="option"
                aria-selected={active}
                className={`select-option${active ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(lead); }}
                style={{ padding: '8px 12px' }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lead.name}
                </span>
                <span className="cm-suggest-fee">₹{formatINR(lead.valueInr)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
