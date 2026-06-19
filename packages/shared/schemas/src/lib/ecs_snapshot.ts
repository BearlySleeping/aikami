// packages/shared/schemas/src/lib/ecs_snapshot.ts
//
// TypeBox schema for the ECS snapshot payload used by the
// save/load pipeline (C-117 / C-118). Defines the wire format
// produced by serializeWorld and consumed by deserializeWorld.

import Type from 'typebox';
import { Value } from 'typebox/value';

/** Current serializer version — must match this to accept a payload. */
export const CURRENT_SNAPSHOT_VERSION = '1.0.0';

/**
 * Schema for a single component's field-arrays slice.

/**
 * Schema for a single component's field-arrays slice.
 *
 * Each key is a field name (e.g. "x", "y", "hp", "layerIds_0"),
 * each value is a flat array of primitive values indexed by
 * entity position in the snapshot's entity list.
 */
const ComponentSliceSchema = Type.Record(
  Type.String(),
  // null represents "no value for this entity slot" — occurs when
  // a component has a field that is undefined for some entities
  // but populated for others (sparse SoA arrays).
  Type.Array(Type.Union([Type.Number(), Type.String(), Type.Boolean(), Type.Null()])),
);

/**
 * Schema for the full ECS snapshot payload.
 *
 * Validates shape, types, and version before deserialization
 * to catch corrupted or tampered payloads early.
 */
export const EcsSnapshotSchema = Type.Object({
  /** Schema version string — must match the serializer's current version. */
  version: Type.String(),

  /** Unix-epoch milliseconds of when the snapshot was captured. */
  timestamp: Type.Number(),

  /** Ordered list of entity IDs present in this snapshot. */
  entities: Type.Array(Type.Number()),

  /** Per-component flat array slices keyed by component name. */
  components: Type.Record(Type.String(), ComponentSliceSchema),
});

/**
 * Validates a raw ECS snapshot payload string.
 *
 * Checks:
 * 1. Payload is parseable JSON
 * 2. Matches the EcsSnapshotSchema shape
 * 3. Version matches the expected serializer version
 *
 * @returns An error message string, or `undefined` if valid.
 */
export const validateEcsSnapshot = (payload: string): string | undefined => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!Value.Check(EcsSnapshotSchema, parsed)) {
    const errors = [...Value.Errors(EcsSnapshotSchema, parsed)];
    return `Schema validation failed: ${errors.map((e) => e.message).join(', ')}`;
  }

  if (parsed.version !== CURRENT_SNAPSHOT_VERSION) {
    return `Unsupported version "${parsed.version}" — expected "${CURRENT_SNAPSHOT_VERSION}"`;
  }

  return undefined;
};
