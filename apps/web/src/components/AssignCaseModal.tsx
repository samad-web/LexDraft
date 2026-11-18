import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Select } from '@lexdraft/ui';
import { useCases } from '@/hooks/useCases';
import { useAssignCase } from '@/hooks/useTeamWork';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from './Modal';

/** Team page → Assign case: make a member the lead advocate on a case. They get
 *  a notification (team-work.md). Server checks who may assign. */
export function AssignCaseModal({ open, onClose, member }: { open: boolean; onClose: () => void; member: { id: string; name: string } }) {
  const cases = useCases(undefined, { enabled: open });
  const assign = useAssignCase();
  const showToast = useUIStore((s) => s.showToast);
  const [caseId, setCaseId] = useState('');
  const options = useMemo(
    () => (cases.data ?? []).filter((c) => c.status !== 'Closed').map((c) => ({ value: c.id, label: c.cnr ? `${c.title} · ${c.cnr}` : c.title })),
    [cases.data],
  );
  useEffect(() => { if (open) setCaseId(''); }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!caseId) return;
    try {
      await assign.mutateAsync({ caseId, userId: member.id });
      showToast({ type: 'sage', text: `${member.name} is now the lead on this case` });
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      showToast({ type: 'vermillion', text: msg?.message ?? msg?.error ?? 'Could not assign the case' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Assign work"
      title={`Assign a case to ${member.name}`}
      description="They become the lead advocate on the case and get a notification."
      onSubmit={submit}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!caseId || assign.isPending}>{assign.isPending ? 'Assigning…' : 'Assign case'}</button>
      </>}
    >
      <Field label="CASE" required wide>
        {cases.isLoading ? <span className="body-sm muted">Loading cases…</span>
          : options.length === 0 ? <span className="body-sm muted">No open cases yet. Add a case first.</span>
          : <Select value={caseId} onChange={setCaseId} options={[{ value: '', label: 'Choose a case' }, ...options]} />}
      </Field>
    </Modal>
  );
}
