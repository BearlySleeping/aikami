// scripts/src/lib/agents/contract_pipeline/types.ts
// biome-ignore-all lint/style/useNamingConvention: contract statuses and stages are persisted domain values

/**
 * 🔴 SINGLE SOURCE OF TRUTH: the PR target for every contract pipeline run.
 *
 * Currently `main` — early development, and CodeRabbit only reviews PRs
 * targeting main. Change this one constant (or set CONTRACT_PIPELINE_BASE_BRANCH)
 * to retarget the whole pipeline (e.g. back to `dev` later).
 *
 * This is NOT the source a worktree is checked out from — that is the
 * operator's current branch by default (see `_worktreeSourceBranch` in
 * herdr_adapter.ts), so launching from a feature branch still hands the
 * worker that branch's code. Only the eventual PR always targets this
 * constant.
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
  /**
   * Monotonically increasing generation counter scoping results to a specific
   * worker invocation. When a worker is replaced within the same logical
   * stage/attempt (relaunch, replacement), the generation is incremented so
   * late results from the predecessor are not adopted.
   *
   * Absent (undefined) in legacy results — treated as generation 0 for
   * compatibility.
   */
  generation?: number;
  status: 'passed' | 'changes_requested' | 'blocked' | 'failed';
  summary: string;
  findings: string[];
  filesTouched: string[];
  evidence: string[];
  contractHash: string;
  diffHash: string;
  /**
   * Set ONLY when a supervisor wrote this result on the worker's behalf
   * (cost guard trip, orchestrator hard timeout) rather than the worker
   * calling `contract_stage_complete` itself.
   *
   * 🔴 A guard-written result is a GUESS about a session the guard could not
   * see the end of. On 2026-08-26 the C-442 verifier was halted by the loop
   * guard at 13:57:10, and the very same session wrote its real `passed`
   * result — all 7 ACs verified — into the same file 60 seconds later. The
   * orchestrator had already consumed the guess and gone terminal, throwing
   * away a completed verification. `runStage` now treats this marker as
   * "provisional": it waits out a settle window and adopts the worker's own
   * result if one lands. See GUARD_SETTLE_MS in stage_runner.ts.
   */
  haltedBy?: 'cost_guard' | 'hard_timeout';
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
  /**
   * Optional long-form context for the implementer's next attempt — e.g. an
   * AskClaude consultation, root-cause notes, a suggested fix approach.
   * `summary` stays short (it's also used as `blockedReason` on `reject`);
   * `details` exists so the captain isn't forced to compress a real diagnosis
   * into 4096 characters. Only consumed on `change`, folded into the
   * implementer's feedback — see verifierFeedback() in orchestrator.ts.
   */
  details?: string;
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

// ── C-473: Richer usage types ──

/**
 * Provenance of a monetary amount: how the cost was determined.
 * - `provider_reported`: the provider SDK returned a concrete cost.
 * - `estimated`: derived from versioned pricing table (carries `pricingVersion`).
 * - `unknown`: no cost data available (displayed explicitly, never zero).
 * - `incomplete`: partial data (stream interrupted, partial response).
 */
export type CurrencyProvenance = 'provider_reported' | 'estimated' | 'unknown' | 'incomplete';

/**
 * A single monetary amount in one currency, with provenance and optional
 * conversion metadata. When `amount` is the result of a cross-currency
 * conversion, `conversion` records the applied rate, source and timestamp.
 */
export type MonetaryAmount = {
  /** Numeric amount in `currency` units. */
  amount: number;
  /** ISO 4217 currency code (e.g. 'USD', 'EUR'). */
  currency: string;
  /** How this amount was determined. */
  provenance: CurrencyProvenance;
  /**
   * Versioned pricing table identifier when provenance is `estimated`.
   * Example: 'claude-sonnet-5-2026-09'.
   */
  pricingVersion?: string;
  /**
   * Present only when this amount was converted from another currency.
   * Every conversion MUST record the applied rate, source and timestamp.
   * Absent conversion metadata means no cross-currency sum was produced.
   */
  conversion?: {
    /** Target-currency units per one source-currency unit. */
    rate: number;
    timestamp: string;
    source: string;
  };
};

/**
 * Extended per-attempt usage record with full provenance, completeness
 * and event identity for deduplication.
 */
export type UsageRecord = {
  /** Provider model identifier (e.g. 'claude-sonnet-5-20260904'). */
  model: string;
  /** Provider identifier (e.g. 'anthropic', 'openai', 'openrouter'). */
  provider: string;
  /** Effective thinking level applied. */
  thinkingLevel: string;
  /** Prompt/config/profile version used for this generation. */
  configVersion: string;
  /** Number of assistant turns/messages. */
  turns: number;
  /** Input tokens (prompt). */
  inputTokens: number;
  /** Output tokens (completion). */
  outputTokens: number;
  /** Cache read tokens (provider-reported, may overlap with inputTokens). */
  cacheReadTokens: number;
  /** Cache write tokens. */
  cacheWriteTokens: number;
  /** Total tokens from provider (may be aggregate, not merely last event). */
  totalTokens: number;
  /** Elapsed wall-clock time in seconds. */
  elapsedSeconds: number;
  /** Number of tool errors during this attempt. */
  toolErrors: number;
  /** Number of retries within this attempt. */
  retries: number;
  /** Monetary amounts, keyed by ISO 4217 currency code. */
  monetary: Record<string, MonetaryAmount>;
  /** Whether this record represents a complete usage measurement. */
  complete: boolean;
  /**
   * Unique event identity for deduplication. Derived from runId + stage +
   * attempt + generation so identical attempts produce the same identity.
   */
  eventId: string;
  /** ISO timestamp when usage was finalized. */
  finalizedAt: string;
  /**
   * True when external review/vision/delegation usage was captured.
   * False when coverage is incomplete — never silently zero.
   */
  externalCoverageComplete: boolean;
  /**
   * Writer/critic/implementer/verifier/review paths that contributed.
   * Set only when the adapter exposes them; otherwise coverage is
   * reported as incomplete.
   */
  contributingRoles?: ContractWorkerRole[];
};

/**
 * Aggregated usage totals for a run or task. Monetary amounts are
 * kept separate per currency unless every converted amount carries
 * versioned conversion metadata.
 */
export type AggregatedUsage = {
  /** Total turns across all attempts. */
  totalTurns: number;
  /** Total input tokens. */
  totalInputTokens: number;
  /** Total output tokens. */
  totalOutputTokens: number;
  /** Total cache read tokens. */
  totalCacheReadTokens: number;
  /** Total cache write tokens. */
  totalCacheWriteTokens: number;
  /**
   * Aggregated total tokens — sum of individual event totals, NOT merely
   * the last event's totalTokens value (the legacy bug, C-473 AC-2).
   */
  aggregatedTotalTokens: number;
  /** Elapsed wall-clock time in seconds. */
  totalElapsedSeconds: number;
  /** Total tool errors. */
  totalToolErrors: number;
  /** Total retries. */
  totalRetries: number;
  /**
   * Monetary amounts per currency. Cross-currency conversion produces
   * a combined total only when every converted amount carries versioned
   * conversion metadata.
   */
  monetary: Record<string, MonetaryAmount>;
  /**
   * Cross-currency converted total. Present ONLY when every converted
   * amount records a versioned conversion source, applied rate and
   * timestamp. Absent otherwise.
   */
  convertedTotal?: MonetaryAmount;
  /**
   * Number of attempts with unknown/incomplete usage (empty legacy
   * objects or interrupted runs). Never counted as zero cost.
   */
  unknownAttempts: number;
  /** Number of failed attempts included in totals. */
  failedAttempts: number;
  /** Models used across all attempts. */
  models: string[];
  /** Providers used. */
  providers: string[];
  /** Whether all external coverage (review/vision/delegation) was captured. */
  externalCoverageComplete: boolean;
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
  /** Extended usage record when available. */
  usageRecord?: UsageRecord;
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
  /** Aggregated run usage (C-473). Computed from attempts on finalization. */
  aggregatedUsage?: AggregatedUsage;
  reviewDecision?: ContractReviewDecision;
  reconciliation?: ReconciliationResult;
  /**
   * Verdict of the pre-push gate (lint + format + typecheck in the worktree,
   * see pre_push_gate.ts) for the code currently on the branch.
   *
   * 🔴 A failing gate does NOT block the run and does NOT set
   * `blockedReason` — it must not consume a MAX_BLOCKED_ESCALATIONS budget.
   * The branch is pushed regardless (a branch push runs no CI) and `output`
   * is appended to the review captain's prompt as a must-fix before the PR
   * is opened. `revision` prevents diagnostics from an earlier implementation
   * attempt being shown for newer code. Absent means the gate never ran.
   */
  prePushValidation?: { ok: boolean; output: string; checkedAt: string; revision: string };
  verificationFingerprint?: string;
  verificationContractHash?: string;
  /** Draft PR URL created after verification passes. */
  prUrl?: string;
  workspaceId?: string;
  pipelinePaneId?: string;
  reviewPaneId?: string;
  /**
   * Whether the review captain actually received its task text for the
   * CURRENT round. False (a legacy-undefined that predates this field, or a
   * deliberate reset when a `change` decision sends work back to the
   * implementer — see orchestrator.ts) means the pane may be idling with
   * nothing to do — the only condition under which the orchestrator is
   * allowed to type into the human-shared review pane.
   */
  reviewTaskDelivered?: boolean;
  /**
   * ISO timestamp of the one retask nudge the current review round is
   * permitted. Set even when the guard refuses to send, so a crash-loop
   * cannot retry the injection on every restart — see the C-390 incident in
   * review_pane.ts. Reset alongside `reviewTaskDelivered` when a new review
   * round starts (post `change` decision) so that round gets its own nudge.
   */
  reviewResumeNudgedAt?: string;
  /** herdr-native worktree: workspace id (== pipeline workspace in worktree mode). */
  worktreeWorkspaceId?: string;
  /** herdr-native worktree: absolute checkout path (~/.herdr/worktrees/<repo>/...). */
  worktreeCheckoutPath?: string;
  /** herdr-native worktree: branch checked out in the worktree. */
  worktreeBranch?: string;
  blockedReason?: string;
  /**
   * How many times a worker-reported `blocked`/`failed` has been escalated to
   * the review captain instead of ending the run. Bounded by
   * MAX_BLOCKED_ESCALATIONS so a captain that keeps sending work back into a
   * stage that keeps blocking still terminates.
   */
  blockedEscalations?: number;
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
  /** Generation counter for result fencing — see ContractStageResult.generation. */
  generation?: number;
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
