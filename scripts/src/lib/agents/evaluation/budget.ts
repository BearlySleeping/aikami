// scripts/src/lib/agents/evaluation/budget.ts
//
// C-480 AC-4: paid work requires explicit bounded authorization. No caps
// supplied means offline planning only — never an unlimited default.
// Exhaustion of any axis (cost, turns, elapsed minutes) stops further
// attempts and cancels owned in-flight work while preserving whatever
// results were already recorded. Unknown/incomplete billing on an attempt
// blocks further paid attempts under that cap — it is never treated as
// zero spend, since a cap that can't see real cost can't be enforced.

import type { BudgetCaps, UsageRecord } from './types.ts';

export type BudgetExhaustedReason = 'cost' | 'turns' | 'elapsed_minutes' | 'unknown_billing';

export class RunBudget {
  private readonly _caps: BudgetCaps | undefined;
  private _spentUsd = 0;
  private _turns = 0;
  private _elapsedMinutes = 0;
  private _exhaustedReason: BudgetExhaustedReason | undefined;
  private _cancelled = false;

  constructor(caps: BudgetCaps | undefined) {
    this._caps = caps;
  }

  /** Whether this budget authorizes any paid work at all. */
  get authorized(): boolean {
    return this._caps !== undefined;
  }

  get caps(): BudgetCaps | undefined {
    return this._caps;
  }

  get exhaustedReason(): BudgetExhaustedReason | undefined {
    return this._exhaustedReason;
  }

  get exhausted(): boolean {
    return this._exhaustedReason !== undefined;
  }

  get spentUsd(): number {
    return this._spentUsd;
  }

  /**
   * Whether the caller may start a new attempt right now. False once
   * exhausted or explicitly cancelled — the caller must not launch further
   * owned work after either.
   */
  canStartAttempt(): boolean {
    return this.authorized && !this.exhausted && !this._cancelled;
  }

  /**
   * Record usage from a completed or interrupted attempt and evaluate every
   * cap axis. Unknown-provenance monetary entries can't be enforced against
   * a numeric cap, so any unknown/incomplete billing trips the budget
   * immediately rather than being counted as zero.
   */
  record(options: { usage: UsageRecord; elapsedMinutes: number }): void {
    if (!this._caps) {
      throw new Error('RunBudget.record called without authorization — no caps set.');
    }

    const monetaryEntries = Object.values(options.usage.monetary);
    const hasUnknownBilling = monetaryEntries.some(
      (m) => m.provenance === 'unknown' || m.provenance === 'incomplete',
    );

    for (const amount of monetaryEntries) {
      if (amount.currency === 'USD') {
        this._spentUsd += amount.amount;
      }
    }
    this._turns += options.usage.turns;
    this._elapsedMinutes += options.elapsedMinutes;

    if (hasUnknownBilling && !this._exhaustedReason) {
      this._exhaustedReason = 'unknown_billing';
      return;
    }
    if (this._spentUsd >= this._caps.maxCostUsd && !this._exhaustedReason) {
      this._exhaustedReason = 'cost';
      return;
    }
    if (this._turns >= this._caps.maxTurns && !this._exhaustedReason) {
      this._exhaustedReason = 'turns';
      return;
    }
    if (this._elapsedMinutes >= this._caps.maxElapsedMinutes && !this._exhaustedReason) {
      this._exhaustedReason = 'elapsed_minutes';
    }
  }

  /**
   * Cancel remaining owned work after exhaustion. Idempotent — does not
   * discard results already recorded via `record()`.
   */
  cancelOwnedWork(): void {
    this._cancelled = true;
  }

  /** Env vars for one spawned pi process, mirroring worker/run.ts's per-tier cost_guard convention. */
  attemptEnv(perAttemptCapUsd: number): Record<string, string> {
    if (!this._caps) {
      throw new Error('RunBudget.attemptEnv called without authorization — no caps set.');
    }
    const soft = Math.min(perAttemptCapUsd, this._caps.maxCostUsd).toFixed(2);
    const hard = (Math.min(perAttemptCapUsd, this._caps.maxCostUsd) * 1.5).toFixed(2);
    return {
      PI_SOFT_SPEND: soft,
      PI_HARD_SPEND: hard,
      PI_MAX_TURNS: String(this._caps.maxTurns),
      PI_MAX_RUN_MINUTES: String(this._caps.maxElapsedMinutes),
    };
  }
}
