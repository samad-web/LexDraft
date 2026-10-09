// =============================================================================
// llm-drafting — the shared LLM call machinery for the drafting pipeline.
//
// This is the same provider-resolution + client + loose-JSON parsing proven in
// draft-extract.service.ts, lifted into one place so the multi-stage orchestrator
// (drafting-orchestrator.service.ts) reuses identical, battle-tested logic
// instead of a second copy. draft-extract.service.ts is intentionally left as-is
// to avoid churning a working path; new code should import from here.
//
// Nothing here throws for "AI is off" — callers check resolveProvider() === 'none'
// and degrade. The LLM call itself throws on transport/HTTP error (after retry);
// callers wrap it in try/catch and fall back, matching the existing pattern.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { withRetry } from './retry';
import { type NormalizedUsage } from './llm-usage';
import { claudeComplete } from './anthropic-client';
import { grokComplete } from './grok-client';

export type Provider = 'xai' | 'anthropic' | 'none';

export interface LlmResult extends NormalizedUsage {
  text: string;
}

/** An explicit override wins when its key is set; else the env default. */
export function resolveProvider(override?: 'xai' | 'anthropic'): Provider {
  if (override === 'xai' && env.XAI_API_KEY) return 'xai';
  if (override === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  return env.llmProvider;
}

export function providerTag(provider: Provider): string {
  if (provider === 'anthropic') return `anthropic:${env.ANTHROPIC_MODEL}`;
  if (provider === 'xai') return `xai:${env.XAI_MODEL}`;
  return 'fallback:none';
}

export function providerModel(provider: Provider): string {
  return provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL;
}

export async function complete(
  provider: Provider,
  system: string,
  user: string,
  maxTokens: number,
): Promise<LlmResult> {
  if (provider === 'anthropic') return callClaude(system, user, maxTokens);
  if (provider === 'xai') return callGrok(system, user, maxTokens);
  throw new Error('LLM disabled');
}

async function callClaude(system: string, user: string, maxTokens: number): Promise<LlmResult> {
  return withRetry(
    () => claudeComplete({ system, user, maxTokens }),
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'llm-drafting Claude retry') },
  );
}

async function callGrok(system: string, user: string, maxTokens: number): Promise<LlmResult> {
  return withRetry(
    () => grokComplete({ system, user, maxTokens }),
    { onRetry: (err, attempt, waitMs) => logger.warn({ err, attempt, waitMs }, 'llm-drafting Grok retry') },
  );
}

/** Pull a JSON object out of an LLM reply that may be wrapped in prose or a
 *  ```json fence. Returns null when nothing parses. */
export function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const fenced = raw.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
