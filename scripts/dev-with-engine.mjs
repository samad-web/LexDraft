// =============================================================================
// dev-with-engine — one command to bring up the WHOLE local stack.
//
// `pnpm dev` runs this. It starts:
//   1. the Python drafting ENGINE (lexdraft-engine, a sibling repo) via uvicorn, and
//   2. the TS monorepo dev servers (web + API) via `turbo run dev --parallel`.
//
// Why this exists: the engine is a SEPARATE Python repo, not a pnpm workspace, so
// `turbo run dev` never knew about it — and it kept being forgotten / left down,
// surfacing in the app as "The drafting engine isn't reachable right now." This
// launcher makes the engine start (and stop) together with web + API.
//
// The engine's shared token is read from apps/api/.env (ENGINE_SERVICE_TOKEN) so
// the engine (LEXDRAFT_SERVICE_TOKEN) and the API always agree with zero config.
// If the engine repo or its venv isn't present, we log a clear warning and still
// start web + API (so front-end-only work isn't blocked).
// =============================================================================

import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepo = resolve(__dirname, '..');            // .../LexDraft
const engineDir = resolve(monorepo, '..', 'lexdraft-engine');
const isWin = process.platform === 'win32';

/** Read one KEY=value from a .env file (first match), else undefined. */
function readEnvVar(envPath, key) {
  if (!existsSync(envPath)) return undefined;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() === key) {
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

/** Resolve the engine's Python interpreter (its venv), or null if absent. */
function enginePython() {
  const p = isWin
    ? join(engineDir, '.venv', 'Scripts', 'python.exe')
    : join(engineDir, '.venv', 'bin', 'python');
  return existsSync(p) ? p : null;
}

// --- 0. One stack only ---------------------------------------------------------
// Two `pnpm dev` stacks (e.g. a second terminal or editor session) fought over
// :4000 — each API crash-looped on EADDRINUSE and dropped in-flight requests.
// Refuse to start a second copy rather than half-start one.
const PORTS = { 8099: 'engine', 8001: 'embeddings', 4000: 'api', 5173: 'web' };
// Probe the hosts the services really bind (engine/embeddings 127.0.0.1, Vite ::1):
// a bare listen(port) on '::' did not collide with them and missed 3 of 4.
function portBusyOn(port, host) {
  return new Promise((done) => {
    const probe = net.createServer();
    probe.once('error', (err) => done(err.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => done(false)));
    probe.listen(port, host);
  });
}
async function portBusy(port) {
  for (const host of ['127.0.0.1', '::1', '::']) if (await portBusyOn(port, host)) return true;
  return false;
}
// A lock file first: two launches in the same second both saw free ports
// before either bound one. 'wx' creates it atomically or fails.
const lockPath = join(os.tmpdir(), 'difai-dev-stack.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
try {
  writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
} catch {
  const holder = Number(readFileSync(lockPath, 'utf8'));
  if (holder && holder !== process.pid && alive(holder)) {
    console.error(`[dev] ✗ another dev stack is already running (pid ${holder}). Stop it first, then run \`pnpm dev\` again.`);
    process.exit(1);
  }
  writeFileSync(lockPath, String(process.pid)); // stale lock from a crashed run
}
process.on('exit', () => { try { if (Number(readFileSync(lockPath, 'utf8')) === process.pid) unlinkSync(lockPath); } catch { /* gone */ } });

const busy = [];
for (const [port, name] of Object.entries(PORTS)) {
  if (await portBusy(Number(port))) busy.push(`${name} :${port}`);
}
if (busy.length) {
  console.error(
    `[dev] ✗ already running: ${busy.join(', ')}.\n`
    + '        Another dev stack is up. Stop it first (close its terminal, or end the\n'
    + '        node/python processes on those ports), then run `pnpm dev` again.',
  );
  process.exit(1);
}

// --- 0b. Self-hosted local Postgres (only if .env points at it) ---------------
// Local dev moved off Supabase on 2026-11-04 to %LOCALAPPDATA%\difai-pg (conda-forge
// PostgreSQL 16 + pgvector, port 5433). It doesn't start after a reboot, so start
// it here. Detached on purpose: the database outlives the dev stack.
const dbUrl = readEnvVar(join(monorepo, 'apps', 'api', '.env'), 'DATABASE_URL') ?? '';
const pgRoot = join(process.env.LOCALAPPDATA ?? '', 'difai-pg');
const pgCtl = join(pgRoot, 'env', 'Library', 'bin', 'pg_ctl.exe');
if (isWin && /@localhost:5433\//.test(dbUrl) && existsSync(pgCtl) && !(await portBusy(5433))) {
  spawn(pgCtl, ['start', '-D', join(pgRoot, 'data'), '-l', join(pgRoot, 'postgres.log')], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
  for (let i = 0; i < 30 && !(await portBusy(5433)); i += 1) await new Promise((r) => setTimeout(r, 500));
  console.log((await portBusy(5433)) ? '[dev] ✓ local Postgres :5433 started' : '[dev] ⚠ local Postgres did not start; see difai-pg/postgres.log');
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill(); } catch { /* already gone */ }
  }
  process.exit(code ?? 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// --- 1. The engine (best-effort — never blocks web + API) --------------------
const py = enginePython();
if (!py) {
  console.warn(
    '[dev] ⚠  lexdraft-engine venv not found at '
    + `${engineDir}\\.venv — starting web + API WITHOUT the engine.\n`
    + '        Drafting will show "engine isn\'t reachable" until you create the venv '
    + '(python -m venv .venv && pip install -e ".[service]") in the engine repo.',
  );
} else {
  const token =
    readEnvVar(join(monorepo, 'apps', 'api', '.env'), 'ENGINE_SERVICE_TOKEN')
    ?? 'lexdraft-local-dev-token';
  const engine = spawn(
    py,
    ['-m', 'uvicorn', 'src.service.app:app', '--host', '127.0.0.1', '--port', '8099'],
    {
      cwd: engineDir,
      // Local dev also serves imported formats still awaiting advocate approval
      // (production never sets this — see lexdraft-engine/docs/format-import.md).
      env: { ...process.env, LEXDRAFT_SERVICE_TOKEN: token, LEXDRAFT_IMPORTS_SERVE_PENDING: 'true' },
      stdio: 'inherit',
      shell: false,
    },
  );
  engine.on('exit', (code) => {
    if (!shuttingDown) {
      console.warn(`[dev] ⚠  engine exited (code ${code}). Web + API keep running; drafting will be unavailable until you restart.`);
    }
  });
  children.push(engine);
  console.log('[dev] ✓ engine starting on http://127.0.0.1:8099');
}

// --- 2. The TS monorepo dev servers (web + API) ------------------------------
// Run turbo THROUGH pnpm (`pnpm run dev:apps`) rather than the turbo binary
// directly: turbo shells out to the package manager to run each package's `dev`
// script, and only a pnpm-launched process carries the corepack context turbo
// needs to locate the pnpm binary. Invoking turbo.CMD directly fails with
// "cannot find package manager binary".
//
// Re-invoke the SAME package manager that launched this script. When `pnpm dev`
// runs us, pnpm sets `npm_execpath` to its own entry file, so we run it with the
// current `node` — no dependence on `pnpm` being on PATH (it's a corepack shim
// that isn't always exported). Fall back to the shell shim only if that's absent.
// Run the web + API dev servers. We invoke pnpm's per-package filters DIRECTLY
// (`pnpm --filter <pkg> dev`) instead of `turbo run dev`, because turbo re-derives
// the package-manager binary to launch each package and fails with "cannot find
// package manager binary" in a spawned, non-interactive context (the corepack
// pnpm shim isn't on PATH there). pnpm's own filter runner has no such lookup, so
// this is reliable. Each server is its own child; if either dies we tear the
// whole stack down (matching turbo's all-or-nothing dev behaviour).
//
// pnpm itself is launched via COREPACK's .js entry (bundled with Node) run under
// the current `node` with NO shell — so a space in "C:\Program Files" can't split
// the command. Fall back to the npm_execpath pnpm entry, then a bare shim.
const nodeDir = dirname(process.execPath);
const childEnv = { ...process.env };
// The repo lives in a OneDrive folder, where native file-change events are
// unreliable: `tsx watch` silently kept serving hours-old API code after
// edits (seen 2026-10-20 - a fixed bug kept reappearing). tsx and Vite both
// watch through chokidar, which honours these; polling every second is cheap
// enough for dev and always notices edits.
if (isWin && monorepo.toLowerCase().includes('onedrive')) {
  childEnv.CHOKIDAR_USEPOLLING ??= '1';
  childEnv.CHOKIDAR_INTERVAL ??= '1000';
}
// --- 1b. The embedding service (judgment + statute search by meaning) ----------
// tools/embed-server (bge-m3). Its venv lives OUTSIDE OneDrive (torch is thousands
// of files): %LOCALAPPDATA%\difai-embed\.venv, or DIFAI_EMBED_PYTHON. Absent =
// keyword-only search, exactly as before.
const embedPy = process.env.DIFAI_EMBED_PYTHON
  ?? (isWin
    ? join(process.env.LOCALAPPDATA ?? '', 'difai-embed', '.venv', 'Scripts', 'python.exe')
    : join(process.env.HOME ?? '', '.difai-embed', '.venv', 'bin', 'python'));
if (existsSync(embedPy)) {
  const embed = spawn(
    embedPy,
    ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8001'],
    { cwd: join(monorepo, 'tools', 'embed-server'), env: { ...process.env }, stdio: 'inherit', shell: false },
  );
  embed.on('exit', (code) => {
    if (!shuttingDown) console.warn(`[dev] ⚠  embeddings exited (code ${code}); search falls back to keywords.`);
  });
  children.push(embed);
  childEnv.EMBED_SERVICE_URL ??= 'http://127.0.0.1:8001';
  console.log('[dev] ✓ embeddings starting on http://127.0.0.1:8001 (first request loads the model)');
} else {
  console.warn('[dev] ⚠  embeddings venv not found — judgment/statute search is keyword-only. See tools/embed-server/README.md.');
}

const pathKey = Object.keys(childEnv).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
childEnv[pathKey] = `${nodeDir}${isWin ? ';' : ':'}${childEnv[pathKey] ?? ''}`;

const corepackJs = join(nodeDir, 'node_modules', 'corepack', 'dist', 'corepack.js');
const execpath = process.env.npm_execpath;

/** Spawn `pnpm <args...>` the most reliable way available, no shell. */
function spawnPnpm(args) {
  if (existsSync(corepackJs)) {
    return spawn(process.execPath, [corepackJs, 'pnpm', ...args], {
      cwd: monorepo, stdio: 'inherit', shell: false, env: childEnv,
    });
  }
  if (execpath && existsSync(execpath)) {
    return spawn(process.execPath, [execpath, ...args], {
      cwd: monorepo, stdio: 'inherit', shell: false, env: childEnv,
    });
  }
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
  return spawn(pnpmCmd, args, { cwd: monorepo, stdio: 'inherit', shell: isWin, env: childEnv });
}

for (const pkg of ['@lexdraft/api', '@lexdraft/web']) {
  const proc = spawnPnpm(['--filter', pkg, 'dev']);
  proc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] ✗ ${pkg} exited (code ${code}). Shutting the stack down.`);
      shutdown(code ?? 1);
    }
  });
  children.push(proc);
}
console.log('[dev] ✓ web + API starting (web :5173, api :4000)');
