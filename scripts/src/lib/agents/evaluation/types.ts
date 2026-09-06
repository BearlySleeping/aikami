// scripts/src/lib/agents/evaluation/types.ts
//
// C-480: shared types for the agent evaluation harness — frozen tasks,
// resolved model configurations, per-attempt results and the comparison
// report. Usage accounting reuses the C-473 ledger types directly rather
// than duplicating a parallel cost model.

import type { AggregatedUsage, UsageRecord } from '../contract_pipeline/types.ts';

export type {
  AggregatedUsage,
  CurrencyProvenance,
  MonetaryAmount,
  UsageRecord,
} from '../contract_pipeline/types.ts';

/** Category an evaluation task exercises (AC-1's required spread). */
export type TaskCategory =
  | 'instruction_repair'
  | 'pure_typescript'
  | 'validation_error_handling'
  | 'process_concurrency'
  | 'svelte_reactivity'
  | 'cross_platform_scripting';

/** Outcome of running a task's frozen acceptance check against a candidate. */
export type AcceptanceOutcome = {
  readonly accepted: boolean;
  /** Human-readable diagnostics — empty when accepted. */
  readonly diagnostics: string;
};

/**
 * A single frozen, versioned evaluation task. `base` is the starting file
 * set seeded into an isolated sandbox; `acceptance` is executed from the
 * host module — never copied into the sandbox — so a candidate patch that
 * edits or deletes a same-named file inside the sandbox cannot change what
 * runs (AC-1).
 */
export type EvalTask = {
  readonly id: string;
  readonly version: number;
  readonly category: TaskCategory;
  readonly description: string;
  /** Relative path → file content, seeded into the sandbox before the attempt. */
  readonly base: Readonly<Record<string, string>>;
  /** The instruction/prompt given to the candidate. */
  readonly prompt: string;
  /** Held-out tasks are excluded from any report used to justify a routing change. */
  readonly heldOut: boolean;
  /** Runs against the sandbox directory; never sees the task's own source. */
  readonly acceptance: (sandboxPath: string) => Promise<AcceptanceOutcome>;
};

/** Content hashes recorded per attempt so evidence is bound to a frozen task. */
export type TaskHashes = {
  readonly taskHash: string;
  readonly baseHash: string;
  readonly acceptanceHash: string;
  readonly configHash: string;
};

/** Maintainer-supplied model family label — not a provider slug (AC-2). */
export type FamilyLabel = 'flash' | 'sonnet' | 'opus' | 'astra';

/** A resolved, installed provider/model entry for one family label. */
export type CatalogueEntry = {
  readonly family: FamilyLabel;
  readonly provider: string;
  readonly model: string;
  readonly available: boolean;
  /** Reason the family could not be resolved, when `available` is false. */
  readonly reason?: string;
};

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Cache condition of the attempt — cold and warm runs are never mixed invisibly (AC-2). */
export type CacheCondition = 'cold' | 'warm';

/** One comparable configuration a task is run under. */
export type EvalConfig = {
  readonly id: string;
  readonly family: FamilyLabel;
  readonly catalogue: CatalogueEntry;
  readonly thinking: ThinkingLevel;
  readonly cacheCondition: CacheCondition;
};

export type AttemptOutcome = 'accepted' | 'rejected' | 'error' | 'halted';

/** Result of one task × config × repetition attempt. */
export type AttemptResult = {
  readonly taskId: string;
  readonly configId: string;
  readonly repetition: number;
  readonly outcome: AttemptOutcome;
  readonly firstPass: boolean;
  readonly retries: number;
  readonly toolFailures: number;
  readonly usage: UsageRecord;
  readonly hashes: TaskHashes;
  readonly diagnostics: string;
};

/** Run-wide spend/turn/time authorization. Absence means offline plan mode only (AC-4). */
export type BudgetCaps = {
  readonly maxCostUsd: number;
  readonly maxTurns: number;
  readonly maxElapsedMinutes: number;
};

export type RunAuthorization = {
  readonly mode: 'plan' | 'paid';
  readonly caps?: BudgetCaps;
  readonly authorizedTasks?: readonly string[];
  readonly authorizedConfigIds?: readonly string[];
  readonly authorizedAt: string;
};

/** Per-task-per-config summary statistics. */
export type ConfigTaskSummary = {
  readonly taskId: string;
  readonly configId: string;
  readonly sampleSize: number;
  readonly acceptedCount: number;
  readonly firstPassCount: number;
  readonly acceptanceRate: number;
  readonly firstPassRate: number;
  readonly avgRetries: number;
  readonly avgToolFailures: number;
  readonly avgElapsedSeconds: number;
  readonly costPerAcceptedTaskUsd: number | null;
  readonly unknownBillingCount: number;
  readonly inconclusive: boolean;
};

/** Full comparison report over all attempts in a run. */
export type EvalReport = {
  readonly runId: string;
  readonly generatedAt: string;
  readonly authorization: RunAuthorization;
  readonly attempts: readonly AttemptResult[];
  readonly summaries: readonly ConfigTaskSummary[];
  /** Minimum repetitions a (task, config) pair needs before it's conclusive. */
  readonly minRepetitionsForConfidence: number;
  /** Whole-run usage totals — never silently zero for unknown/incomplete billing. */
  readonly aggregatedUsage: AggregatedUsage;
};
