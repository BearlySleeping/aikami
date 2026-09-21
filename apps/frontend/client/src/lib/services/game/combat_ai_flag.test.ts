// apps/frontend/client/src/lib/services/game/combat_ai_flag.test.ts
//
// C-526 AC-9 — the client reads `PUBLIC_COMBAT_LLM_AGENTS` through the config
// layer and it defaults OFF.
//
// The AC requires a client/config env test, not only the shared resolver cases:
// this asserts the flag is actually WIRED (the config module resolves it) and
// that an unset value keeps the deterministic path.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig-override=tsconfig.test.json \
//     src/lib/services/game/combat_ai_flag.test.ts
//
// Contract: C-526 AC-9

import { describe, expect, test } from 'bun:test';
import { FEATURE_FLAG_KEYS, resolveCombatLlmAgents } from '@aikami/constants';
import { featureFlags } from '@aikami/frontend/configs';

describe('C-526 AC-9: the client resolves combatLlmAgents from PUBLIC_COMBAT_LLM_AGENTS', () => {
  test('the flag key is PUBLIC_COMBAT_LLM_AGENTS', () => {
    expect(FEATURE_FLAG_KEYS.combatLlmAgents).toBe('PUBLIC_COMBAT_LLM_AGENTS');
  });

  test('the config flag is wired and defaults off', () => {
    // The test lane sets no PUBLIC_COMBAT_LLM_AGENTS, so the wired flag must be
    // the default — this is what makes an unset value safe in production.
    expect(featureFlags.combatLlmAgents).toBe(false);
  });

  test('the wired flag resolves on in an isolated environment', () => {
    const configModuleUrl = new URL(
      '../../../../../../../packages/frontend/configs/src/index.ts',
      import.meta.url,
    ).href;
    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        '-e',
        'const { featureFlags } = await import(process.argv[1]); process.stdout.write(String(featureFlags.combatLlmAgents))',
        configModuleUrl,
      ],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        ...Object.fromEntries([
          ['PUBLIC_APP_ID', 'client'],
          ['PUBLIC_MODE', 'test'],
          ['PUBLIC_COMBAT_LLM_AGENTS', '1'],
        ]),
      },
    });

    expect(child.exitCode).toBe(0);
    expect(child.stderr.toString()).toBe('');
    expect(child.stdout.toString()).toBe('true');
  });

  test('only the exact `1` literal opts in', () => {
    expect(resolveCombatLlmAgents('1')).toBe(true);
    for (const raw of [undefined, null, '', '0', 'true', 'yes', 'V2']) {
      expect(resolveCombatLlmAgents(raw)).toBe(false);
    }
  });
});
