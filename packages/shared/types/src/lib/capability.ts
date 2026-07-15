// packages/shared/types/src/lib/capability.ts
//
// Capability detection types — derived from @aikami/schemas.
// Contract: C-318 AC-1

import type {
  CapabilitySnapshotSchema,
  DegradationModeSchema,
  DetectionStatusSchema,
} from '@aikami/schemas';
import type { Static } from '@sinclair/typebox';

export type CapabilitySnapshot = Static<typeof CapabilitySnapshotSchema>;
export type DetectionStatus = Static<typeof DetectionStatusSchema>;
export type DegradationMode = Static<typeof DegradationModeSchema>;
