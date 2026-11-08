import { describe, expect, it, vi } from 'vitest';

// A Word/text format must be read through the local Claude Code route in dev
// (the API account may have no credit): the API client must not be touched.
const stream = vi.fn();
const { complete, viaCli } = vi.hoisted(() => ({
  viaCli: { on: true },
  complete: vi.fn(async (_opts: { user: string; attachments?: Array<{ type: string }> }) => ({
    text: '```json\n{"title":"Deed of Partition","is_legal_format":true,"fields":[],"blocks":[]}\n```',
    tokensIn: 1, tokensOut: 1,
  })),
}));
vi.mock('../../lib/claude-code-dev', () => ({ devViaClaudeCode: () => viaCli.on, claudeCodeComplete: complete }));
const { compat, openAi } = vi.hoisted(() => ({ compat: { vendor: 'xai' }, openAi: vi.fn() }));
vi.mock('../../env', async (orig) => {
  const m = await orig<typeof import('../../env')>();
  return { ...m, env: { ...m.env, ANTHROPIC_API_KEY: 'k', XAI_API_KEY: 'k', XAI_MODEL: 'gpt-test', openaiCompat: compat } };
});
vi.mock('../../lib/grok-client', () => ({ grok: () => ({ chat: { completions: { create: openAi } } }), outputLimit: () => ({}) }));
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

  it.each([
    ['deed.pdf', 'application/pdf', 'document'],
    ['deed.jpg', 'image/jpeg', 'image'],
  ])('reads %s via Claude Code too, as an attachment, not the API', async (fileName, mime, type) => {
    const r = await formatReader.read({ fileName, mime, data: Buffer.from('x') });
    expect(r.title).toBe('Deed of Partition');
    expect(complete.mock.lastCall![0].attachments!.map((b) => b.type)).toEqual([type]);
    expect(stream).not.toHaveBeenCalled();
  });

  it('never shows the provider billing text when a PDF cannot be read', async () => {
    viaCli.on = false;
    stream.mockReturnValueOnce({ finalMessage: () => Promise.reject(new Error('Your credit balance is too low')) });
    const read = formatReader.read({ fileName: 'deed.pdf', mime: 'application/pdf', data: Buffer.from('%PDF') });
    await expect(read).rejects.toMatchObject({ name: 'FormatReadError', status: 503, message: expect.not.stringMatching(/credit|balance/i) });
    expect(openAi).not.toHaveBeenCalled(); // xAI cannot read a PDF
  });

  const noCredit = () => stream.mockReturnValueOnce({ finalMessage: () => Promise.reject(new Error('Your credit balance is too low')) });

  it.each([
    ['deed.pdf', 'application/pdf', 'file'],
    ['deed.jpg', 'image/jpeg', 'image_url'],
  ])('reads %s on OpenAI when the Anthropic read fails', async (fileName, mime, part) => {
    compat.vendor = 'openai';
    noCredit();
    openAi.mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"title":"Deed","fields":[],"blocks":[]}' } }], usage: {} });
    const r = await formatReader.read({ fileName, mime, data: Buffer.from('x') });
    expect(r.title).toBe('Deed');
    expect(r.usage.model).toBe('gpt-test');
    expect(openAi.mock.lastCall![0].messages[1].content[0].type).toBe(part);
  });

  it('shows only the plain message when OpenAI fails as well', async () => {
    compat.vendor = 'openai';
    noCredit();
    openAi.mockRejectedValueOnce(new Error('You exceeded your current quota'));
    const read = formatReader.read({ fileName: 'deed.pdf', mime: 'application/pdf', data: Buffer.from('x') });
    await expect(read).rejects.toMatchObject({ name: 'FormatReadError', status: 503, message: expect.not.stringMatching(/quota|credit/i) });
  });

  it('says too long when OpenAI runs out of room', async () => {
    compat.vendor = 'openai';
    noCredit();
    openAi.mockResolvedValueOnce({ choices: [{ finish_reason: 'length', message: { content: '{' } }], usage: {} });
    await expect(formatReader.read({ fileName: 'deed.pdf', mime: 'application/pdf', data: Buffer.from('x') })).rejects.toThrow(/too long/);
  });
});
