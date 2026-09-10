// apps/frontend/client/src/lib/services/persona/persona_storage.test.ts
//
// Contract tests for the local persona repository (C-386b AC-4) against a
// real in-memory libSQL database with the production migrations applied.
//
// The one-active-persona invariant is enforced by the real partial unique
// index (idx_personas_one_active), so these tests exercise the actual
// constraint instead of a hand-emulated JS approximation.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { countTableRows, createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

const fixture = await createRealLocalDatabase();

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => fixture.db),
}));

// ── Service under test ────────────────────────────────────────────────

import type { PersonaData } from '@aikami/types';
import type { PersonaStorageInterface } from './persona_storage.svelte.ts';
import { personaStorage } from './persona_storage.svelte.ts';

const makePersona = (id: string, name: string, isActive = false): PersonaData =>
  ({
    id,
    name,
    isActive,
    abilityScores: {},
    appearance: {},
    hitPoints: 10,
    hitPointsMax: 10,
    temporaryHitPoints: 0,
    armorClass: 10,
    speed: 30,
    experiencePoints: 0,
    savingThrows: [],
    skills: [],
    proficiencies: [],
    languages: ['Common'],
    equipment: [],
    inventory: [],
  }) as PersonaData;

/** Counts active persona rows directly in the database. */
const countActiveRows = async (): Promise<number> => {
  const result = await fixture.db.query({
    sql: 'SELECT COUNT(*) AS n FROM personas WHERE is_active = 1',
    args: [],
  });
  return Number(result.rows[0]?.n ?? 0);
};

describe('PersonaStorage (local SQLite)', () => {
  let storage: PersonaStorageInterface;

  beforeEach(async () => {
    await fixture.reset();
    storage = personaStorage;
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('savePersona then getPersonas returns it', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    const personas = await storage.getPersonas('any-uid');
    expect(personas).toHaveLength(1);
    expect(personas[0]?.name).toBe('Aragorn');
  });

  test('hasPersona is false when empty, true after save', async () => {
    expect(await storage.hasPersona()).toBe(false);
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    expect(await storage.hasPersona()).toBe(true);
  });

  test('setActivePersona activates one and deactivates the rest', async () => {
    await storage.savePersona(makePersona('p1', 'One'));
    await storage.savePersona(makePersona('p2', 'Two'));
    await storage.savePersona(makePersona('p3', 'Three'));

    await storage.setActivePersona('p2');

    const active = await storage.getActivePersona();
    expect(active?.id).toBe('p2');

    const all = await storage.getPersonas('u');
    const activeCount = all.filter((p) => p.isActive).length;
    expect(activeCount).toBe(1);
  });

  test('concurrent activation attempts leave exactly one active persona', async () => {
    await storage.savePersona(makePersona('p1', 'One'));
    await storage.savePersona(makePersona('p2', 'Two'));

    // Two concurrent activation races — the partial unique index allows only
    // one row with is_active=1; the loser must be rejected.
    await Promise.allSettled([storage.setActivePersona('p1'), storage.setActivePersona('p2')]);

    const all = await storage.getPersonas('u');
    const activeCount = all.filter((p) => p.isActive).length;
    expect(activeCount).toBe(1);

    // The database table itself must never hold two active rows.
    expect(await countActiveRows()).toBe(1);
  });

  test('switching active persona atomically moves the flag', async () => {
    await storage.savePersona(makePersona('p1', 'One'));
    await storage.savePersona(makePersona('p2', 'Two'));
    await storage.setActivePersona('p1');
    await storage.setActivePersona('p2');

    const active = await storage.getActivePersona();
    expect(active?.id).toBe('p2');
    expect(await countActiveRows()).toBe(1);
  });

  test('updatePersona upserts when missing (create flow)', async () => {
    await storage.updatePersona('new-1', { name: 'Created', isActive: false });
    const personas = await storage.getPersonas('u');
    expect(personas).toHaveLength(1);
    expect(personas[0]?.name).toBe('Created');
  });

  test('updatePersona merges fields on existing persona', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    await storage.updatePersona('p1', { name: 'Aragorn II' });
    const personas = await storage.getPersonas('u');
    expect(personas[0]?.name).toBe('Aragorn II');
  });

  test('deletePersona removes the row', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn'));
    await storage.deletePersona('p1');
    expect(await storage.hasPersona()).toBe(false);
    expect(await countTableRows(fixture.db, 'personas')).toBe(0);
  });

  test('getActivePersona returns undefined when none active', async () => {
    await storage.savePersona(makePersona('p1', 'Aragorn', false));
    expect(await storage.getActivePersona()).toBeUndefined();
  });
});
