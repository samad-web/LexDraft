import type { IntakeState } from '@lexdraft/types';

/** Says plainly when a draft had no verified format behind it. */
export function OpenDraftNote({ state }: { state: Pick<IntakeState, 'draftedBy'> }) {
  if (state.draftedBy !== 'open') return null;
  return (
    <p className="body-xs" role="note" style={{ margin: '8px 0', fontWeight: 600 }}>
      Drafted by AI without a verified DifAi format. Please check it carefully before use. To use your own format, attach it in the chat with “Use as format”.
    </p>
  );
}
