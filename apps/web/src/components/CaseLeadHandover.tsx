import { useMemo } from 'react';
import { Select } from '@lexdraft/ui';
import {
  useCaseLead, useTeammates, useSetCaseLead, useIsHead, useCurrentUserId,
} from '@/hooks/useAssignments';
import { useUIStore } from '@/store/ui';

// =============================================================================
// CaseLeadHandover — shows the matter's lead advocate and lets an authorised
// user hand it over. A firm head can assign anyone; the current lead can hand
// off their own matter (self-handoff). Everyone else sees it read-only.
// The server re-checks authority, so this only governs what's shown.
// =============================================================================

export function CaseLeadHandover({ caseId }: { caseId: string }) {
  const lead = useCaseLead(caseId);
  const teammates = useTeammates();
  const setLead = useSetCaseLead(caseId);
  const isHead = useIsHead();
  const meId = useCurrentUserId();
  const showToast = useUIStore((s) => s.showToast);

  const currentLeadId = lead.data?.id ?? null;
  const canEdit = isHead || (!!currentLeadId && currentLeadId === meId);

  const options = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...(teammates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.role}` })),
    ],
    [teammates.data],
  );

  const onChange = async (userId: string) => {
    if (!userId || userId === currentLeadId) return;
    try {
      const picked = teammates.data?.find((t) => t.id === userId);
      await setLead.mutateAsync(userId);
      showToast({ type: 'sage', text: `Matter handed to ${picked?.name ?? 'colleague'}` });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Could not reassign this matter';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Assignment</div>
      <h2 className="heading-md" style={{ marginBottom: 12 }}>Lead advocate</h2>
      {canEdit ? (
        <>
          <Select
            value={currentLeadId ?? ''}
            onChange={onChange}
            options={options}
            disabled={setLead.isPending || teammates.isLoading}
          />
          <p className="body-xs muted" style={{ marginTop: 8 }}>
            {isHead
              ? 'As a firm head you can hand this matter to anyone.'
              : 'You can hand off your own matter to a colleague.'}
          </p>
        </>
      ) : (
        <p className="body-sm" style={{ margin: 0 }}>
          {lead.data ? `${lead.data.name} · ${lead.data.role}` : 'Unassigned'}
        </p>
      )}
    </div>
  );
}
