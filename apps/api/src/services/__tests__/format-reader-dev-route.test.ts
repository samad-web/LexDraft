import { describe, expect, it, vi } from 'vitest';

// A Word/text format must be read through the local Claude Code route in dev
// (the API account may have no credit): the API client must not be touched.
const stream = vi.fn();
vi.mock('../../lib/claude-code-dev', () => ({
  devViaClaudeCode: () => true,
  claudeCodeComplete: vi.fn(async () => ({
    text: '```json\n{"title":"Deed of Partition","is_legal_format":true,"fields":[],"blocks":[]}\n```',
    tokensIn: 1, tokensOut: 1,
  })),
}));
vi.mock('../../lib/anthropic-client', () => ({ anthropic: () => ({ beta: { messages: { stream } } }), usageFrom: () => ({}) }));
vi.mock('../engine-client.service', () => ({
  engineClient: {
    formatContract: async () => ({ system_prompt: 's', schema: {}, existing: [], common_keys: [] }),
    checkSpec: async () => ({ ok: true, problems: [], preview: [] }),
  },
}));

import { formatReader } from '../format-reader.service';

describe('format reader — dev route', () => {
  it('reads a text format via Claude Code, not the API, and parses a fenced reply', async () => {
    const r = await formatReader.read({ fileName: 'deed.txt', mime: 'text/plain', data: Buffer.from('DEED OF PARTITION ____') });
    expect(r.title).toBe('Deed of Partition');
    expect(stream).not.toHaveBeenCalled();
  });
});
