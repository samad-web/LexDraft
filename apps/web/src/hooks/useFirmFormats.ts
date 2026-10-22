import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** A firm's own drafting format (uploaded on the Draft page, drafted by the engine). */
export interface FirmFormatItem {
  id: string;
  title: string;
  /** The Draft-page picker label: "<title> (firm format)". */
  label: string;
  status: 'pending_review' | 'approved';
  fieldCount: number;
  sourceName: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface FormatSpec {
  title?: string;
  court_issued: boolean;
  fields: Array<{ key: string; kind: string; required: boolean; label?: string; help?: string }>;
  blocks: Array<Record<string, unknown>>;
}

export interface FormatReviewNotes {
  summary?: string;
  corrections?: Array<{ original: string; corrected: string }>;
  law_updates?: Array<{ original: string; updated: string; note: string }>;
  uncertain?: string[];
}

/** What the reader made of an uploaded format — reviewed before saving. */
export interface FormatReadResult {
  isLegalFormat: boolean;
  title: string;
  spec: FormatSpec;
  reviewNotes: FormatReviewNotes;
  ok: boolean;
  problems: string[];
  preview: string[];
  equivalent: { docType: string; label: string | null } | null;
  sourceName: string;
  sourceSha256: string;
}

export function useFirmFormats() {
  return useQuery({
    queryKey: ['firm-formats'],
    queryFn: () => api.get<{ items: FirmFormatItem[] }>('/firm-formats'),
    select: (r) => r.items,
  });
}

/** Upload a file and read it into a reviewable format (nothing is saved). */
export function useReadFormat() {
  return useMutation({
    mutationFn: async (input: { file: File; titleHint?: string }) => {
      const dataBase64 = await fileToBase64(input.file);
      return api.post<FormatReadResult>('/firm-formats/read', {
        fileName: input.file.name,
        mime: input.file.type,
        dataBase64,
        ...(input.titleHint ? { titleHint: input.titleHint } : {}),
      });
    },
  });
}

/** Save a reviewed format as approved; refreshes the picker's format list. */
export function useSaveFormat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      spec: FormatSpec;
      reviewNotes: FormatReviewNotes;
      sourceName: string;
      sourceSha256: string;
    }) => api.post<{ id: string; label: string }>('/firm-formats', {
      title: input.title,
      spec: { court_issued: input.spec.court_issued, fields: input.spec.fields, blocks: input.spec.blocks },
      reviewNotes: input.reviewNotes,
      sourceName: input.sourceName,
      sourceSha256: input.sourceSha256,
      reviewed: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-formats'] });
      qc.invalidateQueries({ queryKey: ['engine-status'] });
    },
  });
}

export function useDeleteFormat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/firm-formats/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-formats'] });
      qc.invalidateQueries({ queryKey: ['engine-status'] });
    },
  });
}

/** Read a File into base64 (strips the data: URL prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}
