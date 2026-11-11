// =============================================================================
// claude-code-dev — DEVELOPMENT-ONLY Claude provider through the local Claude
// Code CLI (`claude -p`, the Agent SDK's engine) on the developer's own Claude
// login, so drafting can be tested and tuned with the real model when there is no
// API credit. Same model ids as production (claude-sonnet-5-5 / -haiku-5-5).
//
// Never in production: Anthropic's terms require an API key for a product that
// serves users, so devViaClaudeCode() is false whenever NODE_ENV=production.
//
// Each call: a fresh empty temp dir (no CLAUDE.md / project memory leaks into the
// prompt), no tools, no MCP, no settings, no session saved; the system prompt goes
// in a file (Windows command lines cap at ~32k chars), the user turn on stdin.
// ANTHROPIC_API_KEY is removed from the child env so the CLI uses the login.
// =============================================================================

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../env';
import { anthropicUsage, type NormalizedUsage } from './llm-usage';

/** Only in development: never production (terms), never tests (they script fetch). */
export function devViaClaudeCode(): boolean {
  return env.LLM_DEV_VIA_CLAUDE_CODE === 'true' && env.NODE_ENV === 'development';
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

const TIMEOUT_MS = 10 * 60 * 1000;

/** CLAUDE_CODE_BIN, or - when a VS Code extension update moved it - the newest
 *  installed extension's binary, so testing doesn't break on every update. */
export function claudeBin(configured = env.CLAUDE_CODE_BIN, extDir = join(homedir(), '.vscode', 'extensions')): string {
  if (existsSync(configured)) return configured;
  let dirs: string[] = [];
  try { dirs = readdirSync(extDir).filter((d) => d.startsWith('anthropic.claude-code-')); } catch { /* no VS Code */ }
  dirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const d of dirs) {
    const bin = join(extDir, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (existsSync(bin)) return bin;
  }
  return configured;
}

export async function claudeCodeComplete(opts: {
  system: string;
  user: string;
  model: string;
  /** PDF / image content blocks, sent ahead of the user text. */
  attachments?: unknown[];
  /** Same meaning as the API's output_config.effort. Omitted = CLI default. */
  effort?: 'low' | 'medium' | 'high';
}): Promise<{ text: string } & NormalizedUsage> {
  const dir = mkdtempSync(join(tmpdir(), 'difai-cc-'));
  const systemFile = join(dir, 'system.txt');
  writeFileSync(systemFile, opts.system, 'utf8');
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  // Only the CLI's stream-json input carries non-text blocks.
  const streaming = Boolean(opts.attachments?.length);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(claudeBin(), [
        '-p', '--model', opts.model,
        ...(opts.effort ? ['--effort', opts.effort] : []),
        '--system-prompt-file', systemFile,
        '--tools', '',
        '--output-format', streaming ? 'stream-json' : 'json',
        ...(streaming ? ['--input-format', 'stream-json', '--verbose'] : []),
        '--no-session-persistence',
        '--setting-sources', '',
        '--strict-mcp-config',
        '--disable-slash-commands',
      ], { cwd: dir, env: childEnv, windowsHide: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('claude-code-dev: timed out')); }, TIMEOUT_MS);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`claude-code-dev: exit ${code}: ${(err || out).slice(0, 300)}`));
      });
      child.stdin.end(streaming
        ? `${JSON.stringify({ type: 'user', message: { role: 'user', content: [...opts.attachments!, { type: 'text', text: opts.user }] } })}\n`
        : opts.user);
    });
    const parsed = JSON.parse(streaming ? stdout.split('\n').filter((l) => l.includes('"type":"result"')).pop() ?? '{}' : stdout) as CliResult;
    if (parsed.is_error) throw new Error(`claude-code-dev: ${String(parsed.result).slice(0, 300)}`);
    const u = parsed.usage ?? {};
    return {
      text: parsed.result ?? '',
      ...anthropicUsage({
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cache_read_input_tokens: u.cache_read_input_tokens,
        cache_creation_input_tokens: u.cache_creation_input_tokens,
      }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
