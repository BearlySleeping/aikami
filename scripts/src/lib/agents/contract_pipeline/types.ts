// scripts/src/lib/agents/contract_pipeline/types.ts
// biome-ignore-all lint/style/useNamingConvention: contract statuses and stages are persisted domain values

/** Pipeline stages for one contract run. */
export type ContractPipelineStage =
  | 'prepare'
  | 'write_contract'
  | 'critique'
  | 'implement'
  | 'verify'
  | 'review'
  | 'accepted'
  | 'blocked';

/** Worker role associated with a model-driven stage. */
export type ContractWorkerRole = 'writer' | 'critic' | 'implementer' | 'verifier';

/** Canonical result written through the contract_stage_complete tool. */
export type ContractStageResult = {
  runId: string;
  stage: ContractWorkerRole;
  attempt: number;
  status: 'passed' | 'changes_requested' | 'blocked' | 'failed';
  summary: string;
  findings: string[];
  filesTouched: string[];
  evidence: string[];
  contractHash: string;
  diffHash: string;
};

/** Decision written through the contract_review_decision tool. */
export type ContractReviewDecision = {
  runId: string;
  decision: 'approve' | 'changes_applied' | 'reject' | 'blocked';
  summary: string;
  diffHash: string;
  contractChanged: boolean;
  createdAt: string;
};

/** Per-stage model usage captured from Pi JSON events. */
export type StageUsage = {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
};

/** One stage attempt recorded in the run manifest. */
export type StageAttempt = {
  stage: ContractPipelineStage;
  role: ContractWorkerRole;
  attempt: number;
  paneId: string;
  startTime: string;
  endTime?: string;
  result?: ContractStageResult;
  usage?: StageUsage;
  feedbackPath?: string;
};

/** Durable v3 manifest stored under .pi/contract-runs/<runId>/. */
export type RunManifest = {
  version: 3;
  runId: string;
  contractId: string;
  contractPath: string;
  baseCommit: string;
  baselineFingerprint: string;
  startTime: string;
  lastUpdated: string;
  currentStage: ContractPipelineStage;
  criticLoops: number;
  verifyLoops: number;
  attempts: StageAttempt[];
  usage: Record<string, StageUsage>;
  reviewDecision?: ContractReviewDecision;
  verificationFingerprint?: string;
  verificationContractHash?: string;
  workspaceId?: string;
  pipelinePaneId?: string;
  reviewPaneId?: string;
  blockedReason?: string;
};

/** Request passed to the Herdr worker launcher. */
export type WorkerLaunchRequest = {
  runId: string;
  resultPath: string;
  usagePath: string;
  delivery: 'direct_prompt';
  prompt: string;
  contractPath: string;
  role: ContractWorkerRole;
  stage: ContractPipelineStage;
  attempt: number;
};

/** Outcome returned by one stage run. */
export type StageRunOutcome = {
  result: ContractStageResult;
  paneId: string;
  usage?: StageUsage;
};

/** Git state used for deterministic stage postconditions. */
export type GitStateSnapshot = {
  files: Record<string, string>;
  fingerprint: string;
};

/** Map of contract status to pipeline start stage. */
export const STATUS_TO_START_STAGE: Record<string, ContractPipelineStage> = {
  draft: 'write_contract',
  approved: 'implement',
  in_progress: 'implement',
  implemented: 'verify',
  verification_failed: 'implement',
  verified: 'review',
  completed: 'review',
};
