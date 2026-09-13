// packages/shared/types/src/lib/generation/jobs.ts
//
// C-519: the durable job protocol types, derived from the TypeBox schemas in
// `@aikami/schemas` (Schema-First law — no hand-written duplicate shapes).
//
// Contract: C-519 Durable asset jobs and batch execution

import type {
  AssetBriefSchema,
  GenerationBatchReportSchema,
  GenerationBudgetSchema,
  GenerationJobCancellationSchema,
  GenerationJobFailureSchema,
  GenerationJobRecordSchema,
  GenerationJobReportSchema,
  GenerationJobStateEntrySchema,
  GenerationLeaseSchema,
  GenerationNativeHandleSchema,
  GenerationPlanBlockerSchema,
  GenerationPlanItemSchema,
  GenerationPlanSchema,
  GenerationPlanWarningSchema,
  GenerationRunLockProviderSchema,
  GenerationRunLockReferenceSchema,
  GenerationRunLockSchema,
  GenerationRunRecordSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** The authored asset brief (Emberwatch brief v1 is the production instance). */
export type AssetBrief = Static<typeof AssetBriefSchema>;

export type GenerationBudget = Static<typeof GenerationBudgetSchema>;
export type GenerationNativeHandle = Static<typeof GenerationNativeHandleSchema>;
export type GenerationLease = Static<typeof GenerationLeaseSchema>;
export type GenerationJobStateEntry = Static<typeof GenerationJobStateEntrySchema>;
export type GenerationJobCancellation = Static<typeof GenerationJobCancellationSchema>;
export type GenerationJobFailure = Static<typeof GenerationJobFailureSchema>;
export type GenerationJobRecord = Static<typeof GenerationJobRecordSchema>;
export type GenerationRunRecord = Static<typeof GenerationRunRecordSchema>;
export type GenerationRunLock = Static<typeof GenerationRunLockSchema>;
export type GenerationRunLockReference = Static<typeof GenerationRunLockReferenceSchema>;
export type GenerationRunLockProvider = Static<typeof GenerationRunLockProviderSchema>;
export type GenerationPlanBlocker = Static<typeof GenerationPlanBlockerSchema>;
export type GenerationPlanWarning = Static<typeof GenerationPlanWarningSchema>;
export type GenerationPlanItem = Static<typeof GenerationPlanItemSchema>;
export type GenerationPlan = Static<typeof GenerationPlanSchema>;
export type GenerationJobReport = Static<typeof GenerationJobReportSchema>;
export type GenerationBatchReport = Static<typeof GenerationBatchReportSchema>;

export type {
  GenerationBudgetField,
  GenerationJobStatus,
  GenerationPlanBlockerCode,
  GenerationProviderMode,
} from '@aikami/schemas';
