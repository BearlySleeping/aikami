// packages/shared/types/src/lib/generation/workflow_and_preparation.ts
//
// C-520: versioned image-workflow profiles and deterministic preparation
// types, derived from the TypeBox schemas in `@aikami/schemas`
// (Schema-First law — no hand-written duplicate shapes).
//
// Contract: C-520 Versioned image workflows and asset preparation

import type {
  AlphaCleanupOperationSchema,
  AlphaExtractOperationSchema,
  DecodeOrientOperationSchema,
  EncodeOperationSchema,
  MediaValidationFindingSchema,
  MediaValidationReportSchema,
  PackOperationSchema,
  PreparationProfileSchema,
  PreparedMediaArtifactSchema,
  ResampleOperationSchema,
  TrimOperationSchema,
  WorkflowProfileSchema,
  WorkflowSemanticInputSchema,
  WorkflowTemplateSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type WorkflowProfile = Static<typeof WorkflowProfileSchema>;
export type WorkflowTemplate = Static<typeof WorkflowTemplateSchema>;
export type WorkflowSemanticInput = Static<typeof WorkflowSemanticInputSchema>;

export type PreparationProfile = Static<typeof PreparationProfileSchema>;
export type AlphaExtractOperation = Static<typeof AlphaExtractOperationSchema>;
export type AlphaCleanupOperation = Static<typeof AlphaCleanupOperationSchema>;
export type DecodeOrientOperation = Static<typeof DecodeOrientOperationSchema>;
export type ResampleOperation = Static<typeof ResampleOperationSchema>;
export type TrimOperation = Static<typeof TrimOperationSchema>;
export type PackOperation = Static<typeof PackOperationSchema>;
export type EncodeOperation = Static<typeof EncodeOperationSchema>;

export type MediaValidationReport = Static<typeof MediaValidationReportSchema>;
export type MediaValidationFinding = Static<typeof MediaValidationFindingSchema>;
export type PreparedMediaArtifact = Static<typeof PreparedMediaArtifactSchema>;

export type {
  AlphaDespill,
  AlphaExtractMode,
  GroundContact,
  MediaFindingSeverity,
  PreparationOperation,
  PreparationQaLimits,
  ResampleMethod,
  WorkflowDependency,
  WorkflowDependencyRole,
  WorkflowProfileCapabilities,
  WorkflowProfileDefaults,
  WorkflowProfileEngine,
  WorkflowProfileLoraAllowance,
  WorkflowProfileStatus,
  WorkflowRightsDecision,
  WorkflowSemanticInputKind,
} from '@aikami/schemas';
