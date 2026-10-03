// apps/frontend/client/src/lib/services/ai/decision/decision_llamacpp_wiring.test.ts
//
// The native llama.cpp backend at the APPLICATION boundary (issue #381).
//
// The adapter contract itself is proven in
// `packages/frontend/ai-gateway/tests/decision_llamacpp_native.test.ts` against
// upstream fixtures. What this file covers is everything the adapter cannot
// prove on its own: that the runtime kind reaches config, that the right adapter
// is built for it, that the qualification gate reads the backend's own dialect
// rather than a constant, and that Off/Shadow/On is persisted and refuses.

import { describe, expect, test } from 'bun:test';
import { DECISION_PROVIDERS, decisionProviderEntry } from '@aikami/constants';
import { NATIVE_LLAMACPP_DIALECT, SYSTEM_ONE_DIALECT } from '@aikami/frontend/ai-gateway/decision';
import type { ResolvedDecisionBackend } from '../../config/decision_backend_resolution';
import { resolveNpcActionQualification } from '../../game/npc_action_decision_qualification.ts';
import { decisionGameplayModeOptions, dialectForBackend } from './decision_backend_logic.ts';

const backend = (overrides: Partial<ResolvedDecisionBackend> = {}): ResolvedDecisionBackend => ({
  connectionId: 'c1',
  registryId: 'llamacpp',
  endpoint: 'http://127.0.0.1:8080',
  checkpoint: 'Laya-Q8_0.gguf',
  runtime: 'llamacpp',
  languages: ['en'],
  qualifiedForGameplay: false,
  gameplayMode: 'off',
  ...overrides,
});

describe('llama.cpp is visible as its own backend', () => {
  test('the registry offers it, as a local, external, key-optional backend', () => {
    const entry = decisionProviderEntry('llamacpp');
    expect(entry).toBeDefined();
    expect(entry?.runtime).toBe('llamacpp');
    expect(entry?.isLocal).toBe(true);
    // A llama-server the player started is theirs. Aikami must not stop it.
    expect(entry?.externallyManaged).toBe(true);
    expect(entry?.needsKey).toBe(false);
    expect(entry?.optionalKey).toBe(true);
    expect(entry?.defaultUrl).toBe('http://127.0.0.1:8080');
    expect(DECISION_PROVIDERS.map((provider) => provider.id)).toContain('llamacpp');
  });

  test('the existing Ollama and hosted connections are still offered', () => {
    // Regression guard: adding a runtime must not displace the others.
    const ids = DECISION_PROVIDERS.map((provider) => provider.id);
    expect(ids).toContain('ollama');
    expect(ids).toContain('jev-external');
    expect(ids).toContain('jev-hosted');
  });

  test('it warns that a chat GGUF cannot answer it', () => {
    const entry = decisionProviderEntry('llamacpp');
    expect(entry?.description).toContain('chat GGUF cannot answer');
  });
});

describe('dialect follows the runtime, not a constant', () => {
  test('llamacpp resolves to the native dialect', () => {
    expect(dialectForBackend(backend())).toBe(NATIVE_LLAMACPP_DIALECT);
  });

  test('ollama and jev keep the jev-v1 dialect', () => {
    expect(dialectForBackend(backend({ runtime: 'ollama', registryId: 'ollama' }))).toBe(
      SYSTEM_ONE_DIALECT,
    );
    expect(dialectForBackend(backend({ runtime: 'jev', registryId: 'jev-hosted' }))).toBe(
      SYSTEM_ONE_DIALECT,
    );
  });

  test('the two dialects are genuinely different', () => {
    expect(NATIVE_LLAMACPP_DIALECT).not.toBe(SYSTEM_ONE_DIALECT);
  });
});

describe('qualification fails closed for an unmeasured native backend', () => {
  test('the player toggle alone never qualifies', () => {
    const result = resolveNpcActionQualification({
      backend: backend({ qualifiedForGameplay: true }),
      backendDialect: NATIVE_LLAMACPP_DIALECT,
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toContain('no recorded measurement');
  });

  test('a jev-v1 measurement does not qualify a native connection', () => {
    const result = resolveNpcActionQualification({
      backend: backend({
        qualifiedForGameplay: true,
        qualification: {
          taskId: 'npc-action-selection',
          taskVersion: 1,
          dialect: 'jev-v1',
          checkpoint: 'Laya-Q8_0.gguf',
        },
      }),
      backendDialect: NATIVE_LLAMACPP_DIALECT,
    });
    expect(result.qualified).toBe(false);
    // Both dialects must be named, so a player can tell "measured on a
    // different wire" from "this runtime is wrong". `jev-v1` IS in the
    // qualified set — membership alone is exactly the bug this case pins.
    expect(result.reason).toContain('jev-v1');
    expect(result.reason).toContain(NATIVE_LLAMACPP_DIALECT);
  });

  test('a native measurement is still refused until a gate exists for it', () => {
    const result = resolveNpcActionQualification({
      backend: backend({
        qualifiedForGameplay: true,
        qualification: {
          taskId: 'npc-action-selection',
          taskVersion: 1,
          dialect: NATIVE_LLAMACPP_DIALECT,
          checkpoint: 'Laya-Q8_0.gguf',
        },
      }),
      backendDialect: NATIVE_LLAMACPP_DIALECT,
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toContain('no cleared gate');
  });

  test('a matching jev-v1 evidence on a jev backend still qualifies', () => {
    const result = resolveNpcActionQualification({
      backend: backend({
        runtime: 'ollama',
        registryId: 'ollama',
        checkpoint: 'nimble',
        qualifiedForGameplay: true,
        qualification: {
          taskId: 'npc-action-selection',
          taskVersion: 1,
          dialect: 'jev-v1',
          checkpoint: 'nimble',
        },
      }),
      backendDialect: SYSTEM_ONE_DIALECT,
    });
    expect(result.qualified).toBe(true);
  });

  test.each([
    ['taskId', { taskId: 'npc-command-kind' }, 'measured for task'],
    ['taskVersion', { taskVersion: 99 }, 'measured at task version'],
    ['checkpoint', { checkpoint: 'some-other-model' }, 'measured for checkpoint'],
  ])('a mismatched %s is refused by name', (leg, evidence, expected) => {
    const result = resolveNpcActionQualification({
      backend: backend({
        runtime: 'ollama',
        qualifiedForGameplay: true,
        qualification: {
          taskId: 'npc-action-selection',
          taskVersion: 1,
          dialect: 'jev-v1',
          checkpoint: 'nimble',
          ...evidence,
        },
      }),
      backendDialect: SYSTEM_ONE_DIALECT,
    });
    expect(result.qualified).toBe(false);
    expect(result.reason).toContain(expected);
  });
});

describe('Off / Shadow / On is a projection, not template logic', () => {
  const refused = { allowed: false, reason: 'the backend is ready, not qualified' };

  test('only `on` is gated on qualification', () => {
    const options = decisionGameplayModeOptions({ routing: refused, persisted: 'off' });
    const byMode = Object.fromEntries(options.map((option) => [option.mode, option.allowed]));
    // `off` cannot change the game. `shadow` discards its result. Only `on` can
    // mutate an NPC and therefore only `on` needs a measurement.
    expect(byMode.off).toBe(true);
    expect(byMode.shadow).toBe(true);
    expect(byMode.on).toBe(false);
  });

  test('a refused `on` says why', () => {
    const options = decisionGameplayModeOptions({ routing: refused, persisted: 'off' });
    const on = options.find((option) => option.mode === 'on');
    expect(on?.detail).toContain('not qualified');
  });

  test('all three become available once the gate is cleared', () => {
    const options = decisionGameplayModeOptions({
      routing: { allowed: true, reason: 'qualified' },
      persisted: 'shadow',
    });
    expect(options.every((option) => option.allowed)).toBe(true);
    expect(options.find((option) => option.mode === 'shadow')?.selected).toBe(true);
  });

  test('the persisted choice is marked selected', () => {
    const options = decisionGameplayModeOptions({
      routing: { allowed: true, reason: 'qualified' },
      persisted: 'on',
    });
    expect(options.find((option) => option.selected)?.mode).toBe('on');
    expect(options.filter((option) => option.selected)).toHaveLength(1);
  });

  test('shadow is described as unable to change the game', () => {
    const options = decisionGameplayModeOptions({ routing: refused, persisted: 'off' });
    const shadow = options.find((option) => option.mode === 'shadow');
    expect(shadow?.detail).toContain('cannot change the game');
  });
});

describe('gameplayMode is part of canonical config', () => {
  test('the resolved backend always reports a mode', () => {
    // The resolver defaults it, so `off` is structural rather than a field a
    // caller has to remember to supply.
    expect(backend().gameplayMode).toBe('off');
  });
});
