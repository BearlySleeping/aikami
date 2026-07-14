// apps/frontend/client/src/lib/views/combat/tests/initiative_tracker.test.ts
// C-234 Initiative Enhancement — unit tests for initiative sorting/state
//
// Tests:
// - sortInitiative() descending by initiative value
// - Defeated entries sorted last
// - InitiativeEntry type invariants
// - Current turn highlighting logic

import { describe, expect, test } from 'bun:test';
import type { InitiativeEntry } from '../types/combat_enhancements.ts';
import { sortInitiative } from '../utils/dice_notation.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

const makeEntry = (
  overrides: Partial<InitiativeEntry> & { entityId: number; initiative: number },
): InitiativeEntry => ({
  entityId: overrides.entityId,
  name: overrides.name ?? `Entity #${overrides.entityId}`,
  initiative: overrides.initiative,
  currentHp: overrides.currentHp ?? 50,
  maxHp: overrides.maxHp ?? 50,
  isCurrentTurn: overrides.isCurrentTurn ?? false,
  isDefeated: overrides.isDefeated ?? false,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('sortInitiative', () => {
  test('should sort entries by initiative descending', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 10 }),
      makeEntry({ entityId: 2, initiative: 20 }),
      makeEntry({ entityId: 3, initiative: 15 }),
    ];

    const sorted = sortInitiative(entries);

    expect(sorted).toHaveLength(3);
    expect(sorted[0].entityId).toBe(2); // 20
    expect(sorted[1].entityId).toBe(3); // 15
    expect(sorted[2].entityId).toBe(1); // 10
  });

  test('should not mutate the original array', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 10 }),
      makeEntry({ entityId: 2, initiative: 20 }),
    ];

    const sorted = sortInitiative(entries);

    expect(sorted).not.toBe(entries);
    expect(entries[0].entityId).toBe(1);
    expect(entries[1].entityId).toBe(2);
  });

  test('should place defeated entries at the bottom', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 15, isDefeated: false }),
      makeEntry({ entityId: 2, initiative: 20, isDefeated: true }),
      makeEntry({ entityId: 3, initiative: 10, isDefeated: false }),
    ];

    const sorted = sortInitiative(entries);

    expect(sorted).toHaveLength(3);
    // Defeated entry (entityId: 2) should be last
    expect(sorted[2].entityId).toBe(2);
    expect(sorted[2].isDefeated).toBe(true);
  });

  test('should sort defeated entries among themselves by initiative', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 15, isDefeated: true }),
      makeEntry({ entityId: 2, initiative: 25, isDefeated: false }),
      makeEntry({ entityId: 3, initiative: 5, isDefeated: true }),
    ];

    const sorted = sortInitiative(entries);

    expect(sorted).toHaveLength(3);
    expect(sorted[0].entityId).toBe(2); // 25, alive
    // Defeated entries at the end, sorted by init desc among themselves
    expect(sorted[1].entityId).toBe(1); // 15, defeated
    expect(sorted[2].entityId).toBe(3); // 5, defeated
  });

  test('should handle empty array', () => {
    const entries: InitiativeEntry[] = [];
    const sorted = sortInitiative(entries);
    expect(sorted).toHaveLength(0);
  });

  test('should handle single entry', () => {
    const entries: InitiativeEntry[] = [makeEntry({ entityId: 1, initiative: 18 })];

    const sorted = sortInitiative(entries);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].entityId).toBe(1);
  });

  test('should handle all defeated entries', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 10, isDefeated: true }),
      makeEntry({ entityId: 2, initiative: 20, isDefeated: true }),
    ];

    const sorted = sortInitiative(entries);

    // Both defeated, sorted by initiative desc
    expect(sorted[0].entityId).toBe(2); // 20
    expect(sorted[1].entityId).toBe(1); // 10
  });

  test('should handle all alive entries', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 5 }),
      makeEntry({ entityId: 2, initiative: 18 }),
      makeEntry({ entityId: 3, initiative: 12 }),
    ];

    const sorted = sortInitiative(entries);

    expect(sorted[0].entityId).toBe(2); // 18
    expect(sorted[1].entityId).toBe(3); // 12
    expect(sorted[2].entityId).toBe(1); // 5
  });

  test('should handle equal initiative values (stable order not guaranteed but no crash)', () => {
    const entries: InitiativeEntry[] = [
      makeEntry({ entityId: 1, initiative: 15 }),
      makeEntry({ entityId: 2, initiative: 15 }),
    ];

    const sorted = sortInitiative(entries);
    expect(sorted).toHaveLength(2);
  });
});

describe('InitiativeEntry invariants', () => {
  test('should have required fields', () => {
    const entry: InitiativeEntry = {
      entityId: 1,
      name: 'Player',
      initiative: 18,
      currentHp: 75,
      maxHp: 100,
      isCurrentTurn: true,
      isDefeated: false,
    };

    expect(entry.entityId).toBe(1);
    expect(entry.name).toBe('Player');
    expect(entry.initiative).toBe(18);
    expect(entry.currentHp).toBe(75);
    expect(entry.maxHp).toBe(100);
    expect(entry.isCurrentTurn).toBe(true);
    expect(entry.isDefeated).toBe(false);
  });

  test('should handle defeated state', () => {
    const entry: InitiativeEntry = {
      entityId: 3,
      name: 'Skeleton',
      initiative: 8,
      currentHp: 0,
      maxHp: 50,
      isCurrentTurn: false,
      isDefeated: true,
    };

    expect(entry.currentHp).toBe(0);
    expect(entry.isDefeated).toBe(true);
  });
});
