// packages/shared/schemas/src/lib/local_ai/stack_plan.ts
import Type from 'typebox';
import { ManifestEntryCompanionRoleSchema } from './model_manifest.ts';
import { StackBackendSchema, StackModalitySchema } from './stack_backend.ts';

export const StackPlanModelSchema = Type.Object({
  manifestId: Type.String(),
  modality: StackModalitySchema,
  bytes: Type.Number(),
  license: Type.String(),
  requiresAcknowledgement: Type.Boolean(),
  /** One-line human justification shown in the plan. */
  rationale: Type.String(),
  /** Set when this entry is a companion (vae/llm/clip/...) riding along
   *  with another entry in this same list, rather than an independently
   *  selected model. Absent means "primary". */
  role: Type.Optional(ManifestEntryCompanionRoleSchema),
});

export const StackPlanSchema = Type.Object({
  backend: StackBackendSchema,
  modalities: Type.Array(StackModalitySchema),
  models: Type.Array(StackPlanModelSchema),
  totalDownloadBytes: Type.Number(),
  warnings: Type.Array(Type.String()),
  /** True when engines must run natively rather than in containers (macOS). */
  nativeEngines: Type.Boolean(),
});
