import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The SDKs call global fetch: script each response, record which host was hit.
const calls: Array<{ host: string; key: string }> = [];
let replies: Array<(url: string) => { status: number; body: unknown }> = [];

const credit = () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } });
const claudeOk = (text: string) => () => ({ status: 200, body: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } });
const grokOk = (text: string) => () => ({ status: 200, body: { id: 'c', object: 'chat.completion', created: 1, model: 'grok-4', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });

beforeEach(() => {
  calls.length = 0;
  replies = [];
  vi.resetModules();
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ host: new URL(url).host, key: h.get('x-api-key') ?? h.get('authorization') ?? '' });
    const next = replies.shift();
    if (!next) throw new Error('unscripted fetch');
    const r = next(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => vi.unstubAllGlobals());

// resetModules() gives the client a fresh env module: configure THAT one.
async function setEnv(over: Partial<Record<'ANTHROPIC_API_KEY' | 'ANTHROPIC_API_KEYS' | 'XAI_API_KEY' | 'LLM_FAILOVER', string>>) {
  const { env } = await import('../../env');
  Object.assign(env as Record<string, unknown>, { ANTHROPIC_API_KEY: 'sk-a', ANTHROPIC_API_KEYS: '', XAI_API_KEY: '', LLM_FAILOVER: 'true', ...over });
}

// Each test re-imports the client (resetModules): slow under a loaded CPU.
describe('anthropic-client — key pool and failover', { timeout: 20_000 }, () => {
  it('moves to the next Anthropic key when one is out of credit', async () => {
    await setEnv({ ANTHROPIC_API_KEYS: 'sk-b' });
    replies = [credit, claudeOk('from key b')];
    const { claudeComplete } = await import('../anthropic-client');
    const r = await claudeComplete({ system: 's', user: 'u', maxTokens: 10 });
    expect(r.text).toBe('from key b');
    expect(r.servedBy).toBeUndefined();
    expect(calls.map((c) => c.key)).toEqual(['sk-a', 'sk-b']);
  });

  it('answers from xAI when every Anthropic key is out of credit, and says so', async () => {
    await setEnv({ XAI_API_KEY: 'xai-k' });
    replies = [credit, grokOk('from grok')];
    const { claudeComplete } = await import('../anthropic-client');
    const r = await claudeComplete({ system: 's', user: 'u', maxTokens: 10 });
    expect(r.text).toBe('from grok');
    expect(r.servedBy).toMatch(/^xai:/);
    expect(calls.map((c) => c.host)).toEqual(['api.anthropic.com', 'api.x.ai']);
  });

  it('fails as before when failover is off', async () => {
    await setEnv({ XAI_API_KEY: 'xai-k', LLM_FAILOVER: 'false' });
    replies = [credit];
    const { claudeComplete } = await import('../anthropic-client');
    await expect(claudeComplete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow(/credit/);
  });

  it('does not fail over on an ordinary bad request', async () => {
    await setEnv({ XAI_API_KEY: 'xai-k' });
    replies = [() => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } } })];
    const { claudeComplete } = await import('../anthropic-client');
    await expect(claudeComplete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow(/max_tokens/);
    expect(calls).toHaveLength(1);
  });

  it('does NOT hand a draft to Grok on a transient 529 — the caller retries Claude', async () => {
    await setEnv({ XAI_API_KEY: 'xai-k' });
    replies = [() => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } })];
    const { claudeComplete } = await import('../anthropic-client');
    await expect(claudeComplete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow(/529/);
    expect(calls.map((c) => c.host)).toEqual(['api.anthropic.com']);
  });

  it('withKeys (used by the intake reader) rotates past an out-of-credit key', async () => {
    await setEnv({ ANTHROPIC_API_KEYS: 'sk-b' });
    replies = [credit, claudeOk('intake via key b')];
    const { withKeys } = await import('../anthropic-client');
    const msg = await withKeys((c) => c.messages.create({ model: 'm', max_tokens: 5, messages: [{ role: 'user', content: 'u' }] }));
    expect((msg.content[0] as { text: string }).text).toBe('intake via key b');
    expect(calls.map((c) => c.key)).toEqual(['sk-a', 'sk-b']);
  });
});
