// apps/frontend/client/src/lib/services/npc/npc_schedule_repository.svelte.ts
//
// Turso/libSQL-backed repository for NPC schedule persistence.
// Replaces Firestore with the local SQLite database via LocalDatabaseInterface.
// Contract: C-248 Autonomous NPC Behavior Schedules

import { getLocalDatabase } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { NpcSchedule } from '@aikami/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NpcScheduleRepositoryInterface = BaseFrontendClassInterface & {
  /** Persists a schedule (upsert by NPC ID). */
  upsert(options: { npcId: string; schedule: NpcSchedule }): Promise<void>;
  /** Retrieves a schedule by NPC ID, or undefined if not found. */
  getByNpcId(npcId: string): Promise<NpcSchedule | undefined>;
  /** Deletes a schedule by NPC ID. */
  delete(npcId: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Repository Implementation
// ---------------------------------------------------------------------------

class NpcScheduleRepository
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements NpcScheduleRepositoryInterface
{
  /** @inheritdoc */
  async upsert(options: { npcId: string; schedule: NpcSchedule }): Promise<void> {
    const db = await getLocalDatabase();
    const data = JSON.stringify(options.schedule);

    await db.execute({
      sql: 'INSERT OR REPLACE INTO npc_schedules (npc_id, data, updated_at) VALUES (?, ?, ?)',
      args: [options.npcId, data, options.schedule.updatedAt],
    });
  }

  /** @inheritdoc */
  async getByNpcId(npcId: string): Promise<NpcSchedule | undefined> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT data FROM npc_schedules WHERE npc_id = ?',
      args: [npcId],
    });

    if (result.rows.length === 0) {
      return undefined;
    }

    return JSON.parse(result.rows[0].data as string) as NpcSchedule;
  }

  /** @inheritdoc */
  async delete(npcId: string): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM npc_schedules WHERE npc_id = ?',
      args: [npcId],
    });
  }
}

/** Shared singleton instance. */
export const npcScheduleRepository: NpcScheduleRepositoryInterface = NpcScheduleRepository.create({
  className: 'NpcScheduleRepository',
});
