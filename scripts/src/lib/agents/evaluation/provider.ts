// scripts/src/lib/agents/evaluation/provider.ts
//
// C-480: the adapter boundary between the runner and whatever actually
// produces a candidate patch — a real spawned `pi` process (real_provider.ts)
// or a deterministic scripted double (fake_provider.ts), mirroring the
// contract pipeline's ContractHerdrAdapterInterface / FakeHerdrAdapter split
// (C-472) so offline tests never depend on a live provider.

import type { EvalConfig, EvalTask, UsageRecord } from './types.ts';

/** Inputs supplied to a provider for one isolated task/config attempt. */
export type RunAttemptOptions = {
  readonly task: EvalTask;
  readonly config: EvalConfig;
  /** Isolated directory already seeded with `task.base`. The adapter edits files here. */
  readonly sandboxPath: string;
  /** Per-attempt PI_SOFT_SPEND/PI_HARD_SPEND/etc, when running under an authorized budget. */
  readonly budgetEnv?: Readonly<Record<string, string>>;
};

/** Provider execution result and complete usage evidence for one attempt. */
export type RunAttemptResult = {
  readonly usage: UsageRecord;
  readonly retries: number;
  readonly toolFailures: number;
  readonly elapsedSeconds: number;
  /** True when the process itself failed to produce any patch (distinct from a rejected acceptance check). */
  readonly crashed: boolean;
  readonly diagnostics: string;
};

/** Adapter contract implemented by real and deterministic evaluation providers. */
export type EvalProviderAdapter = {
  runAttempt(options: RunAttemptOptions): Promise<RunAttemptResult>;
};
