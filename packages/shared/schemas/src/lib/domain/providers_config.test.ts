// packages/shared/schemas/src/lib/domain/providers_config.test.ts
//
// Tests for v3 payload, routing schema, and capability-discriminated params.
// C-481 Phase 1: Seam freeze — schema validation tests.
//
// Contract: C-481

import { describe, expect, test } from 'bun:test';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { DecisionParamsSchema, RoutingSchema, VaultPayloadV3Schema } from './providers_config.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validate = (schema: TSchema, data: unknown): boolean => Value.Check(schema, data);

const UUID = () => crypto.randomUUID();

const makeV3Payload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  providers: [],
  connections: [],
  roles: {},
  routing: { defaults: {}, overrides: {} },
  ...overrides,
});

// ---------------------------------------------------------------------------
// V3 payload schema tests
// ---------------------------------------------------------------------------

describe('C-481: VaultPayloadV3Schema', () => {
  test('validates a minimal v3 payload', () => {
    const payload = makeV3Payload();
    expect(validate(VaultPayloadV3Schema, payload)).toBe(true);
  });

  test('rejects schemaVersion other than 3', () => {
    const payload = makeV3Payload({ schemaVersion: 2 });
    expect(validate(VaultPayloadV3Schema, payload)).toBe(false);
  });

  test('accepts userPresets', () => {
    const payload = makeV3Payload({
      userPresets: [{ id: 'custom-1', name: 'My Preset', params: {}, isBuiltIn: false }],
    });
    expect(validate(VaultPayloadV3Schema, payload)).toBe(true);
  });

  test('accepts recoverySnapshot', () => {
    const payload = makeV3Payload({
      recoverySnapshot: { version: 2, data: 'encrypted-blob' },
    });
    expect(validate(VaultPayloadV3Schema, payload)).toBe(true);
  });

  test('rejects missing providers', () => {
    const payload = { schemaVersion: 3, connections: [], roles: {}, routing: {} };
    expect(validate(VaultPayloadV3Schema, payload)).toBe(false);
  });

  test('rejects missing connections', () => {
    const payload = { schemaVersion: 3, providers: [], roles: {}, routing: {} };
    expect(validate(VaultPayloadV3Schema, payload)).toBe(false);
  });

  test('rejects missing routing', () => {
    const payload = { schemaVersion: 3, providers: [], connections: [], roles: {} };
    expect(validate(VaultPayloadV3Schema, payload)).toBe(false);
  });

  test('rejects invalid providers (non-array)', () => {
    const payload = makeV3Payload({ providers: 'not-an-array' });
    expect(validate(VaultPayloadV3Schema, payload)).toBe(false);
  });

  test('rejects invalid connections (non-array)', () => {
    const payload = makeV3Payload({ connections: 'not-an-array' });
    expect(validate(VaultPayloadV3Schema, payload)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routing schema tests
// ---------------------------------------------------------------------------

describe('C-481: RoutingSchema', () => {
  test('validates empty routing (no defaults, no overrides)', () => {
    expect(validate(RoutingSchema, {})).toBe(true);
  });

  test('validates routing with defaults (valid UUIDs)', () => {
    const uuid1 = UUID();
    const uuid2 = UUID();
    expect(
      validate(RoutingSchema, {
        defaults: { text: uuid1, image: uuid2 },
      }),
    ).toBe(true);
  });

  test('validates routing with null defaults (explicitly disabled)', () => {
    expect(
      validate(RoutingSchema, {
        defaults: { text: null },
      }),
    ).toBe(true);
  });

  test('validates routing with overrides (valid UUIDs)', () => {
    const uuid1 = UUID();
    const uuid2 = UUID();
    expect(
      validate(RoutingSchema, {
        overrides: { narration: uuid1, dialogue: uuid2 },
      }),
    ).toBe(true);
  });

  test('validates routing with both defaults and overrides', () => {
    const uuid1 = UUID();
    const uuid2 = UUID();
    const uuid3 = UUID();
    expect(
      validate(RoutingSchema, {
        defaults: { text: uuid1, voice: uuid3 },
        overrides: { narration: uuid2, 'narrator-voice': null },
      }),
    ).toBe(true);
  });

  test('accepts routing with text default only (sparse)', () => {
    const uuid1 = UUID();
    expect(
      validate(RoutingSchema, {
        defaults: { text: uuid1 },
      }),
    ).toBe(true);
  });

  test('accepts routing with null default', () => {
    expect(
      validate(RoutingSchema, {
        defaults: { text: null },
      }),
    ).toBe(true);
  });

  test('rejects non-uuid connection id in defaults', () => {
    expect(
      validate(RoutingSchema, {
        defaults: { text: 'not-a-uuid' },
      }),
    ).toBe(false);
  });

  test('rejects non-uuid connection id in overrides', () => {
    expect(
      validate(RoutingSchema, {
        overrides: { narration: 'not-a-uuid' },
      }),
    ).toBe(false);
  });

  test('rejects unknown capability keys in defaults', () => {
    expect(
      validate(RoutingSchema, {
        defaults: { unsupported: UUID() },
      }),
    ).toBe(false);
  });

  test('rejects unknown role keys in overrides', () => {
    expect(
      validate(RoutingSchema, {
        overrides: { unsupported: UUID() },
      }),
    ).toBe(false);
  });

  test('allows null connection id in defaults (explicit disable)', () => {
    expect(
      validate(RoutingSchema, {
        defaults: { text: null },
      }),
    ).toBe(true);
  });

  test('allows null connection id in overrides (explicit disable)', () => {
    expect(
      validate(RoutingSchema, {
        overrides: { narration: null },
      }),
    ).toBe(true);
  });

  test('three routing states are distinguishable: absent vs pinned vs disabled', () => {
    const uuid1 = UUID();
    // Absent override (not in overrides)
    const absentOverride = { defaults: { text: uuid1 }, overrides: {} };
    // Pinned override
    const pinnedOverride = { defaults: { text: uuid1 }, overrides: { narration: uuid1 } };
    // Disabled override
    const disabledOverride = { defaults: { text: uuid1 }, overrides: { narration: null } };

    expect(validate(RoutingSchema, absentOverride)).toBe(true);
    expect(validate(RoutingSchema, pinnedOverride)).toBe(true);
    expect(validate(RoutingSchema, disabledOverride)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #381: the decision capability and role
// ---------------------------------------------------------------------------

describe('#381: decision capability, role and params', () => {
  test('a decision connection validates with its own params shape', () => {
    const payload = makeV3Payload({
      providers: [
        {
          id: UUID(),
          registryId: 'jev-external',
          label: 'Jev-compatible server (local)',
          source: 'stored',
          baseUrl: 'http://127.0.0.1:8080',
        },
      ],
      connections: [
        {
          id: UUID(),
          providerId: UUID(),
          capability: 'decision',
          label: 'Laya · laya-nimble-q4',
          model: 'laya-nimble-q4',
          params: { checkpoint: 'laya-nimble-q4', runtime: 'jev', languages: ['en'] },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      roles: { decisions: UUID() },
      routing: { defaults: { decision: UUID() }, overrides: { decisions: UUID() } },
    });
    expect(validate(VaultPayloadV3Schema, payload)).toBe(true);
  });

  test('a decision connection with NO checkpoint is rejected', () => {
    expect(validate(DecisionParamsSchema, { runtime: 'jev' })).toBe(false);
  });

  test('a decision connection with an unknown runtime is rejected', () => {
    expect(validate(DecisionParamsSchema, { checkpoint: 'n', runtime: 'vllm' })).toBe(false);
  });

  test('a chat model cannot be spelled as decision params', () => {
    expect(validate(DecisionParamsSchema, { temperature: 0.7, topP: 1, maxTokens: 2048 })).toBe(
      false,
    );
  });

  test('an old v3 payload with no decision entries still validates', () => {
    // Additive schema change: nothing has to be rewritten on load.
    expect(validate(VaultPayloadV3Schema, makeV3Payload())).toBe(true);
  });
});
