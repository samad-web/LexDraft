/**
 * Share several case documents on WhatsApp at once (build-docs/features/multi-share.md).
 * Password is the default and is never skipped: with a password on, every file
 * goes out locked (PDF) or behind a password link; anything that can't carry the
 * password blocks the share instead of going out open.
 */
import { api } from './api';
import { confidentialMark, lockPdf, validPdfPassword } from './pdf-lock';
import { createShareLink, type ShareDays } from './share-link';

export const MAX_SHARE_FILES = 10;

export type ShareMode = 'link' | 'files';

export interface ShareItem {
  id: string;
  /** Name shown in the message (document title). */
  name: string;
  /** File name with extension. */
  fileName: string;
  mime?: string;
}

export const isPdf = (it: Pick<ShareItem, 'fileName' | 'mime'>) =>
  /pdf/i.test(it.mime ?? '') || /\.pdf$/i.test(it.fileName);

/** Why this share can't go out as asked, or null when it can. */
export function shareProblem(items: ShareItem[], mode: ShareMode, password: string | null): string | null {
  if (items.length === 0) return 'Select at least one file.';
  if (items.length > MAX_SHARE_FILES) return `Select up to ${MAX_SHARE_FILES} files at a time.`;
  if (password !== null && !validPdfPassword(password)) return 'Password must be 4 to 64 characters.';
  if (mode === 'files' && password !== null) {
    const open = items.filter((it) => !isPdf(it));
    if (open.length) {
      const names = open.slice(0, 3).map((it) => it.fileName).join(', ') + (open.length > 3 ? '…' : '');
      return `Only PDFs can be locked with a password as files (${names}). Use "Secure link" to send these with a password.`;
    }
  }
  return null;
}

/** Download a stored document's bytes through its short-lived signed link. */
export async function fetchDocumentBlob(id: string): Promise<Blob> {
  const { downloadUrl } = await api.get<{ downloadUrl: string }>(`/documents/${id}/download-url`);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/** Run fn over items in order; the first failure stops everything and names the file. */
async function eachOrStop<T>(items: ShareItem[], fn: (it: ShareItem) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (const it of items) {
    try {
      out.push(await fn(it));
    } catch (err) {
      const why = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? `: ${err.message}` : '';
      throw new Error(`Could not prepare "${it.fileName}"${why}. Nothing was sent.`);
    }
  }
  return out;
}

export interface Deps {
  getBlob?: (id: string) => Promise<Blob>;
  lock?: typeof lockPdf;
  link?: typeof createShareLink;
}

/** Files mode: every file fetched, and every PDF locked when a password is set. */
export function prepareFiles(items: ShareItem[], password: string | null, forWhom: string | null, deps: Deps = {}) {
  const getBlob = deps.getBlob ?? fetchDocumentBlob;
  const lock = deps.lock ?? lockPdf;
  const problem = shareProblem(items, 'files', password);
  if (problem) return Promise.reject(new Error(problem));
  return eachOrStop(items, async (it) => {
    let blob = await getBlob(it.id);
    if (password !== null) blob = await lock(blob, password, confidentialMark(forWhom));
    return { blob, fileName: it.fileName };
  });
}

/** Link mode: one secure link per file, all with the same password. */
export function prepareLinks(items: ShareItem[], days: ShareDays, password: string | null, deps: Deps = {}) {
  const getBlob = deps.getBlob ?? fetchDocumentBlob;
  const link = deps.link ?? createShareLink;
  const problem = shareProblem(items, 'link', password);
  if (problem) return Promise.reject(new Error(problem));
  return eachOrStop(items, async (it) => {
    const l = await link(await getBlob(it.id), it.fileName, days, password ?? undefined);
    return { name: it.name, url: l.url, expiresAt: l.expiresAt };
  });
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** One WhatsApp message listing every file and its link. Never contains the password. */
export function linksMessage(
  links: Array<{ name: string; url: string; expiresAt: string }>,
  hasPassword: boolean,
  from?: string | null,
): string {
  const until = links.length ? day(links[0]!.expiresAt) : '';
  return [
    'Dear Sir/Madam,',
    '',
    `Please find ${links.length === 1 ? 'the document' : `${links.length} documents`} below (links work until ${until}):`,
    '',
    ...links.map((l, i) => `${i + 1}. ${l.name}\n${l.url}`),
    hasPassword ? '\nThe links are password protected. I will send you the password separately.' : null,
    from?.trim() ? `\nRegards,\n${from.trim()}` : null,
  ].filter((l) => l !== null).join('\n');
}

export function filesNote(count: number, hasPassword: boolean, from?: string | null): string {
  return [
    'Dear Sir/Madam,',
    '',
    `Please find attached ${count === 1 ? 'the document' : `${count} documents`}.`,
    hasPassword ? '\nThe files are password protected. I will send you the password separately.' : null,
    from?.trim() ? `\nRegards,\n${from.trim()}` : null,
  ].filter((l) => l !== null).join('\n');
}
