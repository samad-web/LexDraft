/**
 * Engagement-letter DTOs — kept LOCAL to the api package on purpose. The
 * orchestrator will promote/unify these into `@lexdraft/types` once the
 * Firm-tier feature ships to the web client; until then, treat this as the
 * API's provisional contract.
 *
 * Templates live per-firm and are keyed by `matterType`. The generator
 * resolves a template (either explicit by id, or the firm's default for the
 * matter's type) and interpolates a fixed set of `{{placeholder}}` tokens
 * pulled from the case, client, firm, and a few computed values (today's
 * date, formatted retainer). See `engagement.service.ts#generate`.
 */

export interface EngagementTemplate {
  id: string;
  firmId: string;
  matterType: string;
  scopeClauses: string;
  feeClauses: string;
  retainerInr: number | null;
  notes: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface CreateEngagementTemplateRequest {
  matterType: string;
  scopeClauses: string;
  feeClauses: string;
  retainerInr?: number | null;
  notes?: string | null;
  isDefault?: boolean;
}

export type UpdateEngagementTemplateRequest = Partial<CreateEngagementTemplateRequest>;

export interface EngagementTemplateGroup {
  matterType: string;
  templates: EngagementTemplate[];
}

export interface ListEngagementTemplatesResponse {
  /** Flat list of all templates owned by the firm. */
  items: EngagementTemplate[];
  /** Same templates, bucketed by matter type for convenient UI rendering. */
  groups: EngagementTemplateGroup[];
}

export interface GenerateEngagementLetterRequest {
  caseId: string;
  /** Optional explicit template selection. Falls back to the firm's default
   *  for the case's matter type when omitted. */
  templateId?: string;
}

export interface GenerateEngagementLetterResponse {
  text: string;
  generatedAt: string;
  /** Which template was actually used — surfaced so the UI can label the
   *  preview ("from default template" vs "from <picked>"). */
  templateId: string;
  matterType: string;
}
