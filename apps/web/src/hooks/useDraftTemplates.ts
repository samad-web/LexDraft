import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** A firm's saved drafting FORMAT (their house style), filled by the agent. */
export interface DraftFormatTemplate {
  id: string;
  name: string;
  docType: string;
  body: string;
  source: 'paste' | 'upload';
  createdAt: string;
}

export interface CreateDraftTemplateInput {
  name: string;
  docType?: string;
  body: string;
  source?: 'paste' | 'upload';
}

export function useDraftTemplates() {
  return useQuery({
    queryKey: ['draft-templates'],
    queryFn: () => api.get<{ items: DraftFormatTemplate[] }>('/draft-templates'),
    select: (r) => r.items,
  });
}

export function useCreateDraftTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDraftTemplateInput) =>
      api.post<DraftFormatTemplate>('/draft-templates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['draft-templates'] }),
  });
}

export function useDeleteDraftTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/draft-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['draft-templates'] }),
  });
}

/** Parse an uploaded .docx/.txt/.pdf to plain text (before saving as a format). */
export function useParseTemplateFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await fileToBase64(file);
      return api.post<{ text: string }>('/draft-templates/parse', {
        fileName: file.name,
        mime: file.type,
        dataBase64,
      });
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
