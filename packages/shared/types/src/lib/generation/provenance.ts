// packages/shared/types/src/lib/generation/provenance.ts
//
// C-518: generation lineage, candidate and acceptance types, derived from the
// TypeBox schemas in `@aikami/schemas` (Schema-First law — no hand-written
// duplicate shapes).
//
// Contract: C-518 Generation provenance and candidate records

import type {
  AcceptanceRecordSchema,
  CandidateRecordSchema,
  GenerationModelArtifactSchema,
  GenerationProvenanceSchema,
  GenerationTransformationSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type GenerationProvenance = Static<typeof GenerationProvenanceSchema>;
export type GenerationModelArtifact = Static<typeof GenerationModelArtifactSchema>;
export type GenerationTransformation = Static<typeof GenerationTransformationSchema>;
export type CandidateRecord = Static<typeof CandidateRecordSchema>;
export type AcceptanceRecord = Static<typeof AcceptanceRecordSchema>;

export type {
  CandidateStatus,
  GenerationMediaProperties,
  GenerationProvenanceState,
  GenerationReference,
  GenerationVersions,
} from '@aikami/schemas';
