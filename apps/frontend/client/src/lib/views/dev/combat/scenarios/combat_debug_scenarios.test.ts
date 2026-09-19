// apps/frontend/client/src/lib/views/dev/combat/scenarios/combat_debug_scenarios.test.ts
//
// Unit tests for the combat debug scenario registry: id uniqueness, required
// fields, the safe default fallback, synthetic/authored content boundaries.
//
// Contract: combat debug workspace (execution prompt §5)
import { describe, expect, test } from 'bun:test';
import {
  COMBAT_DEBUG_SCENARIOS,
  DEFAULT_COMBAT_DEBUG_SCENARIO_ID,
  findCombatDebugScenario,
  resolveCombatDebugScenario,
} from './combat_debug_scenarios.ts';

describe('COMBAT_DEBUG_SCENARIOS', () => {
  test('all scenario ids are unique', () => {
    const ids = COMBAT_DEBUG_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every scenario carries version, title, purpose, proves and seed', () => {
    for (const scenario of COMBAT_DEBUG_SCENARIOS) {
      expect(scenario.version, scenario.id).toBeGreaterThanOrEqual(1);
      expect(scenario.title.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.purpose.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.proves.length, scenario.id).toBeGreaterThan(0);
      expect(Number.isFinite(scenario.seed), scenario.id).toBe(true);
    }
  });

  test('synthetic scenarios are synthetic and do not require the content pack', () => {
    const synthetic = COMBAT_DEBUG_SCENARIOS.filter((scenario) => scenario.synthetic);
    expect(synthetic.length).toBeGreaterThan(0);
    for (const scenario of synthetic) {
      expect(scenario.requiresContentPack, scenario.id).toBe(false);
      expect(scenario.battlefield.kind, scenario.id).toBe('synthetic');
    }
  });

  test('authored scenarios require the content pack and are not synthetic', () => {
    const authored = COMBAT_DEBUG_SCENARIOS.filter((scenario) => !scenario.synthetic);
    expect(authored.length).toBeGreaterThan(0);
    for (const scenario of authored) {
      expect(scenario.requiresContentPack, scenario.id).toBe(true);
      expect(scenario.battlefield.kind, scenario.id).toBe('authored');
    }
  });

  test('emberwatch-proof requires the pack and references the inn map', () => {
    const scenario = findCombatDebugScenario('emberwatch-proof');
    expect(scenario).toBeDefined();
    expect(scenario?.requiresContentPack).toBe(true);
    expect(scenario?.synthetic).toBe(false);
    expect(scenario?.battlefield.kind).toBe('authored');
    if (scenario?.battlefield.kind === 'authored') {
      expect(scenario.battlefield.mapId).toBe('inn');
      expect(scenario.battlefield.encounterId).toBe('proof_encounter');
    }
  });
});

describe('findCombatDebugScenario', () => {
  test('finds each registered scenario by id', () => {
    for (const scenario of COMBAT_DEBUG_SCENARIOS) {
      expect(findCombatDebugScenario(scenario.id)?.id).toBe(scenario.id);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(findCombatDebugScenario('does-not-exist')).toBeUndefined();
  });

  test('finds emberwatch-proof', () => {
    expect(findCombatDebugScenario('emberwatch-proof')?.title).toBe('Emberwatch proof encounter');
  });
});

describe('resolveCombatDebugScenario', () => {
  test('falls back to the safe default for an unknown id', () => {
    const resolved = resolveCombatDebugScenario('unknown');
    expect(resolved.id).toBe(DEFAULT_COMBAT_DEBUG_SCENARIO_ID);
  });

  test('falls back to the safe default for undefined', () => {
    const resolved = resolveCombatDebugScenario(undefined);
    expect(resolved.id).toBe(DEFAULT_COMBAT_DEBUG_SCENARIO_ID);
  });

  test('returns the requested scenario when it exists', () => {
    expect(resolveCombatDebugScenario('movement-geometry').id).toBe('movement-geometry');
  });

  test('the default id is a registered scenario', () => {
    expect(findCombatDebugScenario(DEFAULT_COMBAT_DEBUG_SCENARIO_ID)).toBeDefined();
  });
});
