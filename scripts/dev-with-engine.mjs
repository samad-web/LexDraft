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
import { existsSync, readFileSync } from 'node:fs';
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
