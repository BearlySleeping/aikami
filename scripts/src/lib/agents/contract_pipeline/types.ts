// scripts/src/lib/agents/contract_pipeline/types.ts
// biome-ignore-all lint/style/useNamingConvention: contract statuses and stages are persisted domain values

/**
 * 🔴 SINGLE SOURCE OF TRUTH: default base branch for contract pipeline PRs
 * and Git Worktree base revisions.
 *
 * Currently `main` — early development, and CodeRabbit only reviews PRs
 * targeting main. Change this one constant (or set CONTRACT_PIPELINE_BASE_BRANCH)
 * to retarget the whole pipeline (e.g. back to `dev` later).
 */
export const PIPELINE_BASE_BRANCH = process.env.CONTRACT_PIPELINE_BASE_BRANCH ?? 'main';

/** Pipeline stages for one contract run. */
export type ContractPipelineStage =
  | 'prepare'
  | 'write_contract'
  | 'critique'
  | 'implement'
  | 'verify'
  | 'review'
  | 'accepted'
  | 'reconciling'
  | 'pr_created'
  | 'merged'
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

/**
 * Review decision modes matching user intent:
 *  - approve: accept run, stop here
 *  - approve_pr: reconcile → push branch → create PR to dev
 *  - approve_merge: PR + auto-merge + sync (the "send-it")
 *  - changes_applied: edits made → re-verify
 *  - reject: block run, keep workspace for diagnostics
 */
export type ReviewDecision =
  | 'approve'
  | 'approve_pr'
  | 'approve_merge'
  | 'changes_applied'
  | 'reject'
  | 'blocked';

/** Decision written through the contract_review_decision tool. */
export type ContractReviewDecision = {
  runId: string;
  decision: ReviewDecision;
  summary: string;
  diffHash: string;
  contractChanged: boolean;
  createdAt: string;
};

/** Reconciliation result after successful approve_pr / approve_merge. */
export type ReconciliationResult = {
  changeId: string;
  bookmarkName: string;
  headBranch: string;
  baseBranch: string;
  prTitle: string;
  prBody: string;
  prUrl?: string;
  merged?: boolean;
};

/** Per-stage model usage captured from Pi session JSONL. */
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
  verifyLoops: number;
  attempts: StageAttempt[];
  usage: Record<string, StageUsage>;
  reviewDecision?: ContractReviewDecision;
  reconciliation?: ReconciliationResult;
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
  delivery: 'direct_prompt';
  prompt: string;
  contractPath: string;
  role: ContractWorkerRole;
  stage: ContractPipelineStage;
  attempt: number;
  /** Optional user message sent after pi starts. Used for feedback
   *  on retries (keep system prompt static → DeepSeek cache valid). */
  userMessage?: string;
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
