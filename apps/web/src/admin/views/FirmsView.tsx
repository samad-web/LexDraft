import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Select, Skeleton } from '@lexdraft/ui';
import type { AdminCreateFirmResponse, FirmPlanTier } from '@lexdraft/types';
import { Modal, Field } from '@/components/Modal';
import { useUIStore } from '@/store/ui';
import { useCreateFirm, useFirms } from '../queries';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

/**
 * Seat ranges per plan tier - mirrors PRICING_AND_TIERS.md §3.1.
 *  - Solo:     1 seat (locked, no team)
 *  - Practice: 2-8 seats (chamber-sized)
 *  - Firm:     9+ seats (defaults to a sensible 12; capped at 500 for sanity)
 */
const SEAT_RULES: Record<FirmPlanTier, { min: number; max: number; default: number; locked: boolean; hint: string }> = {
  Solo:     { min: 1, max: 1,   default: 1,  locked: true,  hint: 'Solo includes one advocate seat.' },
  Practice: { min: 2, max: 8,   default: 8,  locked: false, hint: 'Practice supports two to eight advocates.' },
  Firm:     { min: 9, max: 500, default: 12, locked: false, hint: 'Firm starts at nine seats; raise as needed.' },
};

export function FirmsView() {
  const { data: firms = [], isLoading } = useFirms();
  const [creating, setCreating] = useState(false);
  const [createdResult, setCreatedResult] = useState<AdminCreateFirmResponse | null>(null);
  const pager = usePagination(firms);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Tenants</div>
          <h1 className="display-md">Firms · {firms.length}</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          + Create firm
        </button>
      </header>

      {isLoading ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }} aria-busy="true">
          <table className="tbl">
            <thead>
              <tr>
                <th>Firm</th>
                <th style={{ width: 140 }}>Plan</th>
                <th>Members</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={`sk-${i}`}>
                  <td><Skeleton width={180} height={14} /></td>
                  <td><Skeleton width={70} height={20} radius="pill" /></td>
                  <td><Skeleton width={40} height={13} /></td>
                  <td><Skeleton width={100} height={12} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : firms.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
          <div className="muted" style={{ marginBottom: 12 }}>No firms yet.</div>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Create your first firm
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Firm</th>
                <th style={{ width: 140 }}>Plan</th>
                <th style={{ width: 110, textAlign: 'right' }}>Seats</th>
                <th style={{ width: 100, textAlign: 'right' }}>Matters</th>
                <th style={{ width: 140, textAlign: 'right' }}>MRR</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link to={`/admin/firms/${f.id}`} className="no-underline" style={{ fontWeight: 500 }}>
                      {f.name}
                    </Link>
                    <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{f.id.slice(0, 8)}</div>
                  </td>
                  <td><span className="badge">{f.plan.tier}</span></td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{f.seatsUsed} / {f.seats}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{f.caseCount}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>
                    ₹{f.plan.mrrInr.toLocaleString('en-IN')}
                  </td>
                  <td>
                    <span className={`badge ${f.status === 'active' ? 'badge-sage' : 'badge-vermillion'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/admin/firms/${f.id}`} className="no-underline">Open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
            <Pagination
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              pageSize={pager.pageSize}
              onChange={pager.setPage}
            />
          </div>
        </div>
      )}

      <CreateFirmModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(r) => { setCreating(false); setCreatedResult(r); }}
      />

      <CreatedFirmDialog result={createdResult} onClose={() => setCreatedResult(null)} />
    </div>
  );
}

// ---------- create-firm modal ------------------------------------------------

function CreateFirmModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (r: AdminCreateFirmResponse) => void;
}) {
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<FirmPlanTier>('Solo');
  const [seats, setSeats] = useState<number>(SEAT_RULES.Solo.default);

  // Bootstrap admin (spec §3.1)
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [autoPassword, setAutoPassword] = useState(true);
  const [adminPassword, setAdminPassword] = useState('');

  const create = useCreateFirm();
  const showToast = useUIStore((s) => s.showToast);

  const rules = SEAT_RULES[plan];

  const handlePlanChange = (next: FirmPlanTier) => {
    setPlan(next);
    setSeats(SEAT_RULES[next].default);
  };

  const trimmedName = name.trim();
  const seatsValid = seats >= rules.min && seats <= rules.max;
  const emailValid = /^\S+@\S+\.\S+$/.test(adminEmail.trim());
  const pwValid    = autoPassword || adminPassword.length >= 8;
  const canSubmit  = trimmedName.length > 0 && seatsValid && emailValid && pwValid && !create.isPending;

  const reset = () => {
    setName('');
    setPlan('Solo');
    setSeats(SEAT_RULES.Solo.default);
    setAdminEmail('');
    setAdminName('');
    setAutoPassword(true);
    setAdminPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const result = await create.mutateAsync({
        name: trimmedName,
        plan,
        seats,
        adminEmail: adminEmail.trim().toLowerCase(),
        ...(adminName.trim() ? { adminName: adminName.trim() } : {}),
        ...(autoPassword ? {} : { adminPassword }),
      });
      reset();
      onCreated(result);
    } catch (err) {
      showToast({
        type: 'vermillion',
        text: (err as Error)?.message || 'Couldn’t create firm',
      });
    }
  };

  const handleClose = () => {
    if (!create.isPending) {
      reset();
      onClose();
    }
  };

  const planSummary = useMemo(() => {
    switch (plan) {
      case 'Solo':     return 'Single advocate, self-serve trial.';
      case 'Practice': return 'Founding partner of a 2-8 person chamber.';
      case 'Firm':     return 'Established firm, 9+ seats, sales-led contract.';
    }
  }, [plan]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      eyebrow="New tenant"
      title="Create a firm"
      description="Provision a new tenant. Bootstrap a Firm Admin so the firm has someone to invite the rest of the team - name first, then plan, seats, and admin credentials."
      width={560}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={handleClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {create.isPending ? 'Creating…' : 'Create firm + admin'}
          </button>
        </>
      }
    >
      {/* Step 1 - Firm name */}
      <Field label="FIRM NAME">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sharma & Associates"
          autoFocus
          required
        />
      </Field>

      {/* Step 2 - Plan */}
      <Field label="PLAN">
        <Select
          value={plan}
          onChange={(v) => handlePlanChange(v as FirmPlanTier)}
          options={[
            { value: 'Solo',     label: 'Solo · Independent advocate' },
            { value: 'Practice', label: 'Practice · 2-8 advocates' },
            { value: 'Firm',     label: 'Firm · 9+ advocates (custom)' },
          ]}
        />
        <div className="body-xs muted" style={{ marginTop: 6 }}>
          {planSummary}
        </div>
      </Field>

      {/* Step 3 - Seats */}
      <Field label={`SEATS · ${rules.min}${rules.max === rules.min ? '' : `-${rules.max}`}`}>
        <input
          type="number"
          className="input"
          value={seats}
          min={rules.min}
          max={rules.max}
          disabled={rules.locked}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) setSeats(next);
          }}
        />
        <div className="body-xs muted" style={{ marginTop: 6 }}>
          {rules.hint}
          {!seatsValid && (
            <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
              Allowed: {rules.min}-{rules.max}.
            </span>
          )}
        </div>
      </Field>

      <hr style={{ border: 0, borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />

      {/* Step 4 - Bootstrap admin */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Firm Admin</div>
        <div className="body-xs muted" style={{ marginBottom: 12 }}>
          Required. Every tenant is born with one active Firm Admin who invites everyone else.
        </div>
      </div>

      <Field label="ADMIN EMAIL">
        <input
          type="email"
          className="input"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          placeholder="founder@firm.in"
          required
        />
        {adminEmail && !emailValid && (
          <div className="body-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>
            Enter a valid email address.
          </div>
        )}
      </Field>

      <Field label="ADMIN NAME (OPTIONAL)">
        <input
          className="input"
          value={adminName}
          onChange={(e) => setAdminName(e.target.value)}
          placeholder="e.g. Aarav Sharma"
        />
        <div className="body-xs muted" style={{ marginTop: 6 }}>
          Falls back to a name derived from the email's local part.
        </div>
      </Field>

      <Field label="PASSWORD">
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={autoPassword}
            onChange={(e) => setAutoPassword(e.target.checked)}
          />
          <span className="body-sm">
            Auto-generate as <span className="mono">Name@123</span>
            <span className="muted"> · ask the admin to change it on first sign-in</span>
          </span>
        </label>
        {!autoPassword && (
          <input
            type="text"
            className="input"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            style={{ marginTop: 8 }}
          />
        )}
        {!autoPassword && adminPassword.length > 0 && adminPassword.length < 8 && (
          <div className="body-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>
            Minimum 8 characters.
          </div>
        )}
      </Field>
    </Modal>
  );
}

// ---------- post-create credentials dialog ----------------------------------

function CreatedFirmDialog({
  result, onClose,
}: { result: AdminCreateFirmResponse | null; onClose: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  if (!result) return null;

  const copy = (value: string, label: string) => {
    void navigator.clipboard?.writeText(value);
    showToast({ type: 'sage', text: `${label} copied` });
  };

  return (
    <Modal
      open={!!result}
      onClose={onClose}
      eyebrow="Firm created"
      title={`${result.firm.name} is live`}
      description="Share these credentials with the new Firm Admin out-of-band (encrypted email, password manager). The temporary password is shown only on this screen."
      width={520}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <CredentialRow label="Admin name"  value={result.admin.name}  onCopy={() => copy(result.admin.name, 'Name')} />
      <CredentialRow label="Email"       value={result.admin.email} onCopy={() => copy(result.admin.email, 'Email')} mono />
      {result.admin.tempPassword ? (
        <CredentialRow
          label="Temporary password"
          value={result.admin.tempPassword}
          onCopy={() => copy(result.admin.tempPassword!, 'Password')}
          mono
          highlight
        />
      ) : (
        <div className="body-sm muted" style={{ padding: '10px 0' }}>
          Password: <em>set at create time</em> - share it with the admin separately.
        </div>
      )}
      <div
        className="body-xs muted"
        style={{
          marginTop: 4,
          padding: 12,
          background: 'var(--bg-surface-2)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Ask the admin to sign in at <span className="mono">/auth</span>, change the password from
        their settings, and turn on 2FA before inviting anyone else.
      </div>
    </Modal>
  );
}

function CredentialRow({
  label, value, onCopy, mono, highlight,
}: { label: string; value: string; onCopy: () => void; mono?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px',
          background: highlight ? 'var(--bg-surface)' : 'transparent',
          border: '1px solid ' + (highlight ? 'var(--border-default)' : 'var(--border-subtle)'),
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <code
          className={mono ? 'mono' : undefined}
          style={{
            flex: 1,
            fontSize: mono ? 14 : 13,
            userSelect: 'all',
            wordBreak: 'break-all',
          }}
        >
          {value}
        </code>
        <button type="button" className="btn btn-sm" onClick={onCopy}>Copy</button>
      </div>
    </div>
  );
}
