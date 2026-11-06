import { describe, expect, it } from 'vitest';
import { env } from '../../env';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeBin, devViaClaudeCode } from '../claude-code-dev';

describe('claude-code-dev — development only', () => {
  it('is on only when enabled AND not in production', () => {
    const e = env as Record<string, unknown>;
    const saved = { NODE_ENV: e.NODE_ENV, LLM_DEV_VIA_CLAUDE_CODE: e.LLM_DEV_VIA_CLAUDE_CODE };
    try {
      Object.assign(e, { NODE_ENV: 'development', LLM_DEV_VIA_CLAUDE_CODE: 'true' });
      expect(devViaClaudeCode()).toBe(true);
      Object.assign(e, { NODE_ENV: 'production', LLM_DEV_VIA_CLAUDE_CODE: 'true' });
      expect(devViaClaudeCode()).toBe(false);
      Object.assign(e, { NODE_ENV: 'test', LLM_DEV_VIA_CLAUDE_CODE: 'true' });
      expect(devViaClaudeCode()).toBe(false);
      Object.assign(e, { NODE_ENV: 'development', LLM_DEV_VIA_CLAUDE_CODE: 'false' });
      expect(devViaClaudeCode()).toBe(false);
    } finally {
      Object.assign(e, saved);
    }
  });
});

describe('claude-code-dev — binary path', () => {
  it('falls back to the newest extension when an update moved the configured binary', () => {
    const ext = mkdtempSync(join(tmpdir(), 'cc-ext-'));
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    for (const v of ['2.1.9', '2.1.318']) {
      mkdirSync(join(ext, `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary'), { recursive: true });
      writeFileSync(join(ext, `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary', exe), '');
    }
    const gone = join(ext, 'anthropic.claude-code-2.1.314-win32-x64', 'resources', 'native-binary', exe);
    expect(claudeBin(gone, ext)).toContain('2.1.318');
    const kept = join(ext, 'anthropic.claude-code-2.1.9-win32-x64', 'resources', 'native-binary', exe);
    expect(claudeBin(kept, ext)).toBe(kept);
  });
});
