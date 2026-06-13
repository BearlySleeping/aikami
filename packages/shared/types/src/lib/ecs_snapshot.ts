// packages/shared/types/src/lib/ecs_snapshot.ts
//
// Derived types from the EcsSnapshot TypeBox schema.

import type { EcsSnapshotSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

/** A single component's field-arrays slice in an ECS snapshot. */
export type ComponentSlice = Type.Static<typeof EcsSnapshotSchema>['components'][string];

/** Full ECS snapshot payload for the save/load pipeline. */
export type EcsSnapshot = Type.Static<typeof EcsSnapshotSchema>;
