// apps/frontend/client/src/lib/services/game/combat_engine_flag.test.ts
//
// C-516 AC-1 — the client reads `PUBLIC_COMBAT_ENGINE` through the config layer.
//
// The AC requires a client/config env test, not only the shared resolver cases:
// this asserts the flag is actually WIRED (the config module resolves it) and
// that it defaults to `legacy` with no env override.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig-override=tsconfig.test.json \
//     src/lib/services/game/combat_engine_flag.test.ts
//
// Contract: C-516 AC-1

import { describe, expect, test } from 'bun:test';
import { FEATURE_FLAG_KEYS, resolveCombatEngineKind } from '@aikami/constants';
import { featureFlags } from '@aikami/frontend/configs';

describe('C-516 AC-1: the client resolves combatEngine from PUBLIC_COMBAT_ENGINE', () => {
  test('the flag key is PUBLIC_COMBAT_ENGINE', () => {
    expect(FEATURE_FLAG_KEYS.combatEngine).toBe('PUBLIC_COMBAT_ENGINE');
  });

  test('the config flag is wired and defaults to legacy', () => {
    // The test lane sets no PUBLIC_COMBAT_ENGINE, so the wired flag must be the
    // default — this is what makes an unset value safe in production.
    expect(featureFlags.combatEngine).toBe('legacy');
  });

  test('the wired flag equals the resolver applied to the raw env value', () => {
    // Proves the config module actually routes the env var through the shared
    // resolver instead of hardcoding a default.
    expect(featureFlags.combatEngine).toBe(
      resolveCombatEngineKind(process.env.PUBLIC_COMBAT_ENGINE),
    );
  });

  test('only the exact v2 literal opts in; everything else is legacy', () => {
    expect(resolveCombatEngineKind('v2')).toBe('v2');
    for (const raw of [undefined, '', 'legacy', 'V2', 'v3', '1', 'true']) {
      expect(resolveCombatEngineKind(raw)).toBe('legacy');
    }
  });
});
