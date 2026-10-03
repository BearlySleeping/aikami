// apps/frontend/client/src/lib/services/config/decision_llamacpp_config.test.ts
//
// Native llama.cpp decision configuration (issue #381).
//
// Split out of `config_service.test.ts` because that file is at its 1500-line
// cap, and because these cases are about ONE thing — the new runtime kind and
// the persisted mode — rather than about the config service generally.
//
// The migration case is the one that matters most: `gameplayMode` was added as
// an OPTIONAL field precisely so a vault written before it loads unchanged. The
// safe default must be STRUCTURAL (the resolver supplies `off`), not left to a
// caller to remember — otherwise a newer build starts dispatching decisions at
// an older save that never opted in.

import { beforeEach, describe, expect, test } from 'bun:test';
import type { DecisionRuntime } from '@aikami/types';
import { applyDecisionGameplayMode } from './decision_backend_resolution.ts';

const _get = async () => (await import('./config_service.svelte.ts')).configService;

const _reset = async (): Promise<void> => {
  const configService = await _get();
  configService.state.providers = [];
  configService.state.aiConnections = [];
  configService.state.roles = {};
  configService.state.connections = [];
  configService.state.defaultByCapability = {};
  configService.state.defaultConnectionId = null;
  configService.state.routing = {};
};

/** Seeds a decision connection on a provider, and points the role at it. */
const _seedDecision = async (
  over: {
    registryId?: string;
    baseUrl?: string;
    runtime?: DecisionRuntime;
    /** Left out entirely, which is what an old vault looks like. */
    gameplayMode?: 'off' | 'shadow' | 'on';
  } = {},
): Promise<{ configService: Awaited<ReturnType<typeof _get>>; connectionId: string }> => {
  const configService = await _get();
  const providerId = configService.addProvider({
    registryId: over.registryId ?? 'llamacpp',
    label: 'llama.cpp — decision models',
    baseUrl: over.baseUrl ?? 'http://127.0.0.1:8080',
    source: 'stored',
  });
  const connectionId = configService.addAiConnection({
    providerId,
    capability: 'decision',
    label: 'Laya · Laya-Q8_0',
    model: 'Laya-Q8_0.gguf',
    params: {
      checkpoint: 'Laya-Q8_0.gguf',
      runtime: over.runtime ?? 'llamacpp',
      languages: ['en'],
      ...(over.gameplayMode === undefined ? {} : { gameplayMode: over.gameplayMode }),
    },
  });
  configService.setRoleAssignment('decisions', connectionId);
  return { configService, connectionId };
};

describe('ConfigService — native llama.cpp decision configuration', () => {
  beforeEach(async () => {
    await _reset();
  });

  test('a native backend resolves with its own runtime kind and registry id', async () => {
    const { configService } = await _seedDecision();
    const backend = configService.resolveDecisionBackend();
    expect(backend?.runtime).toBe('llamacpp');
    expect(backend?.registryId).toBe('llamacpp');
    expect(backend?.checkpoint).toBe('Laya-Q8_0.gguf');
    expect(backend?.endpoint).toBe('http://127.0.0.1:8080');
    // Being configured qualifies nothing.
    expect(backend?.qualifiedForGameplay).toBe(false);
  });

  test('the existing runtime kinds still resolve unchanged', async () => {
    const { configService } = await _seedDecision({ registryId: 'ollama', runtime: 'ollama' });
    expect(configService.resolveDecisionBackend()?.runtime).toBe('ollama');
  });

  test('a connection saved before gameplayMode existed resolves to `off`', async () => {
    const { configService, connectionId } = await _seedDecision();
    const stored = configService.getAiConnection(connectionId);
    // The seeded params carry no gameplayMode, exactly as an old save would.
    expect((stored?.params as Record<string, unknown>).gameplayMode).toBeUndefined();
    // Structural default, not a field the caller has to remember to supply.
    expect(configService.resolveDecisionBackend()?.gameplayMode).toBe('off');
  });

  test('every mode round-trips through the connection', async () => {
    const { configService } = await _seedDecision();
    for (const mode of ['shadow', 'on', 'off'] as const) {
      applyDecisionGameplayMode(configService.state, mode, (id, params) => {
        configService.updateAiConnection(id, { params } as never);
      });
      expect(configService.resolveDecisionBackend()?.gameplayMode).toBe(mode);
    }
  });

  test('writing the mode with no decision connection is a no-op, not a crash', async () => {
    const configService = await _get();
    configService.clearRoleAssignment('decisions');
    expect(configService.resolveDecisionBackend()).toBeUndefined();
    const written = applyDecisionGameplayMode(configService.state, 'on', () => {
      throw new Error('must not write when there is no decision connection');
    });
    expect(written).toBe(false);
    expect(configService.resolveDecisionBackend()).toBeUndefined();
  });

  test('writing the mode never clobbers a recorded qualification', async () => {
    // A caller that read `params` once and re-sent the whole object could drop a
    // `qualification` record it never looked at — silently un-qualifying a
    // backend that had qualified.
    const { configService, connectionId } = await _seedDecision();
    configService.updateAiConnection(connectionId, {
      params: {
        checkpoint: 'Laya-Q8_0.gguf',
        runtime: 'llamacpp',
        languages: ['en'],
        qualifiedForGameplay: true,
        qualification: {
          taskId: 'npc-action-selection',
          taskVersion: 1,
          dialect: 'typesafe-systemone-v1',
          checkpoint: 'Laya-Q8_0.gguf',
          runId: 'r1',
        },
      },
    } as never);
    applyDecisionGameplayMode(configService.state, 'shadow', (id, params) => {
      configService.updateAiConnection(id, { params } as never);
    });
    const backend = configService.resolveDecisionBackend();
    expect(backend?.gameplayMode).toBe('shadow');
    expect(backend?.qualification?.runId).toBe('r1');
  });

  test('a text connection can never be served as a decision backend', async () => {
    const configService = await _get();
    const providerId = configService.addProvider({
      registryId: 'llamacpp',
      label: 'llama.cpp — decision models',
      baseUrl: 'http://127.0.0.1:8080',
      source: 'stored',
    });
    const connectionId = configService.addAiConnection({
      providerId,
      capability: 'text',
      label: 'narrative',
      model: 'qwen3:14b',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    configService.setRoleAssignment('decisions', connectionId);
    expect(configService.resolveDecisionBackend()).toBeUndefined();
  });
});
