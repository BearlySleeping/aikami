// packages/shared/types/src/lib/ecs_snapshot.ts
//
// ComponentSlice is a computed indexed-access type from EcsSnapshotSchema;
// cannot be a simple re-export. EcsSnapshot is re-exported from schemas.

import type { EcsSnapshotSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

/** A single component's field-arrays slice in an ECS snapshot. */
export type ComponentSlice = Type.Static<typeof EcsSnapshotSchema>['components'][string];

/** Full ECS snapshot payload for the save/load pipeline. */
export type { EcsSnapshot } from '@aikami/schemas';
