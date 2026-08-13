// apps/frontend/client/src/lib/services/persona/persona_storage.svelte.ts
//
// Local SQLite-backed persona repository. Replaces the Firestore
// `personas` collection with plain typed queries against the local
// `personas` table. The one-active-persona invariant is enforced by the
// partial unique index `idx_personas_one_active` (is_active = 1) — the
// constraint that used to require a non-atomic two-step under Data Connect
// is now a single local transaction.
//
// Contract: C-386b — Firestore Removal, personas local-first.
// biome-ignore-all lint/style/useNamingConvention: SQL column names are snake_case

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { PersonaData } from '@aikami/types';
import { emulatorSeedService } from '../storage/emulator_seed_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersonaStorageOptions = BaseFrontendClassOptions;

export type PersonaStorageInterface = BaseFrontendClassInterface & {
  /** Checks if at least one persona exists. */
  hasPersona(): Promise<boolean>;

  /** Retrieves all personas (per-install — uid is accepted for API parity). */
  getPersonas(uid: string): Promise<PersonaData[]>;

  /** Gets the currently active persona, or undefined. */
  getActivePersona(): Promise<PersonaData | undefined>;

  /** Sets a persona as active, deactivating all others atomically. */
  setActivePersona(personaId: string): Promise<void>;

  /** Upserts a persona (create or update). */
  savePersona(persona: PersonaData): Promise<void>;

  /** Updates an existing persona. */
  updatePersona(personaId: string, data: Partial<PersonaData>): Promise<void>;

  /** Deletes a persona. */
  deletePersona(personaId: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type PersonaRow = {
  id: string;
  name: string;
  is_active: number;
  data: string;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PersonaStorage
  extends BaseFrontendClass<PersonaStorageOptions>
  implements PersonaStorageInterface
{
  /** @inheritdoc */
  async hasPersona(): Promise<boolean> {
    const db = await getLocalDatabase();
    const result = await db.query({ sql: 'SELECT COUNT(*) AS n FROM personas', args: [] });
    return Number(result.rows[0]?.n ?? 0) > 0;
  }

  /** @inheritdoc */
  async getPersonas(_uid: string): Promise<PersonaData[]> {
    await emulatorSeedService.seedIfEmpty();
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM personas ORDER BY updated_at DESC',
      args: [],
    });
    const personas: PersonaData[] = [];
    for (const row of result.rows) {
      const persona = this._parsePersona(row as unknown as PersonaRow);
      if (persona) {
        personas.push(persona);
      }
    }
    return personas;
  }

  /** @inheritdoc */
  async getActivePersona(): Promise<PersonaData | undefined> {
    await emulatorSeedService.seedIfEmpty();
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM personas WHERE is_active = 1 LIMIT 1',
      args: [],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return this._parsePersona(result.rows[0] as unknown as PersonaRow);
  }

  /** @inheritdoc */
  async setActivePersona(personaId: string): Promise<void> {
    const db = await getLocalDatabase();
    // Single transaction: deactivate all, activate target. The partial
    // unique index (idx_personas_one_active) guarantees no two rows can be
    // active at once even if a concurrent activation races us.
    await db.transaction([
      { sql: 'UPDATE personas SET is_active = 0', args: [] },
      {
        sql: "UPDATE personas SET is_active = 1, updated_at = datetime('now') WHERE id = ?",
        args: [personaId],
      },
    ]);
  }

  /** @inheritdoc */
  async savePersona(persona: PersonaData): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: `INSERT OR REPLACE INTO personas (id, name, is_active, data, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [
        persona.id,
        persona.name ?? 'Unnamed',
        persona.isActive ? 1 : 0,
        JSON.stringify(persona),
      ],
    });
  }

  /** @inheritdoc */
  async updatePersona(personaId: string, data: Partial<PersonaData>): Promise<void> {
    const existing = await this._getById(personaId);
    if (!existing) {
      // Upsert semantics: Firestore's update-on-missing-doc threw; locally we
      // create so the create flow (which historically wrote to localStorage
      // only) lands in the canonical table too.
      const persona: PersonaData = {
        id: personaId,
        name: data.name ?? 'Unnamed',
        ...(data as Partial<PersonaData>),
        isActive: data.isActive ?? false,
      } as PersonaData;
      await this.savePersona(persona);
      return;
    }

    const updated = { ...existing, ...data, id: personaId } as PersonaData;
    await this.savePersona(updated);
  }

  /** @inheritdoc */
  async deletePersona(personaId: string): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM personas WHERE id = ?',
      args: [personaId],
    });
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async _getById(personaId: string): Promise<PersonaData | undefined> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT * FROM personas WHERE id = ? LIMIT 1',
      args: [personaId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return this._parsePersona(result.rows[0] as unknown as PersonaRow);
  }

  private _parsePersona(row: PersonaRow): PersonaData | undefined {
    try {
      const parsed = JSON.parse(row.data) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      const persona = parsed as PersonaData;
      // Keep is_active column authoritative (it powers the partial index).
      persona.isActive = row.is_active === 1;
      return persona;
    } catch {
      return undefined;
    }
  }
}

/** Shared singleton instance. */
export const personaStorage: PersonaStorageInterface = PersonaStorage.create({
  className: 'PersonaStorage',
});
