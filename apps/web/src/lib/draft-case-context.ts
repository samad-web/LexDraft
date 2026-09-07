// Case → drafting-brief context helpers. Kept separate from the DraftCasePicker
// component so the component file exports only a component (Fast Refresh stays
// happy) and so these pure functions are unit-testable.
import type { Case } from '@lexdraft/types';

/** The context a selected case contributes to the drafting brief. */
export interface DraftCaseContext {
  id: string;
  title: string;
  court: string;
  cnr: string;
  client: string;
  type: string;
}

export function caseToContext(c: Case): DraftCaseContext {
  return {
    id: c.id,
    title: c.title,
    court: c.court,
    cnr: c.cnr,
    client: c.client,
    type: typeof c.type === 'string' ? c.type : String(c.type),
  };
}

/** Render a case context as a compact fact block the agent reads verbatim. */
export function contextToBriefPreamble(ctx: DraftCaseContext): string {
  const lines = [
    `Case: ${ctx.title}`,
    ctx.court ? `Court: ${ctx.court}` : '',
    ctx.cnr ? `CNR / Case No.: ${ctx.cnr}` : '',
    ctx.client ? `Client (party we represent): ${ctx.client}` : '',
    ctx.type ? `Matter type: ${ctx.type}` : '',
  ].filter(Boolean);
  return `[Authoritative case record — use these particulars verbatim, do not invent]\n${lines.join('\n')}`;
}
