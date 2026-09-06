// scripts/src/lib/agents/evaluation/fake_provider.ts
//
// C-480: deterministic scripted provider for offline tests — no live pi
// process, no network, no spend. Mirrors fake_adapter.ts's controllable-
// state style (C-472).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RunAttemptOptions, RunAttemptResult } from './provider.ts';
import type { UsageRecord } from './types.ts';

/** One scripted response, keyed by taskId — consumed in FIFO order per task. */
export type ScriptedAttempt = {
  /** Files to write into the sandbox, applied before acceptance runs. */
  readonly patch: Readonly<Record<string, string>>;
  readonly usage: UsageRecord;
  readonly retries?: number;
  readonly toolFailures?: number;
  readonly elapsedSeconds?: number;
  readonly crashed?: boolean;
  readonly diagnostics?: string;
};

const defaultUsage = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  model: 'fake-model',
  provider: 'fake',
  thinkingLevel: 'high',
  configVersion: 'v1',
  turns: 1,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 150,
  elapsedSeconds: 1,
  toolErrors: 0,
  retries: 0,
  monetary: { USD: { amount: 0.001, currency: 'USD', provenance: 'provider_reported' } },
  complete: true,
  eventId: `fake-${Math.random()}`,
  finalizedAt: new Date().toISOString(),
  externalCoverageComplete: true,
  ...overrides,
});

/** Deterministic FIFO provider used to exercise evaluation runs without network or spend. */
export class FakeEvalProvider {
  private readonly _queues = new Map<string, ScriptedAttempt[]>();
  readonly runCalls: RunAttemptOptions[] = [];

  /** Queue a scripted response for the next `runAttempt` call on this task id. */
  queue(taskId: string, attempt: ScriptedAttempt): void {
    const queue = this._queues.get(taskId) ?? [];
    queue.push(attempt);
    this._queues.set(taskId, queue);
  }

  /**
   * Applies the next queued patch for a task. Throws when that task has no
   * queued response; `runEvaluation` records that rejection as an error and
   * stops launching further attempts.
   */
  async runAttempt(options: RunAttemptOptions): Promise<RunAttemptResult> {
    this.runCalls.push(options);
    const queue = this._queues.get(options.task.id);
    const scripted = queue?.shift();
    if (!scripted) {
      throw new Error(`FakeEvalProvider: no scripted attempt queued for task "${options.task.id}"`);
    }

    for (const [relativePath, content] of Object.entries(scripted.patch)) {
      const fullPath = join(options.sandboxPath, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }

    return {
      usage: scripted.usage,
      retries: scripted.retries ?? 0,
      toolFailures: scripted.toolFailures ?? 0,
      elapsedSeconds: scripted.elapsedSeconds ?? 1,
      crashed: scripted.crashed ?? false,
      diagnostics: scripted.diagnostics ?? '',
    };
  }
}

export { defaultUsage as fakeUsage };
