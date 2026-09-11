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
  // A TEMP- CNR is an internal placeholder assigned when a case is created without
  // a real eCourts number — it is NOT a filing/registry number and must never be
  // pleaded as the case number (it produced "TEMP-20260908-4049" in the cause-title).
  // Omit it so the document leaves the number blank ("No. __ of 20__") until the
  // court assigns one.
  const realCnr = ctx.cnr && !/^TEMP-/i.test(ctx.cnr.trim()) ? ctx.cnr.trim() : '';
  const lines = [
    `Case: ${ctx.title}`,
    ctx.court ? `Court: ${ctx.court}` : '',
    realCnr ? `CNR / Case No.: ${realCnr}` : 'Case No.: (not yet assigned by the court — leave blank)',
    ctx.client ? `Client (party we represent): ${ctx.client}` : '',
    ctx.type ? `Matter type: ${ctx.type}` : '',
  ].filter(Boolean);
  return `[Authoritative case record — use these particulars verbatim, do not invent]\n${lines.join('\n')}`;
}
