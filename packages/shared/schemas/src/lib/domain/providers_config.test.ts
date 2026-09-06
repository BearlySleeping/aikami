// packages/shared/schemas/src/lib/domain/providers_config.test.ts
//
// Tests for v3 payload, routing schema, and capability-discriminated params.
// C-481 Phase 1: Seam freeze — schema validation tests.
//
// Contract: C-481

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { RoutingSchema, VaultPayloadV3Schema } from './providers_config.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validate = (schema: ReturnType<typeof Value.Check>, data: unknown): boolean =>
  Value.Check(schema, data);

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
