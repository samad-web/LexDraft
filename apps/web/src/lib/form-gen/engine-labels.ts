// Web-side copy of the engine routing labels (engine label -> slug), mirroring the
// api's LABEL_TO_ENGINE_DOC in apps/api/src/lib/engine-field-map.ts. The web can't
// import the api package, so this is a deliberate, small duplicate.
//
// It only needs entries for doc types the generated form will be ENABLED for (resolve.ts
// consults it per enabled slug). Add an engine label here when you flip a doc type on.
// The api's alignment CI test is the guard that the engine label is the real one; keep
// this in sync when adding a doc type.

export const LABEL_TO_ENGINE_DOC: Record<string, string> = {
  'Regular Bail Application': 'regular_bail',
  'Notice u/s 138 NI Act': 's138_notice',
  Affidavit: 'affidavit',
  // Add more as they are flipped on (must match apps/api LABEL_TO_ENGINE_DOC exactly):
  // 'Anticipatory Bail Application': 'anticipatory_bail',
  // 'Lease Deed': 'lease_deed',
};

// The LEGACY static DOC_SCHEMAS label for an engine slug — usually different from the
// engine label (the whole reason the web never routed). When a slug is flipped on, its
// generated form goes under the ENGINE label and this LEGACY label is removed from the
// picker so there's one entry. Add the slug's old DOC_SCHEMAS key here when flipping.
export const LEGACY_LABEL_FOR_SLUG: Record<string, string> = {
  regular_bail: 'Bail Application',
};
