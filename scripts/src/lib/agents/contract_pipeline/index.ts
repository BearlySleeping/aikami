// scripts/src/lib/agents/contract_pipeline/index.ts

export type { ContractInfo } from './contract_resolver.ts';
export { resolveContract } from './contract_resolver.ts';
export { readContractStatus, updateContractStatus } from './contract_status.ts';
export {
  captureGitState,
  changedBetweenSnapshots,
  changedPaths,
  contentHash,
  currentCommit,
  fingerprintFiles,
} from './git_state.ts';
export type { ContractHerdrAdapterInterface } from './herdr_adapter.ts';
export { buildWorkspaceLabel, ContractHerdrAdapter } from './herdr_adapter.ts';
export {
  acquireLock,
  createManifest,
  logPath,
  pipelineLog,
  readManifest,
  releaseLock,
  runDirectory,
  stageResultDir,
  writeManifest,
} from './manifest_store.ts';
export { runContractPipeline } from './orchestrator.ts';
export { validatePostconditions } from './postconditions.ts';
export { loadReviewPrompt, loadRolePrompt, type ReviewProfile } from './prompt_loader.ts';
export {
  canEnterReview,
  isFingerprintCurrent,
  stageAfterReviewChanges,
} from './review_gate.ts';
export {
  readStageResult,
  readStageUsage,
  validateStageResult,
  writeStageResult,
} from './stage_result.ts';
export { roleForStage, runStage } from './stage_runner.ts';
export { resolveNextStage, resolveReviewDecision, transition } from './state_machine.ts';
export type {
  AggregatedUsage,
  ContractPipelineStage,
  ContractReviewDecision,
  ContractStageResult,
  ContractWorkerRole,
  CurrencyProvenance,
  GitStateSnapshot,
  MonetaryAmount,
  ReconciliationResult,
  ReviewDecision,
  RunManifest,
  StageAttempt,
  StageRunOutcome,
  StageUsage,
  UsageRecord,
  WorkerLaunchRequest,
} from './types.ts';
export { STATUS_TO_START_STAGE } from './types.ts';
export {
  aggregateUsage,
  computeManifestUsage,
  deduplicateRecords,
  isUsageEmpty,
  isUsageUnknown,
  loadLegacyManifestUsage,
  mergeMonetaryAmounts,
  normalizeLegacyUsage,
} from './usage_ledger.ts';
export {
  formatMonetaryAmount,
  formatUsageRecord,
  formatUsageReport,
  formatUsageReportJson,
} from './usage_report.ts';
