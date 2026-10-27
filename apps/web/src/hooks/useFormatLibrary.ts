import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** One LAWE form in the library, mapped to the Draft-page format that drafts it. */
export interface LaweForm {
  id: string;
  /** The title the LAWE site shows (e.g. "Petition to recall warrant"). */
  title: string;
  /** LAWE's section (e.g. "High Court", "In the Court of"). */
  group: string;
  /** Where LAWE publishes the form (reference only — the app previews DifAI's
   *  own rendering instead, never LAWE's file). */
  url: string;
  /** The Draft-page format label that drafts this form. */
  docLabel: string;
  /** Variant pre-selected for this form (e.g. a warrant's kind). */
  preset: Record<string, string>;
}

export function useFormatLibrary() {
  return useQuery({
    queryKey: ['format-library'],
    queryFn: () => api.get<{ lawe: LaweForm[]; laweSource: string | null }>('/drafting/engine/library'),
    staleTime: 10 * 60_000,
  });
}

/** A blank form: the Word file plus its text (one block per paragraph). */
export interface BlankForm {
  docxBase64: string;
  blocks: Array<{ key: string; text: string }>;
  fileName: string;
}

/** Fetch a format as a blank, editable Word form. Rejects with status 409 when
 *  the format can only be produced from the case details. */
export function useBlankFormat() {
  return useMutation({
    mutationFn: (input: { docLabel: string; preset?: Record<string, string> }) =>
      api.post<BlankForm>('/drafting/engine/blank', input),
  });
}

/** Save a base64 .docx to the advocate's computer. */
export function saveDocx(base64: string, fileName: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.replace(/[^\w.() -]+/g, '_')}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Show a blank form as PDF in a tab the caller opened synchronously on click
 *  (so pop-up blockers allow it). Same server-side court-layout render as save. */
export async function previewBlankPdf(tab: Window, docxBase64: string, fileName: string): Promise<void> {
  const blob = await api.postBlob('/drafting/engine/docx-to-pdf', { docxBase64, fileName });
  tab.location.href = URL.createObjectURL(blob);
}

/** Convert a blank form's Word file to PDF (server-side, same court layout) and save it. */
export async function saveBlankPdf(docxBase64: string, fileName: string): Promise<void> {
  const blob = await api.postBlob('/drafting/engine/docx-to-pdf', { docxBase64, fileName });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.replace(/[^\w.() -]+/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
