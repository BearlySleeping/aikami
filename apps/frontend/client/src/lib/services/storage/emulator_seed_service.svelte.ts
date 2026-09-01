// apps/frontend/client/src/lib/services/storage/emulator_seed_service.svelte.ts
//
// Seeds the local SQLite tables with emulator fixtures (personas, NPCs,
// custom agents) when the app boots in emulator mode. The Firebase emulator
// cannot reach the browser's OPFS-backed database, so the seeding strategy
// moved client-side: `on_emulate.ts` creates Auth users; this service fills
// the local tables on first boot so a developer (or E2E run) lands in a
// playable game.
//
// Contract: C-386b/C-386c — Firestore Removal, emulator reseeding (AC-11).
// biome-ignore-all lint/style/useNamingConvention: SQL column names are snake_case

import { getPublicMode } from '@aikami/frontend/configs';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import { EMULATOR_GOOGLE_PERSONA_DATA, EMULATOR_NPCS, EMULATOR_PERSONA_DATA } from '@aikami/mocks';
import type { NpcCreateData, PersonaData } from '@aikami/types';
import type { CustomAgentDefinition } from '$types';

export type EmulatorSeedServiceOptions = BaseFrontendClassOptions & {
  /** Force reseeding even if the tables already have rows (tests). */
  force?: boolean;
};

export type EmulatorSeedServiceInterface = BaseFrontendClassInterface & {
  /** Seeds personas/NPCs/custom agents if their tables are empty. */
  seedIfEmpty(): Promise<void>;
};

class EmulatorSeedService
  extends BaseFrontendClass<EmulatorSeedServiceOptions>
  implements EmulatorSeedServiceInterface
{
  /** @inheritdoc */
  async seedIfEmpty(): Promise<void> {
    // Emulator-only: the browser local DB is per-install and the emulator
    // process cannot reach it, so seeding is client-side. In unit tests
    // (PUBLIC_MODE=testing) the fake DB must NOT be seeded — repositories
    // call this on first read, so gate strictly on emulator mode.
    if (getPublicMode() !== 'emulator') {
      return;
    }

    const db = await getLocalDatabase();

    const personaCount = await db.query({ sql: 'SELECT COUNT(*) AS n FROM personas', args: [] });
    if (Number(personaCount.rows[0]?.n ?? 0) === 0 || this._options.force) {
      await this._seedPersonas();
    }

    const npcCount = await db.query({ sql: 'SELECT COUNT(*) AS n FROM npcs', args: [] });
    if (Number(npcCount.rows[0]?.n ?? 0) === 0 || this._options.force) {
      await this._seedNpcs();
    }

    const agentCount = await db.query({
      sql: 'SELECT COUNT(*) AS n FROM custom_agents',
      args: [],
    });
    if (Number(agentCount.rows[0]?.n ?? 0) === 0 || this._options.force) {
      await this._seedCustomAgent();
    }

    this.debug('seedIfEmpty:complete');
  }

  // ── Private seeders ─────────────────────────────────────────────────

  private async _seedPersonas(): Promise<void> {
    const db = await getLocalDatabase();
    const now = new Date().toISOString();

    const personas: PersonaData[] = [
      {
        id: 'emulator-persona',
        name: EMULATOR_PERSONA_DATA.name ?? 'Test User',
        ...(EMULATOR_PERSONA_DATA as object),
        isActive: false,
      } as PersonaData,
      {
        id: 'emulator-google-persona',
        name: EMULATOR_GOOGLE_PERSONA_DATA.name ?? 'Aragorn',
        ...(EMULATOR_GOOGLE_PERSONA_DATA as object),
        isActive: true,
      } as PersonaData,
    ];

    for (const persona of personas) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO personas (id, name, is_active, data, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          persona.id,
          persona.name ?? 'Unnamed',
          persona.isActive ? 1 : 0,
          JSON.stringify(persona),
          now,
        ],
      });
    }
    this.debug('_seedPersonas:seeded', { count: personas.length });
  }

  private async _seedNpcs(): Promise<void> {
    const db = await getLocalDatabase();

    for (const npc of EMULATOR_NPCS) {
      const id = npc.name.toLowerCase().replace(/\s+/g, '-');
      const data = {
        ...(npc as NpcCreateData),
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as NpcCreateData & { id: string; updatedAt: Date };
      await db.execute({
        sql: "INSERT OR REPLACE INTO npcs (id, name, data, updated_at) VALUES (?, ?, ?, datetime('now'))",
        args: [id, data.name ?? 'Unnamed', JSON.stringify(data)],
      });
    }
    this.debug('_seedNpcs:seeded', { count: EMULATOR_NPCS.length });
  }

  private async _seedCustomAgent(): Promise<void> {
    const db = await getLocalDatabase();
    const now = new Date().toISOString();

    const agent: CustomAgentDefinition = {
      formatVersion: '1.0.0',
      type: 'agent_definition',
      id: 'emulator-storyteller',
      name: 'Emulator Storyteller',
      description: 'Seeded agent for emulator development.',
      folder: undefined,
      phase: 'post',
      promptTemplate: 'You are a storyteller. Summarize the recent events in 2-3 vivid sentences.',
      outputSchema: {},
      resultType: 'custom',
      connectionId: undefined,
      timeout: 15_000,
      enabled: true,
      isBuiltIn: false,
      uid: 'emulator-admin',
      createdAt: now,
      updatedAt: now,
    };

    await db.execute({
      sql: `INSERT OR REPLACE INTO custom_agents (id, name, folder, data, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [agent.id, agent.name, null, JSON.stringify(agent), now],
    });
    this.debug('_seedCustomAgent:seeded', { id: agent.id });
  }
}

/** Shared singleton instance. */
export const emulatorSeedService: EmulatorSeedServiceInterface = EmulatorSeedService.create({
  className: 'EmulatorSeedService',
});
