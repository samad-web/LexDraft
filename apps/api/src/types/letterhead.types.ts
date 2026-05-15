/**
 * Letterhead DTOs - kept LOCAL to the api package on purpose. The web
 * client mirrors these in `apps/web/src/hooks/useLetterheads.ts` until
 * the feature stabilises and we promote a unified set into `@lexdraft/types`.
 *
 * Editor model: template-with-slots. The user picks one of a small fixed
 * set of `template_key`s (defined client-side, see `LETTERHEAD_TEMPLATES`
 * in the web app) and the slot values land in `fields`. The server doesn't
 * interpret either - it just stores and returns them; the rendering happens
 * client-side at export time.
 */

/** Identifies one of the predefined letterhead layouts. The catalog lives
 *  on the client; the server stores the key opaquely so new templates can
 *  ship without an API change. */
export type LetterheadTemplateKey =
  | 'classic-centered'
  | 'logo-left'
  | 'minimalist'
  | 'two-column'
  | 'court-filing'
  | 'modern-accent';

/** Slot values consumed by the templates. Each template uses a subset -
 *  unused fields are left blank and ignored by that template's renderer. */
export interface LetterheadFields {
  firmName?: string;
  tagline?: string;
  /** Multi-line address. Stored as an array so the renderer doesn't have
   *  to split on newlines (which mangle Indian addresses with embedded
   *  commas). */
  addressLines?: string[];
  phone?: string;
  email?: string;
  website?: string;
  /** Bar Council / Court registration number, e.g. "Bar Council of Karnataka
   *  Enrolment No. KAR/1234/2018". */
  regNumber?: string;
  /** Optional bottom-of-letterhead footer line. */
  footerText?: string;
  /** Hex colour for templates that use a coloured accent rule. Defaults to
   *  the document's primary text colour when omitted. */
  accentColor?: string;
}

export interface Letterhead {
  id: string;
  firmId: string;
  /** Null for firm-scoped designs (visible to every firm member); set for
   *  personal designs (visible only to the owner). */
  ownerUserId: string | null;
  name: string;
  templateKey: LetterheadTemplateKey;
  fields: LetterheadFields;
  /** Storage key for the logo image. Null if the design has no logo. The
   *  client resolves this to a presigned GET URL on demand. */
  logoKey: string | null;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLetterheadRequest {
  /** Set explicitly: 'firm' = firm-scoped, 'personal' = owned by caller.
   *  Server enforces firm-scope permissions; personal always allowed. */
  scope: 'firm' | 'personal';
  name: string;
  templateKey: LetterheadTemplateKey;
  fields: LetterheadFields;
  logoKey?: string | null;
  /** When true, the new design is promoted to the default for its scope
   *  (firm-wide if scope=firm, personal if scope=personal). Any existing
   *  default in that scope is demoted in the same transaction. */
  isDefault?: boolean;
}

export interface UpdateLetterheadRequest {
  name?: string;
  templateKey?: LetterheadTemplateKey;
  fields?: LetterheadFields;
  /** Pass `null` to clear the logo. Omit to leave it unchanged. */
  logoKey?: string | null;
  isDefault?: boolean;
}

export interface ListLetterheadsResponse {
  /** Firm-scoped designs visible to the caller. */
  firmItems: Letterhead[];
  /** The caller's personal designs. */
  personalItems: Letterhead[];
  /** Convenience: the caller's effective default (personal default if any,
   *  else firm default, else null). What the exporter auto-applies. */
  effectiveDefault: Letterhead | null;
}

/** Response from POST /api/letterheads/logo-upload-url - same shape the
 *  documents flow uses; reusing the existing storage presign pattern. */
export interface LetterheadLogoUploadUrl {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
  requiredContentType: string;
}
