// apps/frontend/client/src/lib/views/dev/combat/fixtures/combat_debug_fixtures.test.ts
//
// Unit tests for the presentation fixture builder: every preset builds, each
// build returns fresh arrays/objects, and the exact notice label.
//
// Contract: combat debug workspace (execution prompt §2, §3, §5)
import { describe, expect, test } from 'bun:test';
import {
  buildCombatDebugPresentationFixture,
  COMBAT_DEBUG_FIXTURE_NOTICE,
  COMBAT_DEBUG_FIXTURE_PRESETS,
} from './combat_debug_fixtures.ts';

describe('COMBAT_DEBUG_FIXTURE_NOTICE', () => {
  test('is the exact label', () => {
    expect(COMBAT_DEBUG_FIXTURE_NOTICE).toBe('Presentation fixture — no live simulation');
  });
});

describe('buildCombatDebugPresentationFixture', () => {
  test('builds every preset with a matching id and non-empty title', () => {
    for (const preset of COMBAT_DEBUG_FIXTURE_PRESETS) {
      const fixture = buildCombatDebugPresentationFixture(preset);
      expect(fixture.id, preset).toBe(preset);
      expect(fixture.title.length, preset).toBeGreaterThan(0);
      expect(fixture.description.length, preset).toBeGreaterThan(0);
      expect(fixture.turnState.actionEconomy, preset).toBeDefined();
    }
  });

  test('initial is the empty baseline', () => {
    const fixture = buildCombatDebugPresentationFixture('initial');
    expect(fixture.logEntries).toEqual([]);
    expect(fixture.queuedRolls).toEqual([]);
    expect(fixture.statusEffects).toEqual([]);
    expect(fixture.initiativeEntries.length).toBeGreaterThan(0);
  });

  test('the dice-queue preset carries d4-through-d100 queued rolls', () => {
    const fixture = buildCombatDebugPresentationFixture('dice-queue');
    expect(fixture.queuedRolls.map((roll) => roll.notation.sides)).toEqual([20, 6, 8, 4, 100]);
    expect(fixture.queuedRolls.every((roll) => roll.timestamp === 0)).toBe(true);
  });

  test('the victory preset marks the goblin defeated', () => {
    const fixture = buildCombatDebugPresentationFixture('victory');
    const goblin = fixture.initiativeEntries.find((entry) => entry.name === 'Goblin');
    expect(goblin?.isDefeated).toBe(true);
  });

  test('returns a fresh top-level object per call', () => {
    const first = buildCombatDebugPresentationFixture('log-filled');
    const second = buildCombatDebugPresentationFixture('log-filled');
    expect(first).not.toBe(second);
    expect(first.initiativeEntries).not.toBe(second.initiativeEntries);
    expect(first.logEntries).not.toBe(second.logEntries);
    expect(first.queuedRolls).not.toBe(second.queuedRolls);
    expect(first.statusEffects).not.toBe(second.statusEffects);
  });

  test('mutating one call does not affect the next', () => {
    const first = buildCombatDebugPresentationFixture('log-filled');
    const before = first.initiativeEntries.length;
    const firstEntry = first.initiativeEntries[0];
    if (firstEntry) {
      firstEntry.name = 'MUTATED';
    }
    first.logEntries.push({
      rawText: 'injected',
      isPlainText: true,
    });
    first.queuedRolls.push({
      id: 'injected',
      notation: { count: 1, sides: 20, label: 'd20' },
      label: 'Injected',
      timestamp: 0,
    });

    const second = buildCombatDebugPresentationFixture('log-filled');
    expect(second.initiativeEntries).toHaveLength(before);
    expect(second.initiativeEntries[0]?.name).not.toBe('MUTATED');
    expect(second.logEntries.some((entry) => entry.rawText === 'injected')).toBe(false);
    expect(second.queuedRolls.some((roll) => roll.id === 'injected')).toBe(false);
  });

  test('mutating a nested statusEffectIds array does not leak', () => {
    const first = buildCombatDebugPresentationFixture('long-labels');
    const firstEntry = first.initiativeEntries[0];
    const original = firstEntry?.statusEffectIds.length ?? 0;
    firstEntry?.statusEffectIds.push('injected');

    const second = buildCombatDebugPresentationFixture('long-labels');
    expect(second.initiativeEntries[0]?.statusEffectIds).toHaveLength(original);
  });

  test('is deterministic across builds', () => {
    const first = buildCombatDebugPresentationFixture('low-hp');
    const second = buildCombatDebugPresentationFixture('low-hp');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
