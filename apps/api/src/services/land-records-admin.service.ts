/** Superadmin controls for Land Records (land-records-tn-gate.md). Audited. */
import { db } from '../db/client';
import { auditService } from './audit.service';

type Actor = { id: string; email: string };

export const landRecordsAdmin = {
  /** Platform switch; absent = on (Land Records was live for everyone before). */
  async enabled(): Promise<boolean> {
    const sql = db();
    if (!sql) return true;
    const [r] = await sql<{ value: { enabled?: boolean } }[]>`select value from platform_settings where key = 'land_records'`;
    return r?.value?.enabled !== false;
  },

  async setEnabled(enabled: boolean, actor: Actor): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`
      insert into platform_settings (key, value, updated_at, updated_by)
      values ('land_records', ${sql.json({ enabled })}, now(), ${actor.id})
      on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
    await auditService.write({ actorUserId: actor.id, actorEmail: actor.email, action: 'platform.land_records.set', targetType: 'platform', targetId: null, payload: { enabled } });
  },

  /** 'on' = this firm gets it whatever the state; 'off' = never; null = follow the rules. */
  async setFirm(firmId: string, mode: 'on' | 'off' | null, actor: Actor): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql`update firms set land_records = ${mode} where id = ${firmId}::uuid returning id`;
    if (!rows.length) return false;
    await auditService.write({ actorUserId: actor.id, actorEmail: actor.email, action: 'firm.land_records.set', targetType: 'firm', targetId: firmId, payload: { mode } });
    return true;
  },
};
