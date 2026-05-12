import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Letterhead hooks. Types mirror the API DTOs in
 * apps/api/src/types/letterhead.types.ts. Kept local to the web app until
 * the feature is promoted into @lexdraft/types.
 */

export type LetterheadTemplateKey =
  | 'classic-centered'
  | 'logo-left'
  | 'minimalist'
  | 'two-column'
  | 'court-filing'
  | 'modern-accent';

export interface LetterheadFields {
  firmName?: string;
  tagline?: string;
  addressLines?: string[];
  phone?: string;
  email?: string;
  website?: string;
  regNumber?: string;
  footerText?: string;
  accentColor?: string;
}

export interface Letterhead {
  id: string;
  firmId: string;
  ownerUserId: string | null;
  name: string;
  templateKey: LetterheadTemplateKey;
  fields: LetterheadFields;
  logoKey: string | null;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListLetterheadsResponse {
  firmItems: Letterhead[];
  personalItems: Letterhead[];
  effectiveDefault: Letterhead | null;
}

export interface CreateLetterheadRequest {
  scope: 'firm' | 'personal';
  name: string;
  templateKey: LetterheadTemplateKey;
  fields: LetterheadFields;
  logoKey?: string | null;
  isDefault?: boolean;
}

export interface UpdateLetterheadRequest {
  name?: string;
  templateKey?: LetterheadTemplateKey;
  fields?: LetterheadFields;
  logoKey?: string | null;
  isDefault?: boolean;
}

interface LogoUploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
  requiredContentType: string;
}

const KEY = ['letterheads', 'list'] as const;

export function useLetterheads() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListLetterheadsResponse>('/letterheads'),
  });
}

export function useLetterhead(id: string | null) {
  return useQuery({
    queryKey: ['letterheads', 'detail', id ?? 'none'] as const,
    queryFn: () => api.get<Letterhead>(`/letterheads/${id}`),
    enabled: !!id,
  });
}

export function useCreateLetterhead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLetterheadRequest) =>
      api.post<Letterhead>('/letterheads', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['letterheads'] }),
  });
}

export function useUpdateLetterhead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateLetterheadRequest }) =>
      api.patch<Letterhead>(`/letterheads/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['letterheads'] }),
  });
}

export function useDeleteLetterhead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/letterheads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['letterheads'] }),
  });
}

/**
 * Two-step logo upload that mirrors the documents flow:
 *   1. POST /letterheads/logo-upload-url with file metadata → presigned PUT
 *   2. Client PUTs the binary to that URL with the exact Content-Type the
 *      server signed for. The local driver enforces the signature; s3/r2
 *      do their own auth.
 *   3. Caller stores the returned `storageKey` on the letterhead row.
 */
export function useUploadLetterheadLogo() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const presign = await api.post<LogoUploadUrlResponse>(
        '/letterheads/logo-upload-url',
        {
          fileName: file.name,
          fileMime: file.type || 'application/octet-stream',
          fileSize: file.size,
        },
      );
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        // Must match exactly — the local driver's HMAC covers the
        // content type. Mismatches surface as a 403 from the signed URL.
        headers: { 'content-type': presign.requiredContentType },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Logo upload failed (${putRes.status})`);
      }
      return presign.storageKey;
    },
  });
}

/**
 * Resolve a letterhead's logo to a presigned GET URL. Goes through
 * `/letterheads/:id/logo-url` so tenant scope is enforced server-side
 * (we never accept a raw storage key from the client).
 *
 * Returns `null` when the letterhead has no logo attached. URLs expire
 * server-side after ~15 min; staleTime keeps the query fresh well before
 * that and refetch-on-focus handles longer idle windows.
 */
export function useLogoUrl(letterheadId: string | null, hasLogo: boolean) {
  return useQuery({
    queryKey: ['letterheads', 'logo-url', letterheadId ?? 'none'] as const,
    queryFn: async () => {
      if (!letterheadId) return null;
      const res = await api.get<{ downloadUrl: string | null; expiresAt: string | null }>(
        `/letterheads/${letterheadId}/logo-url`,
      );
      return res.downloadUrl;
    },
    enabled: !!letterheadId && hasLogo,
    staleTime: 10 * 60 * 1000,
  });
}
