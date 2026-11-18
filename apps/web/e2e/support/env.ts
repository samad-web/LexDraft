import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = join(here, '..', '..');
export const AUTH_DIR = join(WEB_DIR, 'e2e', '.auth');
export const AUTH_FILE = join(AUTH_DIR, 'state.json');
/** Features + firm of the signed-in account, written by auth.setup.ts. */
export const SESSION_FILE = join(AUTH_DIR, 'session.json');
/** Written by auth.setup.ts; while it exists the local DB may hold E2E-* rows. */
export const DIRTY_FILE = join(AUTH_DIR, 'needs-cleanup');

// apps/web/.env.e2e (gitignored) holds the advocate's own local account.
const envFile = join(WEB_DIR, '.env.e2e');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

/** Every test row is named with this prefix; global teardown deletes them. */
export const E2E_PREFIX = 'E2E-';

export function credentials(): { email: string; password: string } {
  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD in apps/web/.env.e2e (see .env.e2e.example).');
  }
  return { email, password };
}

/** The suite writes data, so it must never point at Supabase or prod. */
export function assertLocal(url: string, what: string): void {
  const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`${what} is ${host}, not localhost. The E2E suite only runs against the local stack.`);
  }
}

export interface E2ESession {
  features: string[];
  isSuperadmin: boolean;
}

export function readSession(): E2ESession {
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as E2ESession;
}

export function uniqueName(label: string): string {
  return `${E2E_PREFIX}${label}-${Date.now().toString(36)}`;
}
