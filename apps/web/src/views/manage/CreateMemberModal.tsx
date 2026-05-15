import { useEffect, useMemo, useState } from 'react';
import { Select } from '@lexdraft/ui';
import type { FirmCreateUserResponse, PracticeGroup, Role } from '@lexdraft/types';
import { Modal, Field } from '@/components/Modal';
import { useUIStore } from '@/store/ui';
import { useCreateFirmUser } from '@/hooks/useFirmAdmin';

interface Props {
  open: boolean;
  onClose: () => void;
  roles: Role[];
  practiceGroups: PracticeGroup[];
  onCreated: (r: FirmCreateUserResponse) => void;
}

/**
 * Create-and-assign-login flow for a Firm Admin (spec §3.3 alt path).
 *
 * Distinct from the link-based invite (Manage → Invitations tab): this creates
 * an active user immediately with credentials the admin shares out-of-band.
 * The auto-generated password follows the same `${FirstName}@123` pattern as
 * the firm-bootstrap flow.
 */
export function CreateMemberModal({ open, onClose, roles, practiceGroups, onCreated }: Props) {
  const create = useCreateFirmUser();
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [practiceGroupId, setPracticeGroupId] = useState('');
  const [autoPassword, setAutoPassword] = useState(true);
  const [password, setPassword] = useState('');

  // Default role to "Associate" when present, otherwise the first role -
  // spares the admin one click in the common case.
  useEffect(() => {
    if (open && !roleId && roles.length > 0) {
      const associate = roles.find((r) => r.isSystem && r.name === 'Associate');
      const fallback = associate ?? roles[0];
      if (fallback) setRoleId(fallback.id);
    }
  }, [open, roleId, roles]);

  const reset = () => {
    setName('');
    setEmail('');
    setRoleId('');
    setPracticeGroupId('');
    setAutoPassword(true);
    setPassword('');
  };

  const handleClose = () => {
    if (!create.isPending) {
      reset();
      onClose();
    }
  };

  const trimmedEmail = email.trim();
  const emailValid = /^\S+@\S+\.\S+$/.test(trimmedEmail);
  const pwValid    = autoPassword || password.length >= 8;
  const canSubmit  = emailValid && roleId.length > 0 && pwValid && !create.isPending;

  const previewPassword = useMemo(() => {
    if (!autoPassword) return null;
    const sourceName = name.trim()
      || (trimmedEmail.split('@')[0] ?? '')
        .split(/[._-]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
    const firstToken = sourceName.split(/\s+/)[0] ?? '';
    const sanitized  = firstToken.replace(/[^A-Za-z0-9]/g, '');
    const firstName  = sanitized.length > 0
      ? sanitized.charAt(0).toUpperCase() + sanitized.slice(1).toLowerCase()
      : 'User';
    return `${firstName}@123`;
  }, [autoPassword, name, trimmedEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const result = await create.mutateAsync({
        email: trimmedEmail,
        ...(name.trim() ? { name: name.trim() } : {}),
        roleId,
        practiceGroupId: practiceGroupId || undefined,
        ...(autoPassword ? {} : { password }),
      });
      reset();
      onCreated(result);
    } catch (err) {
      showToast({
        type: 'vermillion',
        text: (err as Error)?.message || 'Couldn’t create member',
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      eyebrow="New member"
      title="Add a member with login"
      description="Creates an active account immediately. Use this when you want to set the password yourself; otherwise pick the Invitations tab to send a link instead."
      width={520}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={handleClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {create.isPending ? 'Creating…' : 'Create member'}
          </button>
        </>
      }
    >
      <Field label="EMAIL">
        <input
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="advocate@firm.in"
          autoFocus
          required
        />
        {email && !emailValid && (
          <div className="body-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>
            Enter a valid email address.
          </div>
        )}
      </Field>

      <Field label="FULL NAME (OPTIONAL)">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Aarav Sharma"
        />
        <div className="body-xs muted" style={{ marginTop: 6 }}>
          Falls back to a name derived from the email's local part.
        </div>
      </Field>

      <Field label="ROLE">
        <Select
          value={roleId}
          onChange={setRoleId}
          options={roles.map((r) => ({
            value: r.id,
            label: r.isSystem ? r.name : `${r.name} (custom)`,
          }))}
        />
      </Field>

      {practiceGroups.length > 0 && (
        <Field label="PRACTICE GROUP (OPTIONAL)">
          <Select
            value={practiceGroupId}
            onChange={setPracticeGroupId}
            options={[
              { value: '', label: '- No group -' },
              ...practiceGroups.map((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        </Field>
      )}

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
            {previewPassword && (
              <span className="muted">
                {' · preview: '}
                <span className="mono">{previewPassword}</span>
              </span>
            )}
          </span>
        </label>
        {!autoPassword && (
          <input
            type="text"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            style={{ marginTop: 8 }}
          />
        )}
        {!autoPassword && password.length > 0 && password.length < 8 && (
          <div className="body-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>
            Minimum 8 characters.
          </div>
        )}
      </Field>
    </Modal>
  );
}

// ---------- post-create credentials dialog ----------------------------------

export function CreatedMemberDialog({
  result, onClose,
}: { result: FirmCreateUserResponse | null; onClose: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  if (!result) return null;

  const { user, tempPassword } = result;
  const copy = (value: string, label: string) => {
    void navigator.clipboard?.writeText(value);
    showToast({ type: 'sage', text: `${label} copied` });
  };

  return (
    <Modal
      open={!!result}
      onClose={onClose}
      eyebrow="Member created"
      title={`${user.name} is ready`}
      description={
        tempPassword
          ? 'Share these credentials with the member out-of-band (encrypted email, password manager, in-person). The temporary password is shown only on this screen - ask them to change it on first sign-in.'
          : 'The account is active. Share the password you set with the member separately.'
      }
      width={500}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <CredentialRow label="Name"  value={user.name}  onCopy={() => copy(user.name, 'Name')} />
      <CredentialRow label="Email" value={user.email} onCopy={() => copy(user.email, 'Email')} mono />
      {user.role && <CredentialRow label="Role"  value={user.role.name} onCopy={() => copy(user.role!.name, 'Role')} />}
      {tempPassword ? (
        <CredentialRow
          label="Temporary password"
          value={tempPassword}
          onCopy={() => copy(tempPassword, 'Password')}
          mono
          highlight
        />
      ) : (
        <div className="body-sm muted" style={{ padding: '10px 0' }}>
          Password: <em>set at create time</em> - share it separately.
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
        Ask the member to sign in at <span className="mono">/auth</span> and change
        their password from settings on first login.
      </div>
    </Modal>
  );
}

function CredentialRow({
  label, value, onCopy, mono, highlight,
}: { label: string; value: string; onCopy: () => void; mono?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {label.toUpperCase()}
      </span>
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
          style={{ flex: 1, fontSize: mono ? 14 : 13, userSelect: 'all', wordBreak: 'break-all' }}
        >
          {value}
        </code>
        <button type="button" className="btn btn-sm" onClick={onCopy}>Copy</button>
      </div>
    </div>
  );
}
