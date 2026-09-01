// apps/frontend/client/src/lib/services/npc/npc_storage.svelte.ts
//
// Local SQLite-backed NPC repository. Replaces the Firestore `npcs`
// collection with plain typed queries against the local `npcs` table.
// NPCs are per-install — no ownership columns (OQ3: no catalog exists to
// own or filter against). creatorUid/visibility fold into the data payload.
//
// Contract: C-386b — Firestore Removal, NPCs local-first.
// biome-ignore-all lint/style/useNamingConvention: SQL column names are snake_case

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { NpcCreateData, NpcData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { emulatorSeedService } from '../storage/emulator_seed_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NpcStorageOptions = BaseFrontendClassOptions;

export type NpcStorageInterface = BaseFrontendClassInterface & {
  /** Retrieves all NPCs. */
  getSystemNpcs(): Promise<NpcData[]>;

  /** Retrieves all NPCs (per-install — uid accepted for API parity). */
  getUserNpcs(options: { uid: string }): Promise<NpcData[]>;

  /** Retrieves all public NPCs (visibility = 'public'). */
  getPublicNpcs(): Promise<NpcData[]>;

  /** Retrieves a single NPC by ID. */
  get(options: { npcId: string }): Promise<NpcData | undefined>;

  /** Creates a new NPC. */
  createNpc(options: { data: Partial<NpcCreateData>; uid: string }): Promise<string>;

  /** Updates an existing NPC. */
  updateNpc(options: { npcId: string; data: Partial<NpcData> }): Promise<void>;

  /** Deletes an NPC. */
  deleteNpc(options: { npcId: string }): Promise<void>;

  /** Forks a system NPC to create a copy. */
  forkNpc(options: { systemNpcId: string; uid: string }): Promise<string>;
};

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type NpcRow = {
  id: string;
  name: string;
  data: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class NpcStorage extends BaseFrontendClass<NpcStorageOptions> implements NpcStorageInterface {
  /** @inheritdoc */
  async getSystemNpcs(): Promise<NpcData[]> {
    await emulatorSeedService.seedIfEmpty();
    return await this._getAll();
  }

  /** @inheritdoc */
  async getUserNpcs(_options: { uid: string }): Promise<NpcData[]> {
    return await this._getAll();
  }

  /** @inheritdoc */
  async getPublicNpcs(): Promise<NpcData[]> {
    const npcs = await this._getAll();
    return npcs.filter((npc) => npc.visibility === 'public');
  }

  /** @inheritdoc */
  async get(options: { npcId: string }): Promise<NpcData | undefined> {
    const { npcId } = options;
    await emulatorSeedService.seedIfEmpty();
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM npcs WHERE id = ? LIMIT 1',
      args: [npcId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return this._parseNpc(result.rows[0] as unknown as NpcRow);
  }

  /** @inheritdoc */
  async createNpc(options: { data: Partial<NpcCreateData>; uid: string }): Promise<string> {
    const { data, uid } = options;

    const npcId = crypto.randomUUID();
    const npcData: NpcData = {
      ...(data as NpcData),
      id: npcId,
      creatorUid: uid,
      visibility: data.visibility ?? 'private',
      createdAt: (data as Record<string, unknown>).createdAt ?? new Date(),
      updatedAt: (data as Record<string, unknown>).updatedAt ?? new Date(),
    } as NpcData;

    const db = await getLocalDatabase();
    await db.execute({
      sql: "INSERT OR REPLACE INTO npcs (id, name, data, updated_at) VALUES (?, ?, ?, datetime('now'))",
      args: [npcId, npcData.name ?? 'Unnamed', JSON.stringify(npcData)],
    });

    this.log('createNpc:success', { npcId });
    return npcId;
  }

  /** @inheritdoc */
  async updateNpc(options: { npcId: string; data: Partial<NpcData> }): Promise<void> {
    const { npcId, data } = options;
    const existing = await this.get({ npcId });
    const merged = { ...existing, ...data, id: npcId } as NpcData;

    const db = await getLocalDatabase();
    await db.execute({
      sql: "INSERT OR REPLACE INTO npcs (id, name, data, updated_at) VALUES (?, ?, ?, datetime('now'))",
      args: [npcId, merged.name ?? 'Unnamed', JSON.stringify(merged)],
    });
  }

  /** @inheritdoc */
  async deleteNpc(options: { npcId: string }): Promise<void> {
    const { npcId } = options;
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM npcs WHERE id = ?',
      args: [npcId],
    });
  }

  /** @inheritdoc */
  async forkNpc(options: { systemNpcId: string; uid: string }): Promise<string> {
    const { systemNpcId, uid } = options;

    const systemNpc = await this.get({ npcId: systemNpcId });
    if (!systemNpc) {
      throw toAppError({ errorType: 'not-found', errorMessage: 'System NPC not found' });
    }

    const {
      id: _originalId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...npcDataWithoutId
    } = systemNpc;
    return await this.createNpc({
      data: {
        ...npcDataWithoutId,
        forkedFromNpcId: systemNpcId,
      } as Partial<NpcCreateData>,
      uid,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async _getAll(): Promise<NpcData[]> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM npcs ORDER BY updated_at DESC',
      args: [],
    });
    const npcs: NpcData[] = [];
    for (const row of result.rows) {
      const npc = this._parseNpc(row as unknown as NpcRow);
      if (npc) {
        npcs.push(npc);
      }
    }
    return npcs;
  }

  private _parseNpc(row: NpcRow): NpcData | undefined {
    try {
      const parsed = JSON.parse(row.data) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      return parsed as NpcData;
    } catch {
      return undefined;
    }
  }
}

/** Shared singleton instance. */
export const npcStorage: NpcStorageInterface = NpcStorage.create({
  className: 'NpcStorage',
});
