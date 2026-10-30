import { useEffect, useState } from 'react';
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
 * an active user immediately. DifAi is Google-only, so the member signs in
 * with the Google account for this email - there is no password to share.
 */
export function CreateMemberModal({ open, onClose, roles, practiceGroups, onCreated }: Props) {
  const create = useCreateFirmUser();
  const showToast = useUIStore((s) => s.showToast);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [practiceGroupId, setPracticeGroupId] = useState('');

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
  };

  const handleClose = () => {
    if (!create.isPending) {
      reset();
      onClose();
    }
  };

  const trimmedEmail = email.trim();
  const emailValid = /^\S+@\S+\.\S+$/.test(trimmedEmail);
  const canSubmit  = emailValid && roleId.length > 0 && !create.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const result = await create.mutateAsync({
        email: trimmedEmail,
        ...(name.trim() ? { name: name.trim() } : {}),
        roleId,
        practiceGroupId: practiceGroupId || undefined,
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
      description="Creates an active account immediately. The member signs in with the Google account for this email. To have them verify their WhatsApp number, send an invite from the Invitations tab instead."
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
          <div className="fm-field-error">
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

    </Modal>
  );
}

// ---------- post-create credentials dialog ----------------------------------

export function CreatedMemberDialog({
  result, onClose,
}: { result: FirmCreateUserResponse | null; onClose: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  if (!result) return null;

  const { user } = result;
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
      description="The account is active. The member signs in with Google using this email."
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
      <div
        className="body-xs muted"
        style={{
          marginTop: 4,
          padding: 12,
          background: 'var(--bg-surface-2)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Ask the member to open <span className="mono">/auth</span> and choose
        <strong> Sign in with Google</strong> with <span className="mono">{user.email}</span>.
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
