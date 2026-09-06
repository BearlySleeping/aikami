// scripts/src/lib/agents/evaluation/real_provider.ts
//
// C-480: spawns `pi` directly against a sandbox worktree and parses its
// streamed JSON events into a UsageRecord — the same event shape the
// legacy contract-pipeline worker.ts parses (message_end / message.usage),
// since that is the only path in this repo that actually produces usage
// data (the herdr-pane path has no usage parsing wired to it at all).
// PI_SOFT_SPEND/PI_HARD_SPEND/etc come from budgetEnv so cost_guard.ts
// enforces the per-attempt cap in-session (AC-4).

import { spawn } from 'node:child_process';
import type { RunAttemptOptions, RunAttemptResult } from './provider.ts';
import type { CurrencyProvenance, MonetaryAmount, UsageRecord } from './types.ts';

type PiEvent = {
  type?: string;
  error?: unknown;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
      cost?: { total?: number };
    };
  };
};

/** Runs real `pi` evaluation attempts inside disposable candidate sandboxes. */
export class RealEvalProvider {
  /**
   * Executes one task/config attempt and returns parsed usage, failure counts
   * and crash diagnostics from the spawned provider process.
   */
  async runAttempt(options: RunAttemptOptions): Promise<RunAttemptResult> {
    const start = Date.now();
    const args = [
      '--mode',
      'json',
      '-p',
      '--no-session',
      '--model',
      options.config.catalogue.model,
      '--thinking',
      options.config.thinking,
      options.task.prompt,
    ];

    const env = { ...process.env, ...(options.budgetEnv ?? {}) };

    let turns = 0;
    let model = options.config.catalogue.model;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let totalTokens = 0;
    let costTotal = 0;
    let costSeen = false;
    let toolFailures = 0;
    let stderr = '';

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn('pi', args, {
        cwd: options.sandboxPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          let event: PiEvent;
          try {
            event = JSON.parse(line) as PiEvent;
          } catch {
            continue;
          }
          if (event.type === 'tool_call' && event.error) {
            toolFailures += 1;
          }
          if (event.type !== 'message_end' || event.message?.role !== 'assistant') {
            continue;
          }
          const usage = event.message.usage;
          turns += 1;
          model = event.message.model ?? model;
          inputTokens += usage?.input ?? 0;
          outputTokens += usage?.output ?? 0;
          cacheReadTokens += usage?.cacheRead ?? 0;
          cacheWriteTokens += usage?.cacheWrite ?? 0;
          totalTokens = usage?.totalTokens ?? totalTokens;
          if (usage?.cost?.total !== undefined) {
            costTotal += usage.cost.total;
            costSeen = true;
          }
        }
      });

      child.once('error', () => resolve(1));
      child.once('close', (code) => resolve(code ?? 1));
    });

    const elapsedSeconds = (Date.now() - start) / 1000;
    const crashed = exitCode !== 0 && turns === 0;

    const provenance: CurrencyProvenance = costSeen ? 'provider_reported' : 'unknown';
    const monetary: Record<string, MonetaryAmount> = {
      USD: { amount: costSeen ? costTotal : 0, currency: 'USD', provenance },
    };

    const usage: UsageRecord = {
      model,
      provider: options.config.catalogue.provider,
      thinkingLevel: options.config.thinking,
      configVersion: '1',
      turns,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      elapsedSeconds,
      toolErrors: toolFailures,
      retries: 0,
      monetary,
      complete: turns > 0,
      eventId: `${options.task.id}-${options.config.id}-${start}`,
      finalizedAt: new Date().toISOString(),
      externalCoverageComplete: true,
    };

    return {
      usage,
      retries: 0,
      toolFailures,
      elapsedSeconds,
      crashed,
      diagnostics: crashed
        ? `pi exited with code ${exitCode} and produced no assistant turn.${stderr.trim() ? ` stderr: ${stderr.trim()}` : ''}`
        : '',
    };
  }
}
