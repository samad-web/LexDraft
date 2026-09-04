// =============================================================================
// document-render.service — the ONE rendering path for engine drafts.
//
// The engine returns a fully-rendered .docx (docx_base64). This service is where
// that authoritative artifact becomes the thing the advocate previews AND files:
//
//   1. store the engine .docx to object storage (S3/R2/local),
//   2. convert it to PDF with LibreOffice headless (soffice --convert-to pdf),
//   3. store the PDF,
//   4. record both keys + the template/soffice versions on the draft_renders row.
//
// The web previews the PDF (pdfjs) and downloads the .docx from these keys. There
// is no second renderer: the old jsPDF/html2canvas client path is gone for filing
// copies, so preview and download are the same document the engine produced.
//
// Hardening (LibreOffice is hostile in production):
//   * hard timeout — soffice hangs on malformed input; we kill it and fail the render.
//   * per-job -env:UserInstallation — a dedicated profile dir per conversion so
//     concurrent jobs don't corrupt a shared ~/.config/libreoffice profile.
//   * temp-dir cleanup in finally — soffice leaves profile + intermediate dirs behind.
//   * idempotent on (matter_id, fact_sheet_version) — a pg-boss retry upserts the
//     same row and overwrites the same S3 keys rather than duplicating objects.
// =============================================================================

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../env';
import { db } from '../db/client';
import { logger } from '../logger';
import { storage } from './storage.service';

export interface RenderRequest {
  /** Engine matter identity (fact_sheets.matter_id). */
  matterId: string;
  /** The fact-sheet version whose facts produced this .docx. Idempotency key. */
  factSheetVersion: number;
  firmId: string | null;
  docType: string;
  /** Optional saved-draft row this render is associated with. */
  draftId?: string | null;
  /** The engine's rendered .docx, base64. */
  docxBase64: string;
  /** Template identity/version the engine reported for this doc type. */
  templateId: string;
  templateVersion: number;
}

export type RenderStatus = 'pending' | 'ready' | 'failed';

export interface DraftRender {
  id: string;
  firmId: string | null;
  matterId: string;
  factSheetVersion: number;
  draftId: string | null;
  docType: string;
  templateId: string;
  templateVersion: number;
  sofficeVersion: string;
  docxKey: string | null;
  pdfKey: string | null;
  renderStatus: RenderStatus;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  firm_id: string | null;
  matter_id: string;
  fact_sheet_version: number;
  draft_id: string | null;
  doc_type: string;
  template_id: string;
  template_version: number;
  soffice_version: string;
  docx_key: string | null;
  pdf_key: string | null;
  render_status: RenderStatus;
  error_detail: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function fromRow(r: Row): DraftRender {
  return {
    id: r.id,
    firmId: r.firm_id,
    matterId: r.matter_id,
    factSheetVersion: r.fact_sheet_version,
    draftId: r.draft_id,
    docType: r.doc_type,
    templateId: r.template_id,
    templateVersion: r.template_version,
    sofficeVersion: r.soffice_version,
    docxKey: r.docx_key,
    pdfKey: r.pdf_key,
    renderStatus: r.render_status,
    errorDetail: r.error_detail,
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
  };
}

/** Storage key layout. Keyed by matter + version so a re-render at the same version
 *  overwrites (idempotent) and different versions never collide. */
function docxKeyFor(matterId: string, version: number): string {
  return `renders/${matterId}/v${version}/document.docx`;
}
function pdfKeyFor(matterId: string, version: number): string {
  return `renders/${matterId}/v${version}/document.pdf`;
}

// ---- soffice conversion -----------------------------------------------------

/** Run a bounded child process, killing it (and its process group where possible)
 *  past the timeout. Resolves with stdout/stderr/exit; rejects only on spawn error. */
function runBounded(
  bin: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string },
): Promise<{ code: number | null; timedOut: boolean; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stderr?.on('data', (d) => {
      if (stderr.length < 8192) stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stderr });
    });
  });
}

/** Probe the pinned soffice build. Best-effort — returns '' if it can't be read,
 *  which is recorded verbatim (a render whose soffice version is unknown is itself
 *  worth surfacing). */
async function sofficeVersion(): Promise<string> {
  try {
    const child = await runBoundedCapture(env.SOFFICE_BIN, ['--version'], 10_000);
    return child.split(/\r?\n/)[0]?.trim() ?? '';
  } catch {
    return '';
  }
}

function runBoundedCapture(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (d) => { out += String(d); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

/** Convert docx bytes -> pdf bytes via LibreOffice headless. Throws on any failure
 *  (missing binary, non-zero exit, timeout, no output). Always cleans its temp dir. */
async function convertDocxToPdf(docx: Buffer): Promise<Buffer> {
  // A dedicated working dir per conversion: holds the input .docx, the output .pdf,
  // AND a private LibreOffice user profile so concurrent jobs never share a profile.
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lexdraft-render-'));
  const profileDir = path.join(workDir, 'profile');
  const inPath = path.join(workDir, 'in.docx');
  try {
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(inPath, docx);

    // file:// URL for the private profile — LibreOffice wants a URL, not a path.
    const profileUrl = `file://${profileDir.replace(/\\/g, '/')}`;
    const args = [
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--nofirststartwizard',
      `-env:UserInstallation=${profileUrl}`,
      '--convert-to',
      'pdf',
      '--outdir',
      workDir,
      inPath,
    ];

    const { code, timedOut, stderr } = await runBounded(env.SOFFICE_BIN, args, {
      timeoutMs: env.SOFFICE_TIMEOUT_MS,
      cwd: workDir,
    });
    if (timedOut) {
      throw new Error(`soffice conversion timed out after ${env.SOFFICE_TIMEOUT_MS}ms`);
    }
    if (code !== 0) {
      throw new Error(`soffice exited ${code}: ${stderr.slice(0, 500)}`);
    }
    const outPath = path.join(workDir, 'in.pdf');
    const pdf = await fs.readFile(outPath).catch(() => null);
    if (!pdf || pdf.length === 0) {
      throw new Error('soffice produced no PDF output');
    }
    return pdf;
  } finally {
    // soffice leaves the profile + intermediate files; remove the whole work dir.
    await fs.rm(workDir, { recursive: true, force: true }).catch((err) => {
      logger.warn({ err, workDir }, 'document-render: temp cleanup failed');
    });
  }
}

// ---- persistence ------------------------------------------------------------

export const documentRenderService = {
  /** Create (or return existing) a pending render row for a request, then return its
   *  id. Idempotent on (matter_id, fact_sheet_version): a second call for the same
   *  version returns the existing row without resetting a completed render. */
  async ensurePending(req: RenderRequest): Promise<DraftRender> {
    const conn = db();
    if (!conn) throw new Error('document-render requires a database');
    const rows = await conn<Row[]>`
      insert into draft_renders
        (firm_id, matter_id, fact_sheet_version, draft_id, doc_type,
         template_id, template_version, render_status)
      values
        (${req.firmId}, ${req.matterId}, ${req.factSheetVersion}, ${req.draftId ?? null},
         ${req.docType}, ${req.templateId}, ${req.templateVersion}, 'pending')
      on conflict (matter_id, fact_sheet_version) do update set
        -- refresh the association/template metadata but DO NOT clobber a finished
        -- render's status/keys; a re-render is an explicit reprocess (see process()).
        draft_id = coalesce(excluded.draft_id, draft_renders.draft_id),
        doc_type = excluded.doc_type,
        template_id = excluded.template_id,
        template_version = excluded.template_version,
        updated_at = now()
      returning *`;
    return fromRow(rows[0]!);
  },

  /** Do the actual work: store .docx, convert to PDF, store PDF, mark ready. Safe to
   *  re-run (pg-boss retry) — writes to deterministic keys and upserts the row. On
   *  failure records render_status='failed' with the reason and rethrows so pg-boss
   *  can apply its own retry policy. */
  async process(req: RenderRequest): Promise<DraftRender> {
    const conn = db();
    if (!conn) throw new Error('document-render requires a database');

    const docxKey = docxKeyFor(req.matterId, req.factSheetVersion);
    const pdfKey = pdfKeyFor(req.matterId, req.factSheetVersion);
    const sv = await sofficeVersion();

    try {
      const docx = Buffer.from(req.docxBase64, 'base64');
      if (docx.length === 0) throw new Error('empty docx_base64');

      // Store the authoritative .docx first, so even if PDF conversion fails the
      // advocate can still download the true source document.
      await storage().putObject({
        key: docxKey,
        body: docx,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const pdf = await convertDocxToPdf(docx);
      await storage().putObject({ key: pdfKey, body: pdf, contentType: 'application/pdf' });

      const rows = await conn<Row[]>`
        update draft_renders set
          docx_key = ${docxKey},
          pdf_key = ${pdfKey},
          soffice_version = ${sv},
          render_status = 'ready',
          error_detail = null,
          updated_at = now()
        where matter_id = ${req.matterId} and fact_sheet_version = ${req.factSheetVersion}
        returning *`;
      logger.info(
        { matterId: req.matterId, version: req.factSheetVersion, docType: req.docType },
        'document-render: ready',
      );
      return fromRow(rows[0]!);
    } catch (err) {
      const detail = (err as Error)?.message ?? 'render failed';
      await conn`
        update draft_renders set
          soffice_version = ${sv},
          render_status = 'failed',
          error_detail = ${detail},
          updated_at = now()
        where matter_id = ${req.matterId} and fact_sheet_version = ${req.factSheetVersion}`;
      logger.error(
        { err, matterId: req.matterId, version: req.factSheetVersion },
        'document-render: failed',
      );
      throw err;
    }
  },

  /** Fetch a render by id, scoped to a firm (ownership check for the route). */
  async getForFirm(id: string, firmId: string | null): Promise<DraftRender | null> {
    const conn = db();
    if (!conn) return null;
    const rows = await conn<Row[]>`
      select * from draft_renders
      where id = ${id} and firm_id is not distinct from ${firmId}
      limit 1`;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** Presigned, short-lived download URLs for a ready render. Caller MUST have
   *  already authorised firm ownership (see getForFirm / the route). */
  async presignArtifacts(
    render: DraftRender,
  ): Promise<{ docxUrl: string | null; pdfUrl: string | null; expiresAt: string | null }> {
    const EXPIRES_SEC = 15 * 60; // 15 minutes — privileged client documents.
    let docxUrl: string | null = null;
    let pdfUrl: string | null = null;
    let expiresAt: string | null = null;
    if (render.docxKey) {
      const d = await storage().presignDownload({ key: render.docxKey, expiresInSec: EXPIRES_SEC });
      docxUrl = d.downloadUrl;
      expiresAt = d.expiresAt;
    }
    if (render.pdfKey) {
      const p = await storage().presignDownload({ key: render.pdfKey, expiresInSec: EXPIRES_SEC });
      pdfUrl = p.downloadUrl;
      expiresAt = p.expiresAt;
    }
    return { docxUrl, pdfUrl, expiresAt };
  },
};

// Re-export the key helpers for tests.
export const _internal = { docxKeyFor, pdfKeyFor, convertDocxToPdf, randomUUID };
