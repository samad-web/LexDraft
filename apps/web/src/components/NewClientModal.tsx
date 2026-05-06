import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Select, DatePicker } from '@lexdraft/ui';
import type { ClientStatus, ClientType, Lead } from '@lexdraft/types';
import { useCreateClient } from '@/hooks/useClients';
import { useLeads } from '@/hooks/useLeads';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPES: ClientType[] = ['Individual', 'Corporate', 'Govt'];
const STATUSES: ClientStatus[] = ['active', 'prospect', 'inactive'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatINR(value: number): string {
  return value.toLocaleString('en-IN');
}

export function NewClientModal({ open, onClose }: Props) {
  const create = useCreateClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data: leads = [] } = useLeads();
  const wonLeads = useMemo(() => leads.filter((l) => l.stage === 'won'), [leads]);

  const [name, setName] = useState('');
  const [type, setType] = useState<ClientType>('Individual');
  const [status, setStatus] = useState<ClientStatus>('active');
  const [lastContact, setLastContact] = useState<string>(todayIso());

  const reset = () => {
    setName('');
    setType('Individual');
    setStatus('active');
    setLastContact(todayIso());
  };

  const handlePickLead = (lead: Lead) => {
    setName(lead.name);
    setStatus('active');
    setLastContact(lead.capturedAt.slice(0, 10) || todayIso());
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        type,
        status,
        lastContact,
      });
      showToast({ type: 'sage', text: `Client "${created.name}" added` });
      reset();
      onClose();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Failed to add client';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New client"
      title="Add a client"
      description="Required fields marked with *."
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add client'}
          </button>
        </>
      }
    >
      <Field label="CLIENT NAME *" wide>
        <ClientNameAutocomplete
          value={name}
          onChange={setName}
          wonLeads={wonLeads}
          onPickLead={handlePickLead}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="TYPE *">
          <Select
            value={type}
            onChange={(v) => setType(v as ClientType)}
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="STATUS *">
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
          <div
            className="mono"
            style={{
              padding: '6px 12px',
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--text-tertiary)',
              borderBottom: '1px solid var(--border-subtle)',
              textTransform: 'uppercase',
            }}
          >
            From won leads
          </div>
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
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                  ₹{formatINR(lead.valueInr)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
