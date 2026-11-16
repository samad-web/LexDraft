/**
 * Secure share links (build-docs/features/secure-share-link.md).
 * The client gets <site>/s#<token> (the part after # never reaches a server or its
 * logs): it expires, can be revoked, can need a
 * password, and counts views. The file itself never sits in the WhatsApp chat.
 */
import { api, apiClient } from './api';

export const SHARE_DAYS = [1, 7, 30] as const;
export type ShareDays = (typeof SHARE_DAYS)[number];

export interface SharedLink {
  id: string;
  fileName: string;
  fileSize: number;
  hasPassword: boolean;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

export const shareUrl = (token: string, origin = window.location.origin) => `${origin}/s#${token}`;

export async function createShareLink(file: Blob, fileName: string, days: ShareDays, password?: string) {
  try {
    const res = await apiClient.post<{ id: string; token: string; expiresAt: string }>('/api/share-links', file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Share-Name': encodeURIComponent(fileName),
        'X-Share-Days': String(days),
        ...(password ? { 'X-Share-Password': password } : {}),
      },
    });
    return { ...res.data, url: shareUrl(res.data.token) };
  } catch (err) {
    throw new Error(err instanceof Error && err.message && !/status code/.test(err.message) ? err.message : 'Could not create the link');
  }
}

export const listShareLinks = () => api.get<SharedLink[]>('/share-links');
export const revokeShareLink = (id: string) => api.post<void>(`/share-links/${id}/revoke`);

export function linkStatus(l: Pick<SharedLink, 'revokedAt' | 'expiresAt'>, now = Date.now()): 'active' | 'expired' | 'revoked' {
  if (l.revokedAt) return 'revoked';
  return new Date(l.expiresAt).getTime() <= now ? 'expired' : 'active';
}

/** WhatsApp note carrying the link. The password is never put in it. */
export function linkNote(note: string, url: string, expiresAt: string, hasPassword: boolean): string {
  const until = new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return [
    note,
    '',
    `Open it here (link works until ${until}):`,
    url,
    hasPassword ? '\nThe link is password protected. I will send you the password separately.' : null,
  ].filter((l) => l !== null).join('\n');
}

// ---- public page (no sign-in): plain fetch, so a 401 never triggers the app's sign-out ----

const API = import.meta.env.VITE_API_URL || '';

async function errorText(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  return j?.error || 'This link is not available. Ask the sender for a new one.';
}

export async function fetchShareMeta(token: string) {
  const res = await fetch(`${API}/api/s/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store',
  });
  if (!res.ok) throw Object.assign(new Error(await errorText(res)), { status: res.status });
  return (await res.json()) as { fileName: string; fileSize: number; needsPassword: boolean; expiresAt: string };
}

export async function openShare(token: string, password?: string): Promise<Blob> {
  const res = await fetch(`${API}/api/s/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(password ? { token, password } : { token }),
    cache: 'no-store',
  });
  if (!res.ok) throw Object.assign(new Error(await errorText(res)), { status: res.status });
  return res.blob();
}
