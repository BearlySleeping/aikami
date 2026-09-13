// packages/shared/constants/src/lib/feature_flags.test.ts
//
// Contract: C-516 AC-1 — `combatEngine` chooses the engine once, defaults to
// legacy, and only the exact `v2` literal opts in.

import { describe, expect, test } from 'bun:test';
import { FEATURE_FLAG_KEYS } from './feature_flags.ts';
import {
  DEFAULT_COMBAT_ENGINE,
  isCombatEngineKind,
  resolveCombatEngineKind,
} from './game/combat_engine.ts';

describe('FEATURE_FLAG_KEYS.combatEngine', () => {
  test('maps to PUBLIC_COMBAT_ENGINE', () => {
    expect(FEATURE_FLAG_KEYS.combatEngine).toBe('PUBLIC_COMBAT_ENGINE');
  });
});

describe('resolveCombatEngineKind', () => {
  test('defaults to legacy', () => {
    expect(DEFAULT_COMBAT_ENGINE).toBe('legacy');
  });

  test('unset resolves to legacy', () => {
    expect(resolveCombatEngineKind(undefined)).toBe('legacy');
    expect(resolveCombatEngineKind(null)).toBe('legacy');
  });

  test('empty and invalid values resolve to legacy', () => {
    for (const raw of ['', ' ', 'legacy', 'V2', 'v3', 'true', '1', 'combat-2']) {
      expect(resolveCombatEngineKind(raw)).toBe('legacy');
    }
  });

  test('the exact v2 literal selects v2', () => {
    expect(resolveCombatEngineKind('v2')).toBe('v2');
  });
});

describe('isCombatEngineKind', () => {
  test('accepts only the two engine literals', () => {
    expect(isCombatEngineKind('legacy')).toBe(true);
    expect(isCombatEngineKind('v2')).toBe(true);
    expect(isCombatEngineKind('v1')).toBe(false);
    expect(isCombatEngineKind(undefined)).toBe(false);
    expect(isCombatEngineKind(2)).toBe(false);
  });
});
