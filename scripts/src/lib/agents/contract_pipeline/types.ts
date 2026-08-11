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

/** Maximum autofix cycles before YOLO degrades to manual review. */
export const MAX_AUTOFIX_CYCLES = 2;

/**
 * Stages after which a run is done and can no longer be resumed.
 *
 * SINGLE source of truth — previously duplicated (and subtly diverged) in
 * orchestrator.ts (findPreviousRuns, main-loop exit) and manifest_store.ts
 * (lock-breaking). `blocked` is terminal: a deliberately-blocked or
 * infrastructure-failed run must NOT be auto-resumed by findPreviousRuns,
 * or it silently replays the same crash forever.
 */
export const TERMINAL_STAGES: readonly ContractPipelineStage[] = [
  'pr_created',
  'merged',
  'blocked',
];

export const isTerminalStage = (stage: ContractPipelineStage): boolean =>
  TERMINAL_STAGES.includes(stage);

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
 *  - approve: PR is ready → finish (user merges manually)
 *  - merge: PR is ready → auto-merge via squash
 *  - change: close PR → back to implementer for fixes
 *  - reject: close PR → block pipeline
 */
export type ReviewDecision = 'approve' | 'merge' | 'change' | 'reject';

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
  /** Draft PR URL created after verification passes. */
  prUrl?: string;
  workspaceId?: string;
  pipelinePaneId?: string;
  reviewPaneId?: string;
  /** herdr-native worktree: workspace id (== pipeline workspace in worktree mode). */
  worktreeWorkspaceId?: string;
  /** herdr-native worktree: absolute checkout path (~/.herdr/worktrees/<repo>/...). */
  worktreeCheckoutPath?: string;
  /** herdr-native worktree: branch checked out in the worktree. */
  worktreeBranch?: string;
  blockedReason?: string;
  /** Number of autofix cycles attempted during YOLO review. Used for circuit breaker. */
  autofixCycles: number;
  /** When true, contract-authoring stages (writer + critique) were skipped.
   *  Used during resume to prevent a draft path-sourced run from being reset
   *  to write_contract when resumed by run ID without a target. */
  skipAuthoring?: boolean;
  /** When true, a `skipAuthoring` run still runs the critique stage before
   *  implementation. Lets a hand-authored contract be critiqued without
   *  re-opening the writer. Persisted so a resumed run keeps the choice. */
  critique?: boolean;
  /** When true, the run executes on the root branch (contract/C-XXX) in the
   *  main checkout instead of a git worktree. Persisted so a resumed run
   *  remembers the original `--root` invocation. */
  rootMode?: boolean;
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
