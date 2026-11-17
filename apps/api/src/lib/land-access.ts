/**
 * Who may use Land Records (build-docs/features/land-records-tn-gate.md).
 * It reads Tamil Nadu's eServices site only, so it is for TN advocates; the
 * superadmin can switch it off for everyone or override it per firm.
 */
import type { LandAccess } from '@lexdraft/types';
import { db } from '../db/client';
import { HttpError } from './errors';

export function isTamilNadu(state: string | null | undefined): boolean {
  const s = (state ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return s === 'tamilnadu' || s === 'tn';
}

/** The rule itself, without the database (see the feature doc, steps 1-5). */
export function decideLandAccess(i: { platformOn: boolean; firmMode: 'on' | 'off' | null; state: string | null }): LandAccess['status'] {
  if (!i.platformOn) return 'disabled';
  if (i.firmMode === 'off') return 'disabled';
  if (i.firmMode === 'on') return 'available';
  if (isTamilNadu(i.state)) return 'available';
  if (!i.state || !i.state.trim()) return 'state_required';
  return 'coming_soon';
}

export async function landAccessFor(userId: string): Promise<LandAccess> {
  const sql = db();
  if (!sql) return { status: 'available', state: null };
  const [[setting], [u]] = await Promise.all([
    sql<{ value: { enabled?: boolean } }[]>`select value from platform_settings where key = 'land_records'`,
    sql<{ state: string | null; land_records: 'on' | 'off' | null }[]>`
      select u.state, f.land_records from users u left join firms f on f.id = u.firm_id where u.id = ${userId}::uuid`,
  ]);
  const state = u?.state?.trim() || null;
  return {
    status: decideLandAccess({ platformOn: setting?.value?.enabled !== false, firmMode: u?.land_records ?? null, state }),
    state,
  };
}

const REFUSALS: Record<Exclude<LandAccess['status'], 'available'>, (state: string | null) => string> = {
  disabled: () => 'Land Records is switched off for now.',
  state_required: () => 'Tell us which state you practise in to use Land Records.',
  coming_soon: (state) => `Land Records for ${state ?? 'your state'} is coming soon. It is available for Tamil Nadu advocates today.`,
};

/** Throws 403 unless this user may use Land Records. */
export async function assertLandAccess(userId: string): Promise<void> {
  const a = await landAccessFor(userId);
  if (a.status === 'available') return;
  const code = a.status === 'disabled' ? 'land_records_disabled' : a.status === 'coming_soon' ? 'land_records_coming_soon' : 'state_required';
  throw new HttpError(403, REFUSALS[a.status](a.state), { code, details: a });
}
