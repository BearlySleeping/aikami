// apps/frontend/client/src/lib/views/dev/combat/scenarios/combat_debug_url_config.test.ts
//
// Unit tests for the combat debug URL config: round-trip serialization,
// safe fallback for invalid params with a reported error, empty-param default.
//
// Contract: combat debug workspace (execution prompt §4)
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMBAT_DEBUG_SCENARIO_ID } from './combat_debug_scenarios.ts';
import {
  parseCombatDebugUrlConfig,
  serializeCombatDebugUrlConfig,
} from './combat_debug_url_config.ts';

describe('parseCombatDebugUrlConfig', () => {
  test('empty params give the safe default config with no error', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams());
    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({
      scenarioId: DEFAULT_COMBAT_DEBUG_SCENARIO_ID,
      mode: 'live',
      tab: 'context',
      seed: undefined,
    });
  });

  test('parses valid params', () => {
    const result = parseCombatDebugUrlConfig(
      new URLSearchParams('scenario=movement-geometry&mode=fixtures&tab=objects&seed=42'),
    );
    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({
      scenarioId: 'movement-geometry',
      mode: 'fixtures',
      tab: 'objects',
      seed: 42,
    });
  });

  test('unknown scenario falls back to the default and reports an error', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams('scenario=nope'));
    expect(result.config.scenarioId).toBe(DEFAULT_COMBAT_DEBUG_SCENARIO_ID);
    expect(result.error).toBeDefined();
    expect((result.error ?? '').length).toBeGreaterThan(0);
  });

  test('invalid mode falls back to live and reports an error', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams('mode=warp'));
    expect(result.config.mode).toBe('live');
    expect(result.error).toBeDefined();
  });

  test('invalid tab falls back to context and reports an error', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams('tab=secret'));
    expect(result.config.tab).toBe('context');
    expect(result.error).toBeDefined();
  });

  test('invalid seed falls back to undefined and reports an error', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams('seed=abc'));
    expect(result.config.seed).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  test('non-integer seed falls back to undefined and reports an error', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams('seed=1.5'));
    expect(result.config.seed).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  test('accumulates one error per invalid parameter', () => {
    const result = parseCombatDebugUrlConfig(
      new URLSearchParams('scenario=nope&mode=warp&tab=secret&seed=abc'),
    );
    expect(result.error).toBeDefined();
    expect((result.error ?? '').split(' ').length).toBeGreaterThanOrEqual(4);
  });

  test('negative integer seed is accepted', () => {
    const result = parseCombatDebugUrlConfig(new URLSearchParams('seed=-7'));
    expect(result.config.seed).toBe(-7);
    expect(result.error).toBeUndefined();
  });
});

describe('serializeCombatDebugUrlConfig', () => {
  test('round-trips a config through serialize then parse', () => {
    const config = {
      scenarioId: 'emberwatch-proof',
      mode: 'replay' as const,
      tab: 'reactions' as const,
      seed: 99,
    };
    const parsed = parseCombatDebugUrlConfig(
      new URLSearchParams(serializeCombatDebugUrlConfig(config)),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.config).toEqual(config);
  });

  test('omits seed when undefined', () => {
    const serialized = serializeCombatDebugUrlConfig({
      scenarioId: 'basic-direct-turn',
      mode: 'live',
      tab: 'context',
      seed: undefined,
    });
    expect(serialized).not.toContain('seed');
  });

  test('always emits scenario, mode and tab', () => {
    const serialized = serializeCombatDebugUrlConfig({
      scenarioId: 'basic-direct-turn',
      mode: 'live',
      tab: 'context',
      seed: undefined,
    });
    const params = new URLSearchParams(serialized);
    expect(params.get('scenario')).toBe('basic-direct-turn');
    expect(params.get('mode')).toBe('live');
    expect(params.get('tab')).toBe('context');
  });
});
