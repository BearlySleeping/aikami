// apps/frontend/client/src/lib/services/ai/text_local_first_policy.test.ts
//
// The local-first policy rule (issue #382 P0).
//
// Kept pure so the rule can be pinned without constructing the service
// singleton, reading ConfigService or touching the local pool. The three
// negative cases here each correspond to a way the local path used to spend
// time the caller never asked it to spend.

import { describe, expect, test } from 'bun:test';
import { TEXT_TASK_PRESETS } from '@aikami/constants';
import type { AiModeResolution } from '@aikami/types';
import { createLocalReadinessController, type LocalReadiness } from './local_readiness.ts';
import { resolveLocalFirstPolicy } from './text_local_first_policy.ts';

const localRouting: AiModeResolution = {
  capability: 'text',
  mode: 'offline',
  provider: 'local-qwen3',
  model: '',
  endpoint: '',
};

const cloudRouting: AiModeResolution = {
  capability: 'text',
  mode: 'byok',
  provider: 'openrouter',
  model: 'some/model',
  endpoint: 'https://api.openrouter.ai',
};

const ready: LocalReadiness = {
  state: 'ready',
  servedModelIds: ['local-qwen3'],
  confirmedModelIds: [],
};

/** A llama.cpp HTTP route: local by provider, but `byok` by adapter mode. */
const sidecarRouting: AiModeResolution = {
  capability: 'text',
  mode: 'byok',
  provider: 'llamacpp',
  model: 'qwen3-0.6b',
  endpoint: 'http://localhost:8080/v1',
};

describe('resolveLocalFirstPolicy', () => {
  test('matches the controller for normalized ids, prefixes and empty evidence', () => {
    const readiness = createLocalReadinessController();
    for (const served of [[], [' QWEN3-1B '], ['library/qwen3-1b']]) {
      readiness.served(served);
      for (const model of ['', 'Qwen3-1b', 'library/qwen3-1b', 'qwen3-4b']) {
        expect(
          resolveLocalFirstPolicy({
            resolution: { ...localRouting, model },
            preset: TEXT_TASK_PRESETS['agent-relationship'],
            hasExplicitModel: false,
            readiness: readiness.current,
          }).allowed,
        ).toBe(readiness.canServe(model));
      }
    }
  });

  test('allows a localFirst task whose route is local and has no override', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: localRouting,
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: ready,
      }),
    ).toEqual({ allowed: true, reason: 'opted-in' });
  });

  test('refuses a task that never opted into local execution', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: localRouting,
        preset: TEXT_TASK_PRESETS['agent-cyoa'],
        hasExplicitModel: false,
        readiness: ready,
      }),
    ).toEqual({ allowed: false, reason: 'not-local-first' });
  });

  test('refuses when the caller pinned an explicit model', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: localRouting,
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: true,
        readiness: ready,
      }),
    ).toEqual({ allowed: false, reason: 'explicit-model' });
  });

  test('refuses when the configured route is a remote provider', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: cloudRouting,
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: ready,
      }),
    ).toEqual({ allowed: false, reason: 'remote-route' });
  });

  test('refuses when the engine explicitly does not serve the routed model', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: { ...localRouting, model: 'qwen3-32b' },
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: { ...ready, servedModelIds: ['qwen3-0.6b'] },
      }),
    ).toEqual({ allowed: false, reason: 'not-ready' });
  });

  test.each(['servedModelIds', 'confirmedModelIds'] as const)(
    'matches normalized path aliases in %s',
    (field) => {
      expect(
        resolveLocalFirstPolicy({
          resolution: { ...localRouting, model: 'org/Qwen3' },
          preset: TEXT_TASK_PRESETS['agent-relationship'],
          hasExplicitModel: false,
          readiness: {
            state: 'ready',
            servedModelIds: ['other'],
            confirmedModelIds: [],
            [field]: [' qwen3 '],
          },
        }).allowed,
      ).toBe(true);
    },
  );

  test('refuses when the engine is known to be unavailable', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: localRouting,
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: {
          state: 'unavailable',
          servedModelIds: ['local-qwen3'],
          confirmedModelIds: [],
          reason: 'weights missing',
        },
      }),
    ).toEqual({ allowed: false, reason: 'not-ready' });
  });

  test('treats a local HTTP provider with an endpoint as a local route', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: sidecarRouting,
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: {
          ...ready,
          servedModelIds: ['qwen3-0.6b'],
        },
      }),
    ).toEqual({ allowed: true, reason: 'opted-in' });
  });

  test('refuses a llama.cpp route the engine has not listed', () => {
    // `byok` mode does not make a route remote: llama.cpp is on-device, so a
    // local detour is legitimate — but only for a model it actually serves.
    expect(
      resolveLocalFirstPolicy({
        resolution: { ...sidecarRouting, model: 'qwen3-32b' },
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: { ...ready, servedModelIds: ['qwen3-0.6b'] },
      }),
    ).toEqual({ allowed: false, reason: 'not-ready' });
  });

  test('a liveness-only probe leaves readiness unproven, not refuted', () => {
    expect(
      resolveLocalFirstPolicy({
        resolution: { ...localRouting, model: 'qwen3-32b' },
        preset: TEXT_TASK_PRESETS['agent-relationship'],
        hasExplicitModel: false,
        readiness: { state: 'unknown', servedModelIds: [], confirmedModelIds: [] },
      }),
    ).toEqual({ allowed: true, reason: 'opted-in' });
  });
});
