// Unit tests for document-render.service that do NOT require a real LibreOffice.
// A fake `soffice` (a node script behind a native wrapper) is pointed at via
// SOFFICE_BIN, so the conversion contract — success output, non-zero exit, timeout,
// missing output, and temp-dir cleanup — is exercised deterministically. DB-backed
// persistence (ensurePending/process) is covered by the integration suite where a
// Postgres service is available.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Fake soffice: writes <basename>.pdf into --outdir (mirroring LibreOffice), or
// simulates hang/fail/no-output via FAKE_SOFFICE_MODE.
const FAKE_SOFFICE = `
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const mode = process.env.FAKE_SOFFICE_MODE || 'ok';
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'fail') { process.stderr.write('boom'); process.exit(3); }
else if (mode === 'nooutput') { process.exit(0); }
else {
  const outIdx = args.indexOf('--outdir');
  const outDir = args[outIdx + 1];
  const input = args[args.length - 1];
  const base = path.basename(input).replace(/\\.docx$/, '.pdf');
  fs.writeFileSync(path.join(outDir, base), '%PDF-1.4 fake');
  process.exit(0);
}
`;

let workRoot: string;
let wrapper: string;

beforeAll(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'render-test-'));
  const fakeBin = path.join(workRoot, 'fake-soffice.js');
  await fs.writeFile(fakeBin, FAKE_SOFFICE);
  const isWin = process.platform === 'win32';
  wrapper = isWin ? path.join(workRoot, 'soffice.cmd') : path.join(workRoot, 'soffice.sh');
  if (isWin) {
    await fs.writeFile(wrapper, `@echo off\r\nnode "${fakeBin}" %*\r\n`);
  } else {
    await fs.writeFile(wrapper, `#!/bin/sh\nexec node "${fakeBin}" "$@"\n`);
    await fs.chmod(wrapper, 0o755);
  }
});

afterAll(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // env.ts snapshots process.env at import; reset the registry so each test's env
  // (SOFFICE_BIN / timeout / mode) is picked up by a fresh import of the service.
  vi.resetModules();
  process.env['SOFFICE_BIN'] = wrapper;
  process.env['SOFFICE_TIMEOUT_MS'] = '20000';
  delete process.env['FAKE_SOFFICE_MODE'];
});

async function loadService() {
  return import('../document-render.service');
}

async function countTmpRenderDirs(): Promise<number> {
  const entries = await fs.readdir(os.tmpdir()).catch(() => [] as string[]);
  return entries.filter((e) => e.startsWith('lexdraft-render-')).length;
}

describe('document-render key layout', () => {
  it('keys docx and pdf under matter + version, deterministically', async () => {
    const { _internal } = await loadService();
    expect(_internal.docxKeyFor('m-123', 2)).toBe('renders/m-123/v2/document.docx');
    expect(_internal.pdfKeyFor('m-123', 2)).toBe('renders/m-123/v2/document.pdf');
    // Idempotent: same inputs -> same key (a retry overwrites, never duplicates).
    expect(_internal.docxKeyFor('m-123', 2)).toBe('renders/m-123/v2/document.docx');
    // Distinct versions never collide.
    expect(_internal.pdfKeyFor('m-123', 3)).not.toBe(_internal.pdfKeyFor('m-123', 2));
  });
});

// The conversion tests spawn a fake binary. On Windows, spawning a .cmd wrapper
// without shell:true throws EINVAL, and production never runs this job on Windows
// (the document.render worker is Linux/Alpine only). So these run on POSIX; the key
// layout + timeout logic above is covered cross-platform.
const describeConvert = process.platform === 'win32' ? describe.skip : describe;

describeConvert('convertDocxToPdf (fake soffice)', () => {
  it('produces pdf bytes on success and leaves no temp dir behind', async () => {
    const { _internal } = await loadService();
    const pdf = await _internal.convertDocxToPdf(Buffer.from('PK fake docx'));
    expect(pdf.toString('utf8')).toContain('%PDF');
    expect(await countTmpRenderDirs()).toBe(0);
  });

  it('throws and cleans up when soffice exits non-zero', async () => {
    process.env['FAKE_SOFFICE_MODE'] = 'fail';
    const { _internal } = await loadService();
    await expect(_internal.convertDocxToPdf(Buffer.from('x'))).rejects.toThrow(/soffice exited/);
    expect(await countTmpRenderDirs()).toBe(0);
  });

  it('throws (and cleans up) when soffice produces no output', async () => {
    process.env['FAKE_SOFFICE_MODE'] = 'nooutput';
    const { _internal } = await loadService();
    await expect(_internal.convertDocxToPdf(Buffer.from('x'))).rejects.toThrow(/no PDF output/);
    expect(await countTmpRenderDirs()).toBe(0);
  });

  it('kills and fails a hung conversion at the timeout', async () => {
    process.env['FAKE_SOFFICE_MODE'] = 'hang';
    process.env['SOFFICE_TIMEOUT_MS'] = '800';
    const { _internal } = await loadService();
    await expect(_internal.convertDocxToPdf(Buffer.from('x'))).rejects.toThrow(/timed out/);
    expect(await countTmpRenderDirs()).toBe(0);
  });
});
