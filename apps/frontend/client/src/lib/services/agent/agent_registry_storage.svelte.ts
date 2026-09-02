// apps/frontend/client/src/lib/services/agent/agent_registry_storage.svelte.ts
//
// Local SQLite-backed custom agent repository. Replaces the Firestore
// `agent_definitions` collection with plain typed queries against the local
// `custom_agents` table. `folder` is an explicit column because
// listAgents({ folder }) filters on it today.
//
// Contract: C-386b — Firestore Removal, custom agents local-first.
// biome-ignore-all lint/style/useNamingConvention: SQL column names are snake_case

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { CustomAgentDefinition } from '$types';
import { emulatorSeedService } from '../storage/emulator_seed_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRegistryStorageOptions = BaseFrontendClassOptions;

export type AgentRegistryStorageInterface = BaseFrontendClassInterface & {
  /** Creates a new custom agent definition. */
  createAgent(definition: CustomAgentDefinition): Promise<CustomAgentDefinition>;

  /** Updates an existing custom agent. */
  updateAgent(definition: CustomAgentDefinition): Promise<CustomAgentDefinition>;

  /** Deletes a custom agent by ID. */
  deleteAgent(options: { id: string }): Promise<void>;

  /** Gets a single custom agent definition. */
  getAgent(options: { id: string }): Promise<CustomAgentDefinition | undefined>;

  /** Lists custom agents, optionally filtered by folder. */
  listAgents(options?: { folder?: string }): Promise<CustomAgentDefinition[]>;
};

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type CustomAgentRow = {
  id: string;
  name: string;
  folder: string | null;
  data: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AgentRegistryStorage
  extends BaseFrontendClass<AgentRegistryStorageOptions>
  implements AgentRegistryStorageInterface
{
  /** @inheritdoc */
  async createAgent(definition: CustomAgentDefinition): Promise<CustomAgentDefinition> {
    await this._upsert(definition);
    this.debug('createAgent:done', { id: definition.id, name: definition.name });
    return definition;
  }

  /** @inheritdoc */
  async updateAgent(definition: CustomAgentDefinition): Promise<CustomAgentDefinition> {
    await this._upsert(definition);
    this.debug('updateAgent:done', { id: definition.id });
    return definition;
  }

  /** @inheritdoc */
  async deleteAgent(options: { id: string }): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM custom_agents WHERE id = ?',
      args: [options.id],
    });
    this.debug('deleteAgent:done', { id: options.id });
  }

  /** @inheritdoc */
  async getAgent(options: { id: string }): Promise<CustomAgentDefinition | undefined> {
    await emulatorSeedService.seedIfEmpty();
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM custom_agents WHERE id = ? LIMIT 1',
      args: [options.id],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return this._parseAgent(result.rows[0] as unknown as CustomAgentRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
  }

  /** @inheritdoc */
  async listAgents(options?: { folder?: string }): Promise<CustomAgentDefinition[]> {
    await emulatorSeedService.seedIfEmpty();
    const db = await getLocalDatabase();
    const result = options?.folder
      ? await db.query({
          sql: 'SELECT * FROM custom_agents WHERE folder = ? ORDER BY created_at ASC',
          args: [options.folder],
        })
      : await db.query({
          sql: 'SELECT * FROM custom_agents ORDER BY created_at ASC',
          args: [],
        });

    const agents: CustomAgentDefinition[] = [];
    for (const row of result.rows) {
      const agent = this._parseAgent(row as unknown as CustomAgentRow); // guard-ignore lint/type-safety/casting: DB row parsing - Turso query returns unknown rows, schema validated at insert time
      if (agent) {
        agents.push(agent);
      }
    }
    return agents;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async _upsert(definition: CustomAgentDefinition): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR REPLACE INTO custom_agents (id, name, folder, data, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [definition.id, definition.name, definition.folder ?? null, JSON.stringify(definition)],
    });
  }

  private _parseAgent(row: CustomAgentRow): CustomAgentDefinition | undefined {
    try {
      const parsed = JSON.parse(row.data) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      return parsed as CustomAgentDefinition;
    } catch {
      return undefined;
    }
  }
}

/** Shared singleton instance. */
export const agentRegistryStorage: AgentRegistryStorageInterface = AgentRegistryStorage.create({
  className: 'AgentRegistryStorage',
});
