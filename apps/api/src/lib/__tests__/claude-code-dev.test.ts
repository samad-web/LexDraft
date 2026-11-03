import { describe, expect, it } from 'vitest';
import { env } from '../../env';
import { devViaClaudeCode } from '../claude-code-dev';

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
