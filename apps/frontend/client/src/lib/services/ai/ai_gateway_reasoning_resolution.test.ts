// apps/frontend/client/src/lib/services/ai/ai_gateway_reasoning_resolution.test.ts
//
// The reasoning preference's only unresolved link in the value path:
//
//   TextTaskPreset.reasoning
//       -> AiGatewayService.resolveText -> AiModeResolution.reasoning
//           -> adapter -> request body
//
// The adapter half is pinned in @aikami/frontend-ai-gateway and the preset half
// in @aikami/constants. This covers the middle: that the task's preference
// reaches the resolution on EVERY routing branch, and that no routing branch
// invents one for a task that has none.
//
// Four branches exist and a forgotten `task` argument on any one of them is
// invisible everywhere else: the request would still be valid, still fast
// enough for most turns, and simply silently not carrying the control. That is
// the failure mode worth a test.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig tsconfig.test.json
//     src/lib/services/ai/ai_gateway_reasoning_resolution.test.ts

import { describe, expect, mock, test } from 'bun:test';
import type { TextTask } from '@aikami/constants';

// ---------------------------------------------------------------------------
// Mocks — only what the gateway reads while resolving a text route.
// ---------------------------------------------------------------------------

type StoredConnection = {
  id: string;
  capability: string;
  model: string;
  providerId: string;
  params: Record<string, unknown>;
};
type StoredProvider = { id: string; registryId: string; baseUrl?: string };

let connections: StoredConnection[] = [];
let providers: StoredProvider[] = [];
/** Role assignments, keyed by AiRole. Empty means "no explicit role routing". */
let roleAssignments: Record<string, string> = {};

const connectionById = (id: string): StoredConnection | undefined =>
  connections.find((connection) => connection.id === id);

mock.module('../config/config_service.svelte.ts', () => ({
  configService: {
    get state() {
      return { aiConnections: connections, providers };
    },
    resolveRole: (role: string) => {
      const connectionId = roleAssignments[role];
      if (connectionId === undefined) {
        return undefined;
      }
      const connection = connectionById(connectionId);
      const provider = providers.find((entry) => entry.id === connection?.providerId);
      if (connection === undefined || provider === undefined) {
        return undefined;
      }
      return {
        provider: provider.registryId,
        model: connection.model,
        endpoint: provider.baseUrl ?? '',
        params: connection.params,
      };
    },
    getActiveTextProvider: () => {
      const provider = providers[0];
      return {
        provider: provider?.registryId ?? 'ollama',
        model: connections[0]?.model ?? '',
        endpoint: provider?.baseUrl ?? '',
        params: connections[0]?.params,
      };
    },
    getApiKey: () => undefined,
    getProviders: () => providers,
    getAiConnections: () => connections,
  },
}));

// The module exports a configured singleton rather than the class, and it is
// built from the mocked `configService`, so resolving through it exercises the
// real composition — the same wiring production uses.
const { aiGatewayService } = await import('./ai_gateway_service.svelte.ts');

const resolve = (task?: TextTask, model?: string) => aiGatewayService.resolveText({ task, model });

/** The two routing shapes a configured local setup produces. */
const seedLocalOllama = (): void => {
  connections = [
    {
      id: 'c1',
      capability: 'text',
      model: 'ornith-1.5:9b',
      providerId: 'p1',
      params: { maxTokens: 1024, temperature: 0.7 },
    },
  ];
  providers = [{ id: 'p1', registryId: 'ollama', baseUrl: 'http://localhost:11434/v1' }];
  roleAssignments = { structured: 'c1' };
};

const seedRoleRoutingOff = (): void => {
  seedLocalOllama();
  roleAssignments = {};
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiGatewayService.resolveText — reasoning reaches the resolution', () => {
  test('an explicit model that matches a connection carries the task preference', () => {
    seedRoleRoutingOff();
    expect(resolve('envelope', 'ornith-1.5:9b').reasoning).toBe('none');
  });

  test('an explicit model with NO matching connection still carries it', () => {
    // The "model not found in connections — use it verbatim" branch. Dropping
    // `task` here would silently disable the control for any caller that
    // overrides the model, which is exactly how a fix gets half-applied.
    seedRoleRoutingOff();
    expect(resolve('envelope', 'some-other-model').reasoning).toBe('none');
  });

  test('role-routed tasks carry it', () => {
    seedLocalOllama();
    expect(resolve('envelope').reasoning).toBe('none');
  });

  test('the fall-through to the active text provider carries it', () => {
    seedRoleRoutingOff();
    expect(resolve('envelope').reasoning).toBe('none');
  });

  test('every player-facing task resolves to NO preference, on every branch', () => {
    seedRoleRoutingOff();
    for (const task of ['dialogue', 'narration', 'combat-narration', 'combat-ai'] as const) {
      expect(resolve(task).reasoning).toBeUndefined();
      expect(resolve(task, 'some-other-model').reasoning).toBeUndefined();
    }
  });

  test('a task-less call has no preference', () => {
    // A task-less call is a narrative call, and it must behave like one.
    seedRoleRoutingOff();
    expect(resolve().reasoning).toBeUndefined();
  });

  test('the preference never lands on the connection params', () => {
    // `params` is the persisted connection record. If reasoning leaked into it
    // it would become stored, migratable state that no settings control can
    // reach — and a stored `reasoning: 'default'` would switch the fix back off
    // for every existing user who had never configured anything.
    seedRoleRoutingOff();
    const resolution = resolve('envelope');
    expect('reasoning' in (resolution.params ?? {})).toBe(false);
  });

  test('the stored connection params are passed through untouched', () => {
    seedRoleRoutingOff();
    const resolution = resolve('envelope');
    expect(resolution.params?.maxTokens).toBe(800); // capped by the envelope preset
    expect(resolution.params?.temperature).toBe(0.3); // preset-owned
  });
});
