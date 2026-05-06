import type { Alert, Case, DocumentRecord, Hearing, TaskBoard } from '@lexdraft/types';

// =============================================================================
// In-memory fallback data — used only when DATABASE_URL is blank, so services
// have something to fall back to. All sample/dummy entries have been removed.
// =============================================================================

export const SEED_CASES: Case[] = [];
export const SEED_HEARINGS: Hearing[] = [];
export const SEED_ALERTS: Alert[] = [];
export const SEED_DOCS: DocumentRecord[] = [];
export const SEED_TASKS: TaskBoard = {
  pending: [],
  progress: [],
  review: [],
  done: [],
};
